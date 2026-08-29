import datetime

DISK_ACTIVE_HIGH_THRESHOLD_PERCENT = 90.0
MIN_SUSTAINED_SECONDS = 5.0
# CPU/RAM과 같은 루프 주기(같은 measured_at)에서 채워지는 이력이므로
# specs/cpu-overload.md에서 실측으로 확정한 근거를 그대로 채택한다.
MAX_SAMPLE_GAP_SECONDS = 10.0
HISTORY_WINDOW_SECONDS = 60.0

STATUS_INSUFFICIENT_DATA = "insufficient-data"
STATUS_NORMAL = "normal"
STATUS_BOTTLENECK_CANDIDATE = "bottleneck-candidate"

SYSTEM_IDLE_PROCESS_PID = 0


# --- 용량 (판정 없음, 정보 제공 전용) ---


def parse_disk_capacity(usage):
    """specs/disk-analysis.md: Disk 용량 사용률. 병목 판정을 하지 않는다."""
    try:
        total = usage.total
        used = usage.used
        free = usage.free
        percent = usage.percent
    except AttributeError:
        return None

    if any(isinstance(v, bool) for v in (total, used, free, percent)):
        return None
    if not all(isinstance(v, (int, float)) for v in (total, used, free, percent)):
        return None

    return {"totalBytes": total, "usedBytes": used, "freeBytes": free, "percent": percent}


# --- Disk I/O 활성 시간 비율 (성능 병목 판정 근거) ---


def compute_disk_active_percent(before, after, before_time, after_time):
    """두 시점의 disk_io_counters()로부터 그 구간의 디스크 활성 시간 비율(%)을 계산한다.

    100%를 넘을 수 있다 (동시에 겹치는 I/O로 인한 합산 초과) — 인위적으로
    자르지 않는다. specs/disk-analysis.md 참고.
    """
    try:
        before_busy_ms = before.read_time + before.write_time
        after_busy_ms = after.read_time + after.write_time
    except AttributeError:
        return None

    elapsed_ms = (after_time - before_time) * 1000
    if elapsed_ms <= 0:
        return None

    busy_ms = after_busy_ms - before_busy_ms
    if busy_ms < 0:
        return None

    return busy_ms / elapsed_ms * 100


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
        disk_active_percent = entry.get("diskActivePercent")
        if not isinstance(disk_active_percent, (int, float)) or isinstance(
            disk_active_percent, bool
        ):
            continue
        timestamp = _parse_timestamp(entry.get("measuredAt"))
        if timestamp is None:
            continue
        valid.append(
            {
                "diskActivePercent": float(disk_active_percent),
                "measuredAt": entry["measuredAt"],
                "_timestamp": timestamp,
            }
        )
    return valid


def evaluate_disk_io_status(history):
    """specs/disk-analysis.md의 판정 로직 (specs/cpu-overload.md와 동일 구조)."""
    valid = _valid_history_entries(history)

    if len(valid) < 2:
        return {"status": STATUS_INSUFFICIENT_DATA, "evidence": None}

    qualifying_run = None
    current_run = (
        [valid[0]] if valid[0]["diskActivePercent"] >= DISK_ACTIVE_HIGH_THRESHOLD_PERCENT else []
    )

    for prev, curr in zip(valid, valid[1:]):
        is_high = curr["diskActivePercent"] >= DISK_ACTIVE_HIGH_THRESHOLD_PERCENT
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
                "maxDiskActivePercent": max(e["diskActivePercent"] for e in qualifying_run),
            },
        }

    last = valid[-1]
    if last["diskActivePercent"] >= DISK_ACTIVE_HIGH_THRESHOLD_PERCENT:
        return {"status": STATUS_INSUFFICIENT_DATA, "evidence": None}
    return {"status": STATUS_NORMAL, "evidence": None}


# --- 프로세스별 Disk I/O 후보 ---


def collect_process_io_snapshot(process_iter_fn):
    """그 순간 각 프로세스의 누적 read/write bytes 스냅샷을 수집한다.

    접근 불가능하거나 조회 중 사라진 프로세스는 건너뛴다.
    """
    snapshot = []
    for proc in process_iter_fn():
        try:
            pid = proc.pid
            name = proc.name()
            io = proc.io_counters()
            read_bytes = io.read_bytes
            write_bytes = io.write_bytes
        except Exception:
            continue
        snapshot.append({"pid": pid, "name": name, "readBytes": read_bytes, "writeBytes": write_bytes})
    return snapshot


def compute_disk_io_deltas(before, after, elapsed_seconds):
    """두 스냅샷을 pid로 매칭해 초당 바이트(read+write)를 계산한다.

    한쪽에만 있는 pid, 음수 델타(카운터 리셋 등)는 결과에서 제외한다.
    """
    if elapsed_seconds <= 0:
        return []

    before_by_pid = {entry["pid"]: entry for entry in before}
    deltas = []
    for after_entry in after:
        pid = after_entry["pid"]
        before_entry = before_by_pid.get(pid)
        if before_entry is None:
            continue

        before_total = before_entry["readBytes"] + before_entry["writeBytes"]
        after_total = after_entry["readBytes"] + after_entry["writeBytes"]
        delta = after_total - before_total
        if delta < 0:
            continue

        deltas.append(
            {
                "pid": pid,
                "name": after_entry["name"],
                "bytesPerSec": delta / elapsed_seconds,
            }
        )
    return deltas


def pick_top_disk_io_process(delta_samples):
    """System Idle Process(PID 0)는 실제 I/O 작업이 아니므로 항상 후보에서 제외한다."""
    candidates = [s for s in delta_samples if s["pid"] != SYSTEM_IDLE_PROCESS_PID]
    if not candidates:
        return None
    return max(candidates, key=lambda sample: sample["bytesPerSec"])


def should_collect_disk_process_samples(disk_result, last_evidence_started_at):
    """Disk I/O 병목 후보로 새로 확정된 구간에 대해서만 한 번 프로세스 후보를 수집한다."""
    if disk_result["status"] != STATUS_BOTTLENECK_CANDIDATE:
        return False
    evidence_started_at = disk_result["evidence"]["startedAt"]
    return evidence_started_at != last_evidence_started_at


def _format_time_hms(iso_timestamp):
    timestamp = _parse_timestamp(iso_timestamp)
    return timestamp.strftime("%H:%M:%S")


def format_disk_io_status_line(result):
    status = result["status"]
    if status == STATUS_INSUFFICIENT_DATA:
        return "Disk I/O 상태: 데이터 부족"
    if status == STATUS_NORMAL:
        return "Disk I/O 상태: 정상"

    evidence = result["evidence"]
    started = _format_time_hms(evidence["startedAt"])
    ended = _format_time_hms(evidence["endedAt"])
    return (
        f"Disk I/O 상태: Disk I/O 병목 후보 ({evidence['maxDiskActivePercent']:.1f}%, "
        f"{started}~{ended}, {evidence['durationSeconds']:.1f}초 지속)"
    )
