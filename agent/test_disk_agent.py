"""specs/disk-analysis.md의 핵심 동작을 검증하는 테스트.

아직 agent/disk_agent.py 구현이 없으므로 이 테스트들은 실패해야 정상이다.
"""

from disk_agent import (
    MAX_SAMPLE_GAP_SECONDS,
    SYSTEM_IDLE_PROCESS_PID,
    collect_process_io_snapshot,
    compute_disk_active_percent,
    compute_disk_io_deltas,
    evaluate_disk_io_status,
    format_disk_io_status_line,
    parse_disk_capacity,
    pick_top_disk_io_process,
    should_collect_disk_process_samples,
)


# --- parse_disk_capacity (용량, 병목 판정과 완전히 분리) ---


class FakeDiskUsage:
    def __init__(self, total, used, free, percent):
        self.total = total
        self.used = used
        self.free = free
        self.percent = percent


def test_parse_disk_capacity_returns_bytes_and_percent():
    usage = FakeDiskUsage(total=100, used=90, free=10, percent=90.0)
    result = parse_disk_capacity(usage)
    assert result == {"totalBytes": 100, "usedBytes": 90, "freeBytes": 10, "percent": 90.0}


def test_parse_disk_capacity_result_has_no_status_field():
    """용량 정보에는 '병목' 개념이 없다 — status 키 자체가 존재하면 안 된다."""
    usage = FakeDiskUsage(total=100, used=90, free=10, percent=90.0)
    result = parse_disk_capacity(usage)
    assert "status" not in result


def test_parse_disk_capacity_returns_none_when_missing_field():
    class Incomplete:
        total = 100
        used = 90
        # free, percent 없음

    assert parse_disk_capacity(Incomplete()) is None


def test_parse_disk_capacity_returns_none_when_percent_is_wrong_type():
    usage = FakeDiskUsage(total=100, used=90, free=10, percent="많음")
    assert parse_disk_capacity(usage) is None


# --- compute_disk_active_percent ---


class FakeDiskIoCounters:
    def __init__(self, read_time, write_time):
        self.read_time = read_time
        self.write_time = write_time


def test_compute_disk_active_percent_normal_case():
    before = FakeDiskIoCounters(read_time=1000, write_time=500)
    after = FakeDiskIoCounters(read_time=1900, write_time=600)
    # busy_ms = (1900+600) - (1000+500) = 1000, elapsed = 2000ms -> 50%
    percent = compute_disk_active_percent(before, after, before_time=0.0, after_time=2.0)
    assert percent == 50.0


def test_compute_disk_active_percent_can_exceed_100_percent():
    before = FakeDiskIoCounters(read_time=0, write_time=0)
    after = FakeDiskIoCounters(read_time=2500, write_time=1000)
    # busy_ms = 3500, elapsed = 2000ms -> 175%
    percent = compute_disk_active_percent(before, after, before_time=0.0, after_time=2.0)
    assert percent == 175.0


def test_compute_disk_active_percent_returns_none_when_elapsed_not_positive():
    before = FakeDiskIoCounters(read_time=0, write_time=0)
    after = FakeDiskIoCounters(read_time=100, write_time=0)
    assert compute_disk_active_percent(before, after, before_time=2.0, after_time=2.0) is None
    assert compute_disk_active_percent(before, after, before_time=2.0, after_time=1.0) is None


def test_compute_disk_active_percent_returns_none_when_busy_time_goes_backwards():
    before = FakeDiskIoCounters(read_time=1000, write_time=1000)
    after = FakeDiskIoCounters(read_time=100, write_time=100)  # 카운터 리셋(비정상)
    assert compute_disk_active_percent(before, after, before_time=0.0, after_time=1.0) is None


def test_compute_disk_active_percent_returns_none_when_field_missing():
    class Incomplete:
        read_time = 100
        # write_time 없음

    assert compute_disk_active_percent(Incomplete(), Incomplete(), 0.0, 1.0) is None


# --- evaluate_disk_io_status ---


def test_evaluate_disk_io_status_insufficient_data_when_history_empty():
    assert evaluate_disk_io_status([]) == {"status": "insufficient-data", "evidence": None}


def test_evaluate_disk_io_status_insufficient_data_when_single_entry():
    history = [{"diskActivePercent": 95.0, "measuredAt": "2026-08-29T07:00:00Z"}]
    assert evaluate_disk_io_status(history) == {"status": "insufficient-data", "evidence": None}


def test_evaluate_disk_io_status_normal_when_all_low():
    history = [
        {"diskActivePercent": 5.0, "measuredAt": "2026-08-29T07:00:00Z"},
        {"diskActivePercent": 10.0, "measuredAt": "2026-08-29T07:00:02Z"},
        {"diskActivePercent": 8.0, "measuredAt": "2026-08-29T07:00:04Z"},
    ]
    assert evaluate_disk_io_status(history) == {"status": "normal", "evidence": None}


def test_evaluate_disk_io_status_bottleneck_candidate_when_sustained_6_seconds():
    history = [
        {"diskActivePercent": 95.0, "measuredAt": "2026-08-29T07:00:00Z"},
        {"diskActivePercent": 96.0, "measuredAt": "2026-08-29T07:00:02Z"},
        {"diskActivePercent": 97.0, "measuredAt": "2026-08-29T07:00:04Z"},
        {"diskActivePercent": 98.2, "measuredAt": "2026-08-29T07:00:06Z"},
    ]
    result = evaluate_disk_io_status(history)
    assert result["status"] == "bottleneck-candidate"
    assert result["evidence"] == {
        "startedAt": "2026-08-29T07:00:00Z",
        "endedAt": "2026-08-29T07:00:06Z",
        "durationSeconds": 6.0,
        "maxDiskActivePercent": 98.2,
    }


# --- threshold boundary ---


def test_evaluate_disk_io_status_boundary_89_9_percent_is_not_high():
    history = [
        {"diskActivePercent": 89.9, "measuredAt": "2026-08-29T07:00:00Z"},
        {"diskActivePercent": 89.9, "measuredAt": "2026-08-29T07:00:02Z"},
        {"diskActivePercent": 89.9, "measuredAt": "2026-08-29T07:00:04Z"},
        {"diskActivePercent": 89.9, "measuredAt": "2026-08-29T07:00:06Z"},
    ]
    assert evaluate_disk_io_status(history) == {"status": "normal", "evidence": None}


def test_evaluate_disk_io_status_boundary_exactly_5_seconds_is_sustained():
    history = [
        {"diskActivePercent": 90.0, "measuredAt": "2026-08-29T07:00:00Z"},
        {"diskActivePercent": 90.0, "measuredAt": "2026-08-29T07:00:02Z"},
        {"diskActivePercent": 90.0, "measuredAt": "2026-08-29T07:00:05Z"},
    ]
    result = evaluate_disk_io_status(history)
    assert result["status"] == "bottleneck-candidate"
    assert result["evidence"]["durationSeconds"] == 5.0


def test_evaluate_disk_io_status_gap_over_max_seconds_breaks_run():
    over_gap = MAX_SAMPLE_GAP_SECONDS + 0.1
    history = [
        {"diskActivePercent": 95.0, "measuredAt": "2026-08-29T07:00:00Z"},
        {"diskActivePercent": 95.0, "measuredAt": "2026-08-29T07:00:02Z"},
        {
            "diskActivePercent": 95.0,
            "measuredAt": f"2026-08-29T07:00:{2 + over_gap:06.3f}Z",
        },
    ]
    assert evaluate_disk_io_status(history) == {"status": "insufficient-data", "evidence": None}


def test_evaluate_disk_io_status_value_over_100_percent_counts_as_high():
    """활성 시간 비율은 100%를 넘을 수 있고, 넘는 값도 당연히 임계값 이상으로 취급한다."""
    history = [
        {"diskActivePercent": 150.0, "measuredAt": "2026-08-29T07:00:00Z"},
        {"diskActivePercent": 175.0, "measuredAt": "2026-08-29T07:00:02Z"},
        {"diskActivePercent": 160.0, "measuredAt": "2026-08-29T07:00:05Z"},
    ]
    result = evaluate_disk_io_status(history)
    assert result["status"] == "bottleneck-candidate"
    assert result["evidence"]["maxDiskActivePercent"] == 175.0


# --- malformed / missing data ---


def test_evaluate_disk_io_status_ignores_entries_with_invalid_percent():
    history = [
        {"diskActivePercent": 95.0, "measuredAt": "2026-08-29T07:00:00Z"},
        {"diskActivePercent": "높음", "measuredAt": "2026-08-29T07:00:02Z"},
        {"diskActivePercent": 95.0, "measuredAt": "2026-08-29T07:00:04Z"},
    ]
    assert evaluate_disk_io_status(history) == {"status": "insufficient-data", "evidence": None}


def test_evaluate_disk_io_status_ignores_entries_missing_field():
    history = [
        {"measuredAt": "2026-08-29T07:00:00Z"},
        {"diskActivePercent": 5.0, "measuredAt": "2026-08-29T07:00:02Z"},
        {"diskActivePercent": 5.0, "measuredAt": "2026-08-29T07:00:04Z"},
    ]
    assert evaluate_disk_io_status(history) == {"status": "normal", "evidence": None}


# --- collect_process_io_snapshot / compute_disk_io_deltas / pick_top_disk_io_process ---


class FakeIoProcess:
    def __init__(self, pid, name, read_bytes, write_bytes, raises=None):
        self.pid = pid
        self._name = name
        self._read_bytes = read_bytes
        self._write_bytes = write_bytes
        self._raises = raises

    def name(self):
        if self._raises == "name":
            raise Exception("access denied")
        return self._name

    def io_counters(self):
        if self._raises == "io_counters":
            raise Exception("access denied")

        class Io:
            read_bytes = self._read_bytes
            write_bytes = self._write_bytes

        return Io()


def test_collect_process_io_snapshot_returns_pid_name_bytes():
    processes = [FakeIoProcess(pid=1, name="chrome.exe", read_bytes=1000, write_bytes=500)]
    snapshot = collect_process_io_snapshot(lambda: processes)
    assert snapshot == [{"pid": 1, "name": "chrome.exe", "readBytes": 1000, "writeBytes": 500}]


def test_collect_process_io_snapshot_skips_process_that_raises():
    processes = [
        FakeIoProcess(pid=1, name="chrome.exe", read_bytes=1, write_bytes=1, raises="io_counters"),
        FakeIoProcess(pid=2, name="python.exe", read_bytes=2, write_bytes=2),
    ]
    snapshot = collect_process_io_snapshot(lambda: processes)
    assert snapshot == [{"pid": 2, "name": "python.exe", "readBytes": 2, "writeBytes": 2}]


def test_collect_process_io_snapshot_returns_empty_when_no_processes():
    assert collect_process_io_snapshot(lambda: []) == []


def test_compute_disk_io_deltas_computes_bytes_per_second():
    before = [{"pid": 1, "name": "chrome.exe", "readBytes": 1000, "writeBytes": 0}]
    after = [{"pid": 1, "name": "chrome.exe", "readBytes": 3000, "writeBytes": 1000}]
    # delta = (3000+1000) - (1000+0) = 3000 bytes over 1s -> 3000 B/s
    deltas = compute_disk_io_deltas(before, after, elapsed_seconds=1.0)
    assert deltas == [{"pid": 1, "name": "chrome.exe", "bytesPerSec": 3000.0}]


def test_compute_disk_io_deltas_skips_pid_missing_from_one_snapshot():
    before = [{"pid": 1, "name": "chrome.exe", "readBytes": 1000, "writeBytes": 0}]
    after = [
        {"pid": 1, "name": "chrome.exe", "readBytes": 2000, "writeBytes": 0},
        {"pid": 2, "name": "new.exe", "readBytes": 500, "writeBytes": 0},
    ]
    deltas = compute_disk_io_deltas(before, after, elapsed_seconds=1.0)
    assert deltas == [{"pid": 1, "name": "chrome.exe", "bytesPerSec": 1000.0}]


def test_compute_disk_io_deltas_skips_negative_delta():
    before = [{"pid": 1, "name": "chrome.exe", "readBytes": 5000, "writeBytes": 0}]
    after = [{"pid": 1, "name": "chrome.exe", "readBytes": 1000, "writeBytes": 0}]
    deltas = compute_disk_io_deltas(before, after, elapsed_seconds=1.0)
    assert deltas == []


def test_compute_disk_io_deltas_returns_empty_when_elapsed_not_positive():
    before = [{"pid": 1, "name": "chrome.exe", "readBytes": 1000, "writeBytes": 0}]
    after = [{"pid": 1, "name": "chrome.exe", "readBytes": 2000, "writeBytes": 0}]
    assert compute_disk_io_deltas(before, after, elapsed_seconds=0.0) == []


def test_pick_top_disk_io_process_returns_none_when_empty():
    assert pick_top_disk_io_process([]) is None


def test_pick_top_disk_io_process_returns_highest_bytes_per_sec():
    samples = [
        {"pid": 1, "name": "chrome.exe", "bytesPerSec": 500.0},
        {"pid": 2, "name": "python.exe", "bytesPerSec": 9000.0},
    ]
    assert pick_top_disk_io_process(samples) == {"pid": 2, "name": "python.exe", "bytesPerSec": 9000.0}


def test_pick_top_disk_io_process_returns_first_on_tie():
    samples = [
        {"pid": 1, "name": "a.exe", "bytesPerSec": 100.0},
        {"pid": 2, "name": "b.exe", "bytesPerSec": 100.0},
    ]
    assert pick_top_disk_io_process(samples) == {"pid": 1, "name": "a.exe", "bytesPerSec": 100.0}


def test_pick_top_disk_io_process_excludes_system_idle_process_even_if_highest():
    samples = [
        {"pid": SYSTEM_IDLE_PROCESS_PID, "name": "System Idle Process", "bytesPerSec": 999999.0},
        {"pid": 4, "name": "System", "bytesPerSec": 5000.0},
    ]
    assert pick_top_disk_io_process(samples) == {"pid": 4, "name": "System", "bytesPerSec": 5000.0}


def test_pick_top_disk_io_process_returns_none_when_only_system_idle_process():
    samples = [{"pid": SYSTEM_IDLE_PROCESS_PID, "name": "System Idle Process", "bytesPerSec": 999999.0}]
    assert pick_top_disk_io_process(samples) is None


# --- should_collect_disk_process_samples ---


def test_should_collect_disk_process_samples_false_when_not_bottleneck_candidate():
    result = {"status": "normal", "evidence": None}
    assert should_collect_disk_process_samples(result, last_evidence_started_at=None) is False


def test_should_collect_disk_process_samples_true_on_first_detection():
    result = {
        "status": "bottleneck-candidate",
        "evidence": {"startedAt": "2026-08-29T00:00:00Z", "endedAt": "x", "durationSeconds": 6, "maxDiskActivePercent": 95},
    }
    assert should_collect_disk_process_samples(result, last_evidence_started_at=None) is True


def test_should_collect_disk_process_samples_false_when_same_episode_already_collected():
    result = {
        "status": "bottleneck-candidate",
        "evidence": {"startedAt": "2026-08-29T00:00:00Z", "endedAt": "x", "durationSeconds": 6, "maxDiskActivePercent": 95},
    }
    assert (
        should_collect_disk_process_samples(result, last_evidence_started_at="2026-08-29T00:00:00Z")
        is False
    )


# --- format_disk_io_status_line ---


def test_format_disk_io_status_line_insufficient_data():
    assert format_disk_io_status_line({"status": "insufficient-data", "evidence": None}) == "Disk I/O 상태: 데이터 부족"


def test_format_disk_io_status_line_normal():
    assert format_disk_io_status_line({"status": "normal", "evidence": None}) == "Disk I/O 상태: 정상"


def test_format_disk_io_status_line_bottleneck_candidate():
    result = {
        "status": "bottleneck-candidate",
        "evidence": {
            "startedAt": "2026-08-29T07:00:00Z",
            "endedAt": "2026-08-29T07:00:06Z",
            "durationSeconds": 6.0,
            "maxDiskActivePercent": 175.0,
        },
    }
    line = format_disk_io_status_line(result)
    assert line == "Disk I/O 상태: Disk I/O 병목 후보 (175.0%, 07:00:00~07:00:06, 6.0초 지속)"
