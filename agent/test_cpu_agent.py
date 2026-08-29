"""specs/cpu-agent.md의 핵심 동작을 검증하는 테스트.

아직 agent/cpu_agent.py 구현이 없으므로 이 테스트들은 실패해야 정상이다.
"""

import json

import pytest

from cpu_agent import (
    CpuMeasurementError,
    collect_process_samples,
    evaluate_overload_status,
    format_overload_status_line,
    is_valid_connection_code,
    measure_cpu_percent,
    pick_top_process,
    should_collect_process_samples,
    trim_history,
    upload_measurement,
)


class FakeResponse:
    def __init__(self, status_code):
        self.status_code = status_code


def test_six_char_alnum_code_is_valid():
    assert is_valid_connection_code("AB12CD") is True


def test_five_char_code_is_invalid():
    assert is_valid_connection_code("AB12C") is False


def test_seven_char_code_is_invalid():
    assert is_valid_connection_code("AB12CDE") is False


def test_code_with_special_character_is_invalid():
    assert is_valid_connection_code("AB12C!") is False


def test_measure_cpu_percent_returns_value_from_psutil():
    value = measure_cpu_percent(cpu_percent_fn=lambda: 37.2)
    assert value == 37.2


def test_measure_cpu_percent_raises_on_psutil_failure():
    def failing_cpu_percent():
        raise OSError("psutil unavailable")

    with pytest.raises(CpuMeasurementError):
        measure_cpu_percent(cpu_percent_fn=failing_cpu_percent)


def test_upload_measurement_sends_code_and_cpu_value():
    calls = []

    def fake_post(url, json_body):
        calls.append((url, json_body))
        return FakeResponse(status_code=200)

    upload_measurement(
        code="AB12CD",
        cpu_percent=42.5,
        measured_at="2026-08-27T00:00:00Z",
        base_url="https://pcproject-tau.vercel.app",
        http_post=fake_post,
        overload_status="insufficient-data",
        overload_evidence=None,
        top_process=None,
    )

    assert len(calls) == 1
    url, body = calls[0]
    assert url == "https://pcproject-tau.vercel.app/api/data"
    assert body["code"] == "AB12CD"
    value = json.loads(body["value"])
    assert value["cpuPercent"] == 42.5
    assert value["measuredAt"] == "2026-08-27T00:00:00Z"


def test_upload_measurement_includes_overload_analysis_in_payload():
    calls = []

    def fake_post(url, json_body):
        calls.append((url, json_body))
        return FakeResponse(status_code=200)

    upload_measurement(
        code="AB12CD",
        cpu_percent=98.2,
        measured_at="2026-08-27T07:00:06Z",
        base_url="https://pcproject-tau.vercel.app",
        http_post=fake_post,
        overload_status="overload-candidate",
        overload_evidence={
            "startedAt": "2026-08-27T07:00:00Z",
            "endedAt": "2026-08-27T07:00:06Z",
            "durationSeconds": 6.0,
            "maxCpuPercent": 98.2,
        },
        top_process={"pid": 1234, "name": "chrome.exe", "cpuPercent": 55.3},
    )

    value = json.loads(calls[0][1]["value"])
    assert value["overloadStatus"] == "overload-candidate"
    assert value["overloadEvidence"] == {
        "startedAt": "2026-08-27T07:00:00Z",
        "endedAt": "2026-08-27T07:00:06Z",
        "durationSeconds": 6.0,
        "maxCpuPercent": 98.2,
    }
    assert value["topProcess"] == {"pid": 1234, "name": "chrome.exe", "cpuPercent": 55.3}


def test_upload_measurement_reports_success_on_ok_response():
    result = upload_measurement(
        code="AB12CD",
        cpu_percent=10.0,
        measured_at="2026-08-27T00:00:00Z",
        base_url="https://pcproject-tau.vercel.app",
        http_post=lambda url, json_body: FakeResponse(status_code=200),
        overload_status="normal",
        overload_evidence=None,
        top_process=None,
    )

    assert result["success"] is True


def test_upload_measurement_reports_failure_on_error_response():
    result = upload_measurement(
        code="AB12CD",
        cpu_percent=10.0,
        measured_at="2026-08-27T00:00:00Z",
        base_url="https://pcproject-tau.vercel.app",
        http_post=lambda url, json_body: FakeResponse(status_code=500),
        overload_status="normal",
        overload_evidence=None,
        top_process=None,
    )

    assert result["success"] is False
    assert "error" in result


def test_upload_measurement_reports_failure_on_connection_error():
    def raising_post(url, json_body):
        raise ConnectionError("network unreachable")

    result = upload_measurement(
        code="AB12CD",
        cpu_percent=10.0,
        measured_at="2026-08-27T00:00:00Z",
        base_url="https://pcproject-tau.vercel.app",
        http_post=raising_post,
        overload_status="normal",
        overload_evidence=None,
        top_process=None,
    )

    assert result["success"] is False
    assert "error" in result


# --- evaluate_overload_status (specs/cpu-overload.md) ---


def test_evaluate_overload_status_insufficient_data_when_history_empty():
    result = evaluate_overload_status([])
    assert result == {"status": "insufficient-data", "evidence": None}


def test_evaluate_overload_status_insufficient_data_when_single_entry():
    history = [{"cpuPercent": 95.0, "measuredAt": "2026-08-27T07:00:00Z"}]
    result = evaluate_overload_status(history)
    assert result == {"status": "insufficient-data", "evidence": None}


def test_evaluate_overload_status_normal_when_all_low():
    history = [
        {"cpuPercent": 10.0, "measuredAt": "2026-08-27T07:00:00Z"},
        {"cpuPercent": 20.0, "measuredAt": "2026-08-27T07:00:02Z"},
        {"cpuPercent": 15.0, "measuredAt": "2026-08-27T07:00:04Z"},
    ]
    result = evaluate_overload_status(history)
    assert result == {"status": "normal", "evidence": None}


def test_evaluate_overload_status_insufficient_data_when_high_run_not_yet_5_seconds():
    history = [
        {"cpuPercent": 95.0, "measuredAt": "2026-08-27T07:00:00Z"},
        {"cpuPercent": 96.0, "measuredAt": "2026-08-27T07:00:02Z"},
        {"cpuPercent": 97.0, "measuredAt": "2026-08-27T07:00:04Z"},
    ]
    result = evaluate_overload_status(history)
    assert result == {"status": "insufficient-data", "evidence": None}


def test_evaluate_overload_status_overload_candidate_when_sustained_6_seconds():
    history = [
        {"cpuPercent": 95.0, "measuredAt": "2026-08-27T07:00:00Z"},
        {"cpuPercent": 96.0, "measuredAt": "2026-08-27T07:00:02Z"},
        {"cpuPercent": 97.0, "measuredAt": "2026-08-27T07:00:04Z"},
        {"cpuPercent": 98.2, "measuredAt": "2026-08-27T07:00:06Z"},
    ]
    result = evaluate_overload_status(history)
    assert result["status"] == "overload-candidate"
    assert result["evidence"] == {
        "startedAt": "2026-08-27T07:00:00Z",
        "endedAt": "2026-08-27T07:00:06Z",
        "durationSeconds": 6.0,
        "maxCpuPercent": 98.2,
    }


def test_evaluate_overload_status_normal_when_high_run_ends_before_5_seconds():
    history = [
        {"cpuPercent": 95.0, "measuredAt": "2026-08-27T07:00:00Z"},
        {"cpuPercent": 96.0, "measuredAt": "2026-08-27T07:00:02Z"},
        {"cpuPercent": 97.0, "measuredAt": "2026-08-27T07:00:04Z"},
        {"cpuPercent": 10.0, "measuredAt": "2026-08-27T07:00:06Z"},
    ]
    result = evaluate_overload_status(history)
    assert result == {"status": "normal", "evidence": None}


def test_evaluate_overload_status_boundary_89_9_percent_is_not_high():
    history = [
        {"cpuPercent": 89.9, "measuredAt": "2026-08-27T07:00:00Z"},
        {"cpuPercent": 89.9, "measuredAt": "2026-08-27T07:00:02Z"},
        {"cpuPercent": 89.9, "measuredAt": "2026-08-27T07:00:04Z"},
        {"cpuPercent": 89.9, "measuredAt": "2026-08-27T07:00:06Z"},
    ]
    result = evaluate_overload_status(history)
    assert result == {"status": "normal", "evidence": None}


def test_evaluate_overload_status_boundary_exactly_5_seconds_is_sustained():
    history = [
        {"cpuPercent": 90.0, "measuredAt": "2026-08-27T07:00:00Z"},
        {"cpuPercent": 90.0, "measuredAt": "2026-08-27T07:00:02Z"},
        {"cpuPercent": 90.0, "measuredAt": "2026-08-27T07:00:05Z"},
    ]
    result = evaluate_overload_status(history)
    assert result["status"] == "overload-candidate"
    assert result["evidence"]["durationSeconds"] == 5.0


def test_evaluate_overload_status_boundary_under_5_seconds_is_not_sustained():
    history = [
        {"cpuPercent": 90.0, "measuredAt": "2026-08-27T07:00:00Z"},
        {"cpuPercent": 90.0, "measuredAt": "2026-08-27T07:00:04Z"},
        {"cpuPercent": 10.0, "measuredAt": "2026-08-27T07:00:06Z"},
    ]
    result = evaluate_overload_status(history)
    assert result == {"status": "normal", "evidence": None}


def test_evaluate_overload_status_gap_over_max_seconds_breaks_run():
    from cpu_agent import MAX_SAMPLE_GAP_SECONDS

    over_gap = MAX_SAMPLE_GAP_SECONDS + 0.1
    history = [
        {"cpuPercent": 95.0, "measuredAt": "2026-08-27T07:00:00Z"},
        {"cpuPercent": 95.0, "measuredAt": "2026-08-27T07:00:02Z"},
        # MAX_SAMPLE_GAP_SECONDS를 넘는 공백 -> 구간이 끊긴다
        {
            "cpuPercent": 95.0,
            "measuredAt": f"2026-08-27T07:00:{2 + over_gap:06.3f}Z",
        },
    ]
    result = evaluate_overload_status(history)
    assert result == {"status": "insufficient-data", "evidence": None}


def test_evaluate_overload_status_gap_of_exactly_max_seconds_does_not_break_run():
    from cpu_agent import MAX_SAMPLE_GAP_SECONDS

    history = [
        {"cpuPercent": 95.0, "measuredAt": "2026-08-27T07:00:00Z"},
        {
            "cpuPercent": 95.0,
            "measuredAt": f"2026-08-27T07:00:{MAX_SAMPLE_GAP_SECONDS:06.3f}Z",
        },
        {
            "cpuPercent": 95.0,
            "measuredAt": f"2026-08-27T07:00:{2 * MAX_SAMPLE_GAP_SECONDS:06.3f}Z",
        },
    ]
    result = evaluate_overload_status(history)
    assert result["status"] == "overload-candidate"
    # 두 번째 샘플에서 이미 (0 -> MAX_SAMPLE_GAP_SECONDS) 구간이 5초 지속을
    # 만족하므로, 첫 번째로 확정되는 구간은 이 두 샘플까지다.
    assert result["evidence"]["durationSeconds"] == MAX_SAMPLE_GAP_SECONDS


def test_evaluate_overload_status_overload_candidate_with_realistic_agent_loop_gaps():
    """실제 프로덕션에서 재현된 회귀: 90% 이상 CPU가 실제로 5초 넘게 지속됐는데도
    overload-candidate로 판정되지 않던 버그.

    아래 간격(2.698s / 4.553s / 3.467s)은 이상적으로 2초씩 균등한 값이 아니라,
    실제 agent/main.py를 부하 없이 정상 실행한 상태에서 각 콘솔 출력 줄의 도착
    시각을 외부에서 타임스탬프로 기록해 얻은 실측값이다. 프로세스 후보 수집을
    위한 프라이밍(매 주기 psutil로 프로세스 전수 조회)과 production 업로드
    네트워크 왕복 시간 때문에, 실제 측정 주기는 MEASURE_INTERVAL_SECONDS(2초)
    보다 상당히 길고 들쭉날쭉하다. 이 테스트는 그 실측 간격 패턴을 그대로
    사용했을 때도 4개 연속 90%+ 샘플이 하나의 지속 구간으로 인정되어야
    함을 검증한다 (버그 당시에는 4.553초 공백이 MAX_SAMPLE_GAP_SECONDS를
    넘어 구간이 끊기면서 insufficient-data로 잘못 판정됐다).
    """
    history = [
        {"cpuPercent": 95.0, "measuredAt": "2026-08-27T07:00:00.000Z"},
        {"cpuPercent": 95.0, "measuredAt": "2026-08-27T07:00:02.698Z"},
        {"cpuPercent": 95.0, "measuredAt": "2026-08-27T07:00:07.251Z"},
        {"cpuPercent": 95.0, "measuredAt": "2026-08-27T07:00:10.718Z"},
    ]
    result = evaluate_overload_status(history)
    assert result["status"] == "overload-candidate"


def test_evaluate_overload_status_ignores_entries_with_invalid_cpu_percent():
    history = [
        {"cpuPercent": 95.0, "measuredAt": "2026-08-27T07:00:00Z"},
        {"cpuPercent": "높음", "measuredAt": "2026-08-27T07:00:02Z"},
        {"cpuPercent": 95.0, "measuredAt": "2026-08-27T07:00:04Z"},
    ]
    result = evaluate_overload_status(history)
    assert result == {"status": "insufficient-data", "evidence": None}


def test_evaluate_overload_status_ignores_entries_with_unparseable_timestamp():
    history = [
        {"cpuPercent": 10.0, "measuredAt": "이건 시각이 아님"},
        {"cpuPercent": 10.0, "measuredAt": "2026-08-27T07:00:00Z"},
        {"cpuPercent": 15.0, "measuredAt": "2026-08-27T07:00:02Z"},
    ]
    result = evaluate_overload_status(history)
    assert result == {"status": "normal", "evidence": None}


def test_evaluate_overload_status_stays_overload_candidate_after_values_drop():
    history = [
        {"cpuPercent": 95.0, "measuredAt": "2026-08-27T07:00:00Z"},
        {"cpuPercent": 95.0, "measuredAt": "2026-08-27T07:00:02Z"},
        {"cpuPercent": 95.0, "measuredAt": "2026-08-27T07:00:04Z"},
        {"cpuPercent": 95.0, "measuredAt": "2026-08-27T07:00:06Z"},
        {"cpuPercent": 5.0, "measuredAt": "2026-08-27T07:00:08Z"},
    ]
    result = evaluate_overload_status(history)
    assert result["status"] == "overload-candidate"


# --- trim_history ---


def test_trim_history_drops_entries_older_than_window():
    import datetime

    now = datetime.datetime(2026, 8, 27, 7, 1, 5, tzinfo=datetime.timezone.utc)
    history = [
        {"cpuPercent": 10.0, "measuredAt": "2026-08-27T07:00:00Z"},  # 65초 전 -> 버려짐
        {"cpuPercent": 20.0, "measuredAt": "2026-08-27T07:00:10Z"},  # 55초 전 -> 유지
    ]
    result = trim_history(history, now, window_seconds=60.0)
    assert result == [{"cpuPercent": 20.0, "measuredAt": "2026-08-27T07:00:10Z"}]


def test_trim_history_keeps_entry_exactly_at_window_boundary():
    import datetime

    now = datetime.datetime(2026, 8, 27, 7, 1, 0, tzinfo=datetime.timezone.utc)
    history = [{"cpuPercent": 10.0, "measuredAt": "2026-08-27T07:00:00Z"}]
    result = trim_history(history, now, window_seconds=60.0)
    assert result == history


# --- format_overload_status_line ---


def test_format_overload_status_line_insufficient_data():
    line = format_overload_status_line({"status": "insufficient-data", "evidence": None})
    assert line == "상태: 데이터 부족"


def test_format_overload_status_line_normal():
    line = format_overload_status_line({"status": "normal", "evidence": None})
    assert line == "상태: 정상"


# --- collect_process_samples / pick_top_process (specs/cpu-process-candidates.md) ---


class FakeProcess:
    def __init__(self, pid, name, cpu_percent, raises=None):
        self.pid = pid
        self._name = name
        self._cpu_percent = cpu_percent
        self._raises = raises

    def name(self):
        if self._raises == "name":
            raise Exception("access denied")
        return self._name

    def cpu_percent(self, interval=None):
        if self._raises == "cpu_percent":
            raise Exception("process no longer exists")
        return self._cpu_percent


def test_collect_process_samples_returns_pid_name_cpu_percent():
    processes = [FakeProcess(pid=1, name="chrome.exe", cpu_percent=55.3)]

    samples = collect_process_samples(lambda: processes)

    assert samples == [{"pid": 1, "name": "chrome.exe", "cpuPercent": 55.3}]


def test_collect_process_samples_skips_process_that_raises_on_name():
    processes = [
        FakeProcess(pid=1, name="chrome.exe", cpu_percent=55.3, raises="name"),
        FakeProcess(pid=2, name="python.exe", cpu_percent=10.0),
    ]

    samples = collect_process_samples(lambda: processes)

    assert samples == [{"pid": 2, "name": "python.exe", "cpuPercent": 10.0}]


def test_collect_process_samples_skips_process_that_raises_on_cpu_percent():
    processes = [
        FakeProcess(pid=1, name="chrome.exe", cpu_percent=55.3, raises="cpu_percent"),
        FakeProcess(pid=2, name="python.exe", cpu_percent=10.0),
    ]

    samples = collect_process_samples(lambda: processes)

    assert samples == [{"pid": 2, "name": "python.exe", "cpuPercent": 10.0}]


def test_collect_process_samples_returns_empty_list_when_no_processes():
    samples = collect_process_samples(lambda: [])
    assert samples == []


def test_collect_process_samples_returns_empty_list_when_all_processes_fail():
    processes = [
        FakeProcess(pid=1, name="a.exe", cpu_percent=1.0, raises="name"),
        FakeProcess(pid=2, name="b.exe", cpu_percent=1.0, raises="cpu_percent"),
    ]
    samples = collect_process_samples(lambda: processes)
    assert samples == []


def test_pick_top_process_returns_none_when_empty():
    assert pick_top_process([]) is None


def test_pick_top_process_returns_the_single_entry():
    samples = [{"pid": 1, "name": "chrome.exe", "cpuPercent": 55.3}]
    assert pick_top_process(samples) == samples[0]


def test_pick_top_process_returns_highest_cpu_percent():
    samples = [
        {"pid": 1, "name": "chrome.exe", "cpuPercent": 55.3},
        {"pid": 2, "name": "python.exe", "cpuPercent": 98.2},
        {"pid": 3, "name": "explorer.exe", "cpuPercent": 3.1},
    ]
    assert pick_top_process(samples) == {"pid": 2, "name": "python.exe", "cpuPercent": 98.2}


def test_pick_top_process_returns_first_on_tie():
    samples = [
        {"pid": 1, "name": "a.exe", "cpuPercent": 50.0},
        {"pid": 2, "name": "b.exe", "cpuPercent": 50.0},
    ]
    assert pick_top_process(samples) == {"pid": 1, "name": "a.exe", "cpuPercent": 50.0}


def test_pick_top_process_excludes_system_idle_process_even_if_highest():
    """회귀: System Idle Process(Windows PID 0)는 유휴 시간을 나타낼 뿐 실제
    작업으로 인한 CPU 사용이 아니므로, 절대 "원인 후보"로 뽑혀서는 안 된다.
    psutil은 이 프로세스의 cpu_percent를 코어 수에 비례해 수백 %까지 보고할
    수 있어, 필터링하지 않으면 항상 최상위로 뽑히는 문제가 있었다."""
    samples = [
        {"pid": 0, "name": "System Idle Process", "cpuPercent": 686.4},
        {"pid": 1234, "name": "powershell.exe", "cpuPercent": 61.8},
    ]
    assert pick_top_process(samples) == {
        "pid": 1234,
        "name": "powershell.exe",
        "cpuPercent": 61.8,
    }


def test_pick_top_process_returns_none_when_only_system_idle_process():
    samples = [{"pid": 0, "name": "System Idle Process", "cpuPercent": 700.0}]
    assert pick_top_process(samples) is None


# --- should_collect_process_samples (언제 프로세스 후보 수집을 실행할지) ---


def test_should_collect_process_samples_false_when_not_overload_candidate():
    result = {"status": "normal", "evidence": None}
    assert should_collect_process_samples(result, last_evidence_started_at=None) is False


def test_should_collect_process_samples_false_for_insufficient_data():
    result = {"status": "insufficient-data", "evidence": None}
    assert should_collect_process_samples(result, last_evidence_started_at=None) is False


def test_should_collect_process_samples_true_on_first_overload_detection():
    result = {
        "status": "overload-candidate",
        "evidence": {"startedAt": "2026-08-29T00:00:00Z", "endedAt": "x", "durationSeconds": 6, "maxCpuPercent": 95},
    }
    assert should_collect_process_samples(result, last_evidence_started_at=None) is True


def test_should_collect_process_samples_false_when_same_episode_already_collected():
    result = {
        "status": "overload-candidate",
        "evidence": {"startedAt": "2026-08-29T00:00:00Z", "endedAt": "x", "durationSeconds": 6, "maxCpuPercent": 95},
    }
    already_collected_for = "2026-08-29T00:00:00Z"
    assert should_collect_process_samples(result, last_evidence_started_at=already_collected_for) is False


def test_should_collect_process_samples_true_when_new_overload_episode_starts():
    result = {
        "status": "overload-candidate",
        "evidence": {"startedAt": "2026-08-29T00:05:00Z", "endedAt": "x", "durationSeconds": 6, "maxCpuPercent": 95},
    }
    collected_for_previous_episode = "2026-08-29T00:00:00Z"
    assert (
        should_collect_process_samples(result, last_evidence_started_at=collected_for_previous_episode)
        is True
    )


def test_format_overload_status_line_overload_candidate():
    result = {
        "status": "overload-candidate",
        "evidence": {
            "startedAt": "2026-08-27T07:00:00Z",
            "endedAt": "2026-08-27T07:00:06Z",
            "durationSeconds": 6.0,
            "maxCpuPercent": 98.2,
        },
    }
    line = format_overload_status_line(result)
    assert line == "상태: CPU 과부하 후보 (98.2%, 07:00:00~07:00:06, 6.0초 지속)"
