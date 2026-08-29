import datetime
import json
import re

CONNECTION_CODE_PATTERN = re.compile(r"^[A-Za-z0-9]{6}$")

CPU_HIGH_THRESHOLD_PERCENT = 90.0
MIN_SUSTAINED_SECONDS = 5.0
# 실제 main.py 루프의 한 주기는 psutil.cpu_percent(interval=2)의 2.0초 블로킹
# 외에도 프로세스 후보 수집을 위한 매 주기 전체 프로세스 프라이밍(실측 약
# 0.4~0.6초)과 production 업로드 네트워크 왕복(실측 약 0.6~0.9초)이 더해져,
# 부하가 없는 상태에서도 측정 간격이 2.7~4.6초까지 벌어진다(실측 근거:
# test_evaluate_overload_status_overload_candidate_with_realistic_agent_loop_gaps).
# 예전 값 4.0(= MEASURE_INTERVAL_SECONDS의 2배)은 이 실측 간격보다도 좁아서,
# 실제로 90% 이상이 계속 유지되는 상황에서도 정상 주기 간격만으로 구간이
# 끊겨 버렸다. "한 번의 측정 실패로 인한 건너뜀까지는 흡수한다"는 원래
# 취지를 유지하면서, 실제 한 주기 길이(약 4~5초)의 2배 수준으로 넉넉하게 잡는다.
MAX_SAMPLE_GAP_SECONDS = 10.0
HISTORY_WINDOW_SECONDS = 60.0

STATUS_INSUFFICIENT_DATA = "insufficient-data"
STATUS_NORMAL = "normal"
STATUS_OVERLOAD_CANDIDATE = "overload-candidate"


class CpuMeasurementError(Exception):
    pass


def is_valid_connection_code(code):
    return bool(CONNECTION_CODE_PATTERN.match(code))


def measure_cpu_percent(cpu_percent_fn):
    try:
        return cpu_percent_fn()
    except Exception as exc:
        raise CpuMeasurementError(str(exc)) from exc


def upload_measurement(
    code,
    cpu_percent,
    measured_at,
    base_url,
    http_post,
    overload_status,
    overload_evidence,
    top_process,
):
    body = {
        "code": code,
        "value": json.dumps(
            {
                "cpuPercent": cpu_percent,
                "measuredAt": measured_at,
                "overloadStatus": overload_status,
                "overloadEvidence": overload_evidence,
                "topProcess": top_process,
            }
        ),
    }
    url = f"{base_url}/api/data"

    try:
        response = http_post(url, body)
    except Exception as exc:
        return {"success": False, "error": str(exc)}

    if response.status_code == 200:
        return {"success": True}
    return {"success": False, "error": f"HTTP {response.status_code}"}


def _parse_timestamp(measured_at):
    if not isinstance(measured_at, str):
        return None
    try:
        return datetime.datetime.fromisoformat(measured_at.replace("Z", "+00:00"))
    except ValueError:
        return None


def _valid_history_entries(history):
    valid = []
    for entry in history:
        cpu_percent = entry.get("cpuPercent")
        if not isinstance(cpu_percent, (int, float)) or isinstance(cpu_percent, bool):
            continue
        timestamp = _parse_timestamp(entry.get("measuredAt"))
        if timestamp is None:
            continue
        valid.append(
            {
                "cpuPercent": float(cpu_percent),
                "measuredAt": entry["measuredAt"],
                "_timestamp": timestamp,
            }
        )
    return valid


def evaluate_overload_status(history):
    """specs/cpu-overload.md의 판정 로직 구현."""
    valid = _valid_history_entries(history)

    if len(valid) < 2:
        return {"status": STATUS_INSUFFICIENT_DATA, "evidence": None}

    qualifying_run = None
    current_run = [valid[0]] if valid[0]["cpuPercent"] >= CPU_HIGH_THRESHOLD_PERCENT else []

    for prev, curr in zip(valid, valid[1:]):
        is_high = curr["cpuPercent"] >= CPU_HIGH_THRESHOLD_PERCENT
        gap = (curr["_timestamp"] - prev["_timestamp"]).total_seconds()
        continues_run = bool(current_run) and is_high and gap <= MAX_SAMPLE_GAP_SECONDS

        if continues_run:
            current_run.append(curr)
        elif is_high:
            current_run = [curr]
        else:
            current_run = []

        if current_run:
            duration = (
                current_run[-1]["_timestamp"] - current_run[0]["_timestamp"]
            ).total_seconds()
            if duration >= MIN_SUSTAINED_SECONDS:
                qualifying_run = current_run
                break

    if qualifying_run is not None:
        duration = (
            qualifying_run[-1]["_timestamp"] - qualifying_run[0]["_timestamp"]
        ).total_seconds()
        return {
            "status": STATUS_OVERLOAD_CANDIDATE,
            "evidence": {
                "startedAt": qualifying_run[0]["measuredAt"],
                "endedAt": qualifying_run[-1]["measuredAt"],
                "durationSeconds": duration,
                "maxCpuPercent": max(e["cpuPercent"] for e in qualifying_run),
            },
        }

    last = valid[-1]
    if last["cpuPercent"] >= CPU_HIGH_THRESHOLD_PERCENT:
        return {"status": STATUS_INSUFFICIENT_DATA, "evidence": None}
    return {"status": STATUS_NORMAL, "evidence": None}


def trim_history(history, now, window_seconds=HISTORY_WINDOW_SECONDS):
    """main.py가 메모리에 유지하는 이력에서 window_seconds보다 오래된 항목을 버린다."""
    cutoff = now - datetime.timedelta(seconds=window_seconds)
    kept = []
    for entry in history:
        timestamp = _parse_timestamp(entry.get("measuredAt"))
        if timestamp is None:
            continue
        if timestamp >= cutoff:
            kept.append(entry)
    return kept


def _format_time_hms(iso_timestamp):
    timestamp = _parse_timestamp(iso_timestamp)
    return timestamp.strftime("%H:%M:%S")


def collect_process_samples(process_iter_fn):
    """specs/cpu-process-candidates.md: 프로세스별 CPU 사용률 스냅샷 수집.

    접근 불가능하거나 조회 중 사라진 프로세스는 건너뛰고 나머지로 계속한다.
    """
    samples = []
    for proc in process_iter_fn():
        try:
            pid = proc.pid
            name = proc.name()
            cpu_percent = proc.cpu_percent(None)
        except Exception:
            continue
        samples.append({"pid": pid, "name": name, "cpuPercent": cpu_percent})
    return samples


def pick_top_process(process_samples):
    if not process_samples:
        return None
    return max(process_samples, key=lambda sample: sample["cpuPercent"])


def format_overload_status_line(result):
    status = result["status"]
    if status == STATUS_INSUFFICIENT_DATA:
        return "상태: 데이터 부족"
    if status == STATUS_NORMAL:
        return "상태: 정상"

    evidence = result["evidence"]
    started = _format_time_hms(evidence["startedAt"])
    ended = _format_time_hms(evidence["endedAt"])
    return (
        f"상태: CPU 과부하 후보 ({evidence['maxCpuPercent']:.1f}%, "
        f"{started}~{ended}, {evidence['durationSeconds']:.1f}초 지속)"
    )
