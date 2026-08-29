import datetime

RAM_HIGH_THRESHOLD_PERCENT = 90.0
MIN_SUSTAINED_SECONDS = 5.0
# CPU와 같은 루프 주기(같은 measured_at)에서 채워지는 이력이므로
# specs/cpu-overload.md에서 실측으로 확정한 근거를 그대로 채택한다.
MAX_SAMPLE_GAP_SECONDS = 10.0
HISTORY_WINDOW_SECONDS = 60.0

STATUS_INSUFFICIENT_DATA = "insufficient-data"
STATUS_NORMAL = "normal"
STATUS_BOTTLENECK_CANDIDATE = "bottleneck-candidate"

SYSTEM_IDLE_PROCESS_PID = 0


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
        ram_percent = entry.get("ramPercent")
        if not isinstance(ram_percent, (int, float)) or isinstance(ram_percent, bool):
            continue
        timestamp = _parse_timestamp(entry.get("measuredAt"))
        if timestamp is None:
            continue
        valid.append(
            {
                "ramPercent": float(ram_percent),
                "measuredAt": entry["measuredAt"],
                "_timestamp": timestamp,
            }
        )
    return valid


def evaluate_ram_status(history):
    """specs/ram-analysis.md의 판정 로직 구현 (specs/cpu-overload.md와 동일 구조)."""
    valid = _valid_history_entries(history)

    if len(valid) < 2:
        return {"status": STATUS_INSUFFICIENT_DATA, "evidence": None}

    qualifying_run = None
    current_run = [valid[0]] if valid[0]["ramPercent"] >= RAM_HIGH_THRESHOLD_PERCENT else []

    for prev, curr in zip(valid, valid[1:]):
        is_high = curr["ramPercent"] >= RAM_HIGH_THRESHOLD_PERCENT
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
            "status": STATUS_BOTTLENECK_CANDIDATE,
            "evidence": {
                "startedAt": qualifying_run[0]["measuredAt"],
                "endedAt": qualifying_run[-1]["measuredAt"],
                "durationSeconds": duration,
                "maxRamPercent": max(e["ramPercent"] for e in qualifying_run),
            },
        }

    last = valid[-1]
    if last["ramPercent"] >= RAM_HIGH_THRESHOLD_PERCENT:
        return {"status": STATUS_INSUFFICIENT_DATA, "evidence": None}
    return {"status": STATUS_NORMAL, "evidence": None}


def collect_process_memory_samples(process_iter_fn):
    """specs/ram-analysis.md: 프로세스별 메모리 사용량 스냅샷 수집.

    접근 불가능하거나 조회 중 사라진 프로세스는 건너뛰고 나머지로 계속한다.
    """
    samples = []
    for proc in process_iter_fn():
        try:
            pid = proc.pid
            name = proc.name()
            rss = proc.memory_info().rss
            memory_percent = proc.memory_percent()
        except Exception:
            continue
        samples.append({"pid": pid, "name": name, "rss": rss, "memoryPercent": memory_percent})
    return samples


def pick_top_memory_process(process_samples):
    """System Idle Process(Windows PID 0)는 실제 작업으로 메모리를 점유하는
    프로세스가 아니므로 CPU 슬라이스와 동일한 이유로 항상 후보에서 제외한다."""
    candidates = [s for s in process_samples if s["pid"] != SYSTEM_IDLE_PROCESS_PID]
    if not candidates:
        return None
    return max(candidates, key=lambda sample: sample["rss"])


def should_collect_ram_process_samples(ram_result, last_evidence_started_at):
    """RAM 병목 후보로 새로 확정된 구간에 대해서만 한 번 프로세스 후보를 수집한다."""
    if ram_result["status"] != STATUS_BOTTLENECK_CANDIDATE:
        return False
    evidence_started_at = ram_result["evidence"]["startedAt"]
    return evidence_started_at != last_evidence_started_at


def _format_time_hms(iso_timestamp):
    timestamp = _parse_timestamp(iso_timestamp)
    return timestamp.strftime("%H:%M:%S")


def format_ram_status_line(result):
    status = result["status"]
    if status == STATUS_INSUFFICIENT_DATA:
        return "RAM 상태: 데이터 부족"
    if status == STATUS_NORMAL:
        return "RAM 상태: 정상"

    evidence = result["evidence"]
    started = _format_time_hms(evidence["startedAt"])
    ended = _format_time_hms(evidence["endedAt"])
    return (
        f"RAM 상태: RAM 병목 후보 ({evidence['maxRamPercent']:.1f}%, "
        f"{started}~{ended}, {evidence['durationSeconds']:.1f}초 지속)"
    )
