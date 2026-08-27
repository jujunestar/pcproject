"""specs/cpu-agent.md의 핵심 동작을 검증하는 테스트.

아직 agent/cpu_agent.py 구현이 없으므로 이 테스트들은 실패해야 정상이다.
"""

import json

import pytest

from cpu_agent import (
    CpuMeasurementError,
    is_valid_connection_code,
    measure_cpu_percent,
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
    )

    assert len(calls) == 1
    url, body = calls[0]
    assert url == "https://pcproject-tau.vercel.app/api/data"
    assert body["code"] == "AB12CD"
    value = json.loads(body["value"])
    assert value["cpuPercent"] == 42.5
    assert value["measuredAt"] == "2026-08-27T00:00:00Z"


def test_upload_measurement_reports_success_on_ok_response():
    result = upload_measurement(
        code="AB12CD",
        cpu_percent=10.0,
        measured_at="2026-08-27T00:00:00Z",
        base_url="https://pcproject-tau.vercel.app",
        http_post=lambda url, json_body: FakeResponse(status_code=200),
    )

    assert result["success"] is True


def test_upload_measurement_reports_failure_on_error_response():
    result = upload_measurement(
        code="AB12CD",
        cpu_percent=10.0,
        measured_at="2026-08-27T00:00:00Z",
        base_url="https://pcproject-tau.vercel.app",
        http_post=lambda url, json_body: FakeResponse(status_code=500),
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
    )

    assert result["success"] is False
    assert "error" in result
