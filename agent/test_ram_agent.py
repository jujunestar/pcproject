"""specs/ram-analysis.md의 핵심 동작을 검증하는 테스트.

아직 agent/ram_agent.py 구현이 없으므로 이 테스트들은 실패해야 정상이다.
"""

from ram_agent import (
    MAX_SAMPLE_GAP_SECONDS,
    SYSTEM_IDLE_PROCESS_PID,
    collect_process_memory_samples,
    evaluate_ram_status,
    format_ram_status_line,
    pick_top_memory_process,
    should_collect_ram_process_samples,
)


# --- evaluate_ram_status ---


def test_evaluate_ram_status_insufficient_data_when_history_empty():
    result = evaluate_ram_status([])
    assert result == {"status": "insufficient-data", "evidence": None}


def test_evaluate_ram_status_insufficient_data_when_single_entry():
    history = [{"ramPercent": 95.0, "measuredAt": "2026-08-29T07:00:00Z"}]
    result = evaluate_ram_status(history)
    assert result == {"status": "insufficient-data", "evidence": None}


def test_evaluate_ram_status_normal_when_all_low():
    history = [
        {"ramPercent": 40.0, "measuredAt": "2026-08-29T07:00:00Z"},
        {"ramPercent": 50.0, "measuredAt": "2026-08-29T07:00:02Z"},
        {"ramPercent": 45.0, "measuredAt": "2026-08-29T07:00:04Z"},
    ]
    result = evaluate_ram_status(history)
    assert result == {"status": "normal", "evidence": None}


def test_evaluate_ram_status_insufficient_data_when_high_run_not_yet_5_seconds():
    history = [
        {"ramPercent": 95.0, "measuredAt": "2026-08-29T07:00:00Z"},
        {"ramPercent": 96.0, "measuredAt": "2026-08-29T07:00:02Z"},
        {"ramPercent": 97.0, "measuredAt": "2026-08-29T07:00:04Z"},
    ]
    result = evaluate_ram_status(history)
    assert result == {"status": "insufficient-data", "evidence": None}


def test_evaluate_ram_status_bottleneck_candidate_when_sustained_6_seconds():
    history = [
        {"ramPercent": 95.0, "measuredAt": "2026-08-29T07:00:00Z"},
        {"ramPercent": 96.0, "measuredAt": "2026-08-29T07:00:02Z"},
        {"ramPercent": 97.0, "measuredAt": "2026-08-29T07:00:04Z"},
        {"ramPercent": 98.2, "measuredAt": "2026-08-29T07:00:06Z"},
    ]
    result = evaluate_ram_status(history)
    assert result["status"] == "bottleneck-candidate"
    assert result["evidence"] == {
        "startedAt": "2026-08-29T07:00:00Z",
        "endedAt": "2026-08-29T07:00:06Z",
        "durationSeconds": 6.0,
        "maxRamPercent": 98.2,
    }


def test_evaluate_ram_status_normal_when_high_run_ends_before_5_seconds():
    history = [
        {"ramPercent": 95.0, "measuredAt": "2026-08-29T07:00:00Z"},
        {"ramPercent": 96.0, "measuredAt": "2026-08-29T07:00:02Z"},
        {"ramPercent": 97.0, "measuredAt": "2026-08-29T07:00:04Z"},
        {"ramPercent": 40.0, "measuredAt": "2026-08-29T07:00:06Z"},
    ]
    result = evaluate_ram_status(history)
    assert result == {"status": "normal", "evidence": None}


# --- threshold boundary ---


def test_evaluate_ram_status_boundary_89_9_percent_is_not_high():
    history = [
        {"ramPercent": 89.9, "measuredAt": "2026-08-29T07:00:00Z"},
        {"ramPercent": 89.9, "measuredAt": "2026-08-29T07:00:02Z"},
        {"ramPercent": 89.9, "measuredAt": "2026-08-29T07:00:04Z"},
        {"ramPercent": 89.9, "measuredAt": "2026-08-29T07:00:06Z"},
    ]
    result = evaluate_ram_status(history)
    assert result == {"status": "normal", "evidence": None}


def test_evaluate_ram_status_boundary_exactly_90_percent_is_high():
    history = [
        {"ramPercent": 90.0, "measuredAt": "2026-08-29T07:00:00Z"},
        {"ramPercent": 90.0, "measuredAt": "2026-08-29T07:00:02Z"},
        {"ramPercent": 90.0, "measuredAt": "2026-08-29T07:00:05Z"},
    ]
    result = evaluate_ram_status(history)
    assert result["status"] == "bottleneck-candidate"
    assert result["evidence"]["durationSeconds"] == 5.0


def test_evaluate_ram_status_boundary_under_5_seconds_is_not_sustained():
    history = [
        {"ramPercent": 90.0, "measuredAt": "2026-08-29T07:00:00Z"},
        {"ramPercent": 90.0, "measuredAt": "2026-08-29T07:00:04Z"},
        {"ramPercent": 40.0, "measuredAt": "2026-08-29T07:00:06Z"},
    ]
    result = evaluate_ram_status(history)
    assert result == {"status": "normal", "evidence": None}


def test_evaluate_ram_status_gap_over_max_seconds_breaks_run():
    over_gap = MAX_SAMPLE_GAP_SECONDS + 0.1
    history = [
        {"ramPercent": 95.0, "measuredAt": "2026-08-29T07:00:00Z"},
        {"ramPercent": 95.0, "measuredAt": "2026-08-29T07:00:02Z"},
        {
            "ramPercent": 95.0,
            "measuredAt": f"2026-08-29T07:00:{2 + over_gap:06.3f}Z",
        },
    ]
    result = evaluate_ram_status(history)
    assert result == {"status": "insufficient-data", "evidence": None}


def test_evaluate_ram_status_stays_bottleneck_candidate_after_values_drop():
    history = [
        {"ramPercent": 95.0, "measuredAt": "2026-08-29T07:00:00Z"},
        {"ramPercent": 95.0, "measuredAt": "2026-08-29T07:00:02Z"},
        {"ramPercent": 95.0, "measuredAt": "2026-08-29T07:00:04Z"},
        {"ramPercent": 95.0, "measuredAt": "2026-08-29T07:00:06Z"},
        {"ramPercent": 30.0, "measuredAt": "2026-08-29T07:00:08Z"},
    ]
    result = evaluate_ram_status(history)
    assert result["status"] == "bottleneck-candidate"


# --- malformed / missing data ---


def test_evaluate_ram_status_ignores_entries_with_invalid_ram_percent():
    history = [
        {"ramPercent": 95.0, "measuredAt": "2026-08-29T07:00:00Z"},
        {"ramPercent": "높음", "measuredAt": "2026-08-29T07:00:02Z"},
        {"ramPercent": 95.0, "measuredAt": "2026-08-29T07:00:04Z"},
    ]
    result = evaluate_ram_status(history)
    assert result == {"status": "insufficient-data", "evidence": None}


def test_evaluate_ram_status_ignores_entries_with_unparseable_timestamp():
    history = [
        {"ramPercent": 40.0, "measuredAt": "이건 시각이 아님"},
        {"ramPercent": 40.0, "measuredAt": "2026-08-29T07:00:00Z"},
        {"ramPercent": 45.0, "measuredAt": "2026-08-29T07:00:02Z"},
    ]
    result = evaluate_ram_status(history)
    assert result == {"status": "normal", "evidence": None}


def test_evaluate_ram_status_ignores_entries_missing_ram_percent_field():
    history = [
        {"measuredAt": "2026-08-29T07:00:00Z"},
        {"ramPercent": 40.0, "measuredAt": "2026-08-29T07:00:02Z"},
        {"ramPercent": 45.0, "measuredAt": "2026-08-29T07:00:04Z"},
    ]
    result = evaluate_ram_status(history)
    assert result == {"status": "normal", "evidence": None}


# --- collect_process_memory_samples / pick_top_memory_process ---


class FakeProcess:
    def __init__(self, pid, name, rss, memory_percent, raises=None):
        self.pid = pid
        self._name = name
        self._rss = rss
        self._memory_percent = memory_percent
        self._raises = raises

    def name(self):
        if self._raises == "name":
            raise Exception("access denied")
        return self._name

    def memory_info(self):
        if self._raises == "memory_info":
            raise Exception("process no longer exists")

        class Info:
            rss = self._rss

        return Info()

    def memory_percent(self):
        if self._raises == "memory_percent":
            raise Exception("access denied")
        return self._memory_percent


def test_collect_process_memory_samples_returns_pid_name_rss_percent():
    processes = [FakeProcess(pid=1, name="chrome.exe", rss=500_000_000, memory_percent=3.1)]

    samples = collect_process_memory_samples(lambda: processes)

    assert samples == [
        {"pid": 1, "name": "chrome.exe", "rss": 500_000_000, "memoryPercent": 3.1}
    ]


def test_collect_process_memory_samples_skips_process_that_raises_on_name():
    processes = [
        FakeProcess(pid=1, name="chrome.exe", rss=1, memory_percent=1.0, raises="name"),
        FakeProcess(pid=2, name="python.exe", rss=2, memory_percent=2.0),
    ]

    samples = collect_process_memory_samples(lambda: processes)

    assert samples == [{"pid": 2, "name": "python.exe", "rss": 2, "memoryPercent": 2.0}]


def test_collect_process_memory_samples_skips_process_that_raises_on_memory_info():
    processes = [
        FakeProcess(pid=1, name="chrome.exe", rss=1, memory_percent=1.0, raises="memory_info"),
        FakeProcess(pid=2, name="python.exe", rss=2, memory_percent=2.0),
    ]

    samples = collect_process_memory_samples(lambda: processes)

    assert samples == [{"pid": 2, "name": "python.exe", "rss": 2, "memoryPercent": 2.0}]


def test_collect_process_memory_samples_returns_empty_list_when_no_processes():
    samples = collect_process_memory_samples(lambda: [])
    assert samples == []


def test_collect_process_memory_samples_returns_empty_list_when_all_processes_fail():
    processes = [
        FakeProcess(pid=1, name="a.exe", rss=1, memory_percent=1.0, raises="name"),
        FakeProcess(pid=2, name="b.exe", rss=1, memory_percent=1.0, raises="memory_percent"),
    ]
    samples = collect_process_memory_samples(lambda: processes)
    assert samples == []


def test_pick_top_memory_process_returns_none_when_empty():
    assert pick_top_memory_process([]) is None


def test_pick_top_memory_process_returns_highest_rss():
    samples = [
        {"pid": 1, "name": "chrome.exe", "rss": 500, "memoryPercent": 3.1},
        {"pid": 2, "name": "python.exe", "rss": 9000, "memoryPercent": 20.0},
        {"pid": 3, "name": "explorer.exe", "rss": 100, "memoryPercent": 0.5},
    ]
    assert pick_top_memory_process(samples) == {
        "pid": 2,
        "name": "python.exe",
        "rss": 9000,
        "memoryPercent": 20.0,
    }


def test_pick_top_memory_process_returns_first_on_tie():
    samples = [
        {"pid": 1, "name": "a.exe", "rss": 500, "memoryPercent": 1.0},
        {"pid": 2, "name": "b.exe", "rss": 500, "memoryPercent": 1.0},
    ]
    assert pick_top_memory_process(samples) == {
        "pid": 1,
        "name": "a.exe",
        "rss": 500,
        "memoryPercent": 1.0,
    }


def test_pick_top_memory_process_excludes_system_idle_process_even_if_highest():
    samples = [
        {"pid": SYSTEM_IDLE_PROCESS_PID, "name": "System Idle Process", "rss": 999_999_999, "memoryPercent": 99.0},
        {"pid": 1234, "name": "chrome.exe", "rss": 500_000_000, "memoryPercent": 3.1},
    ]
    assert pick_top_memory_process(samples) == {
        "pid": 1234,
        "name": "chrome.exe",
        "rss": 500_000_000,
        "memoryPercent": 3.1,
    }


def test_pick_top_memory_process_returns_none_when_only_system_idle_process():
    samples = [
        {"pid": SYSTEM_IDLE_PROCESS_PID, "name": "System Idle Process", "rss": 999, "memoryPercent": 99.0}
    ]
    assert pick_top_memory_process(samples) is None


# --- should_collect_ram_process_samples ---


def test_should_collect_ram_process_samples_false_when_not_bottleneck_candidate():
    result = {"status": "normal", "evidence": None}
    assert should_collect_ram_process_samples(result, last_evidence_started_at=None) is False


def test_should_collect_ram_process_samples_false_for_insufficient_data():
    result = {"status": "insufficient-data", "evidence": None}
    assert should_collect_ram_process_samples(result, last_evidence_started_at=None) is False


def test_should_collect_ram_process_samples_true_on_first_detection():
    result = {
        "status": "bottleneck-candidate",
        "evidence": {"startedAt": "2026-08-29T00:00:00Z", "endedAt": "x", "durationSeconds": 6, "maxRamPercent": 95},
    }
    assert should_collect_ram_process_samples(result, last_evidence_started_at=None) is True


def test_should_collect_ram_process_samples_false_when_same_episode_already_collected():
    result = {
        "status": "bottleneck-candidate",
        "evidence": {"startedAt": "2026-08-29T00:00:00Z", "endedAt": "x", "durationSeconds": 6, "maxRamPercent": 95},
    }
    assert (
        should_collect_ram_process_samples(result, last_evidence_started_at="2026-08-29T00:00:00Z")
        is False
    )


def test_should_collect_ram_process_samples_true_when_new_episode_starts():
    result = {
        "status": "bottleneck-candidate",
        "evidence": {"startedAt": "2026-08-29T00:05:00Z", "endedAt": "x", "durationSeconds": 6, "maxRamPercent": 95},
    }
    assert (
        should_collect_ram_process_samples(result, last_evidence_started_at="2026-08-29T00:00:00Z")
        is True
    )


# --- format_ram_status_line ---


def test_format_ram_status_line_insufficient_data():
    line = format_ram_status_line({"status": "insufficient-data", "evidence": None})
    assert line == "RAM 상태: 데이터 부족"


def test_format_ram_status_line_normal():
    line = format_ram_status_line({"status": "normal", "evidence": None})
    assert line == "RAM 상태: 정상"


def test_format_ram_status_line_bottleneck_candidate():
    result = {
        "status": "bottleneck-candidate",
        "evidence": {
            "startedAt": "2026-08-29T07:00:00Z",
            "endedAt": "2026-08-29T07:00:06Z",
            "durationSeconds": 6.0,
            "maxRamPercent": 98.2,
        },
    }
    line = format_ram_status_line(result)
    assert line == "RAM 상태: RAM 병목 후보 (98.2%, 07:00:00~07:00:06, 6.0초 지속)"
