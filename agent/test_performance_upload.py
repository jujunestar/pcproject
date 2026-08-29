"""agent/performance_upload.py 테스트.

/api/data의 value에 담기는 JSON을 CPU/RAM/Disk 통합 payload로 조립하고
전송하는 로직을 검증한다. 기존 agent/cpu_agent.py는 건드리지 않고,
main.py가 CPU 전용 업로드 대신 이 모듈을 사용해 하나의 통합 payload만
전송하도록 한다 (같은 code에 두 번 쓰면 뒤의 값이 앞의 값을 덮어쓰기
때문에 반드시 한 번에 합쳐서 보내야 한다).
"""

import json

from performance_upload import build_measurement_value, post_measurement


class FakeResponse:
    def __init__(self, status_code):
        self.status_code = status_code


def test_build_measurement_value_keeps_existing_cpu_fields_backward_compatible():
    """기존 lib/cpu-status.ts가 파싱하는 5개 필드는 이름과 형태가 그대로 유지돼야 한다."""
    value = build_measurement_value(
        cpu_percent=42.3,
        measured_at="2026-08-29T05:32:10.000Z",
        overload_status="normal",
        overload_evidence=None,
        top_process=None,
        ram_percent=59.8,
        ram_used_bytes=10140180480,
        ram_available_bytes=6808727552,
        ram_status="normal",
        ram_evidence=None,
        ram_top_process=None,
        disk_capacity={"totalBytes": 100, "usedBytes": 50, "freeBytes": 50, "percent": 50.0},
        disk_active_percent=5.0,
        disk_io_status="normal",
        disk_io_evidence=None,
        disk_top_io_process=None,
    )

    assert value["cpuPercent"] == 42.3
    assert value["measuredAt"] == "2026-08-29T05:32:10.000Z"
    assert value["overloadStatus"] == "normal"
    assert value["overloadEvidence"] is None
    assert value["topProcess"] is None


def test_build_measurement_value_includes_ram_fields():
    value = build_measurement_value(
        cpu_percent=10.0,
        measured_at="2026-08-29T05:32:10.000Z",
        overload_status="normal",
        overload_evidence=None,
        top_process=None,
        ram_percent=95.0,
        ram_used_bytes=1000,
        ram_available_bytes=100,
        ram_status="bottleneck-candidate",
        ram_evidence={
            "startedAt": "2026-08-29T05:32:00.000Z",
            "endedAt": "2026-08-29T05:32:06.000Z",
            "durationSeconds": 6.0,
            "maxRamPercent": 96.0,
        },
        ram_top_process={"pid": 111, "name": "chrome.exe", "rss": 500, "memoryPercent": 3.1},
        disk_capacity=None,
        disk_active_percent=None,
        disk_io_status="insufficient-data",
        disk_io_evidence=None,
        disk_top_io_process=None,
    )

    assert value["ramPercent"] == 95.0
    assert value["ramUsedBytes"] == 1000
    assert value["ramAvailableBytes"] == 100
    assert value["ramStatus"] == "bottleneck-candidate"
    assert value["ramEvidence"]["maxRamPercent"] == 96.0
    assert value["ramTopProcess"] == {"pid": 111, "name": "chrome.exe", "rss": 500, "memoryPercent": 3.1}


def test_build_measurement_value_includes_disk_fields():
    value = build_measurement_value(
        cpu_percent=10.0,
        measured_at="2026-08-29T05:32:10.000Z",
        overload_status="normal",
        overload_evidence=None,
        top_process=None,
        ram_percent=50.0,
        ram_used_bytes=1,
        ram_available_bytes=1,
        ram_status="normal",
        ram_evidence=None,
        ram_top_process=None,
        disk_capacity={"totalBytes": 100, "usedBytes": 90, "freeBytes": 10, "percent": 90.0},
        disk_active_percent=175.0,
        disk_io_status="bottleneck-candidate",
        disk_io_evidence={
            "startedAt": "2026-08-29T05:32:00.000Z",
            "endedAt": "2026-08-29T05:32:06.000Z",
            "durationSeconds": 6.0,
            "maxDiskActivePercent": 175.0,
        },
        disk_top_io_process={"pid": 222, "name": "python.exe", "bytesPerSec": 5000.0},
    )

    assert value["diskCapacity"] == {"totalBytes": 100, "usedBytes": 90, "freeBytes": 10, "percent": 90.0}
    assert value["diskActivePercent"] == 175.0
    assert value["diskIoStatus"] == "bottleneck-candidate"
    assert value["diskIoEvidence"]["maxDiskActivePercent"] == 175.0
    assert value["diskTopIoProcess"] == {"pid": 222, "name": "python.exe", "bytesPerSec": 5000.0}


def test_build_measurement_value_accepts_none_for_unavailable_ram_or_disk():
    """측정하지 못한 값은 임의로 채우지 않고 None(→ JSON null)으로 둔다."""
    value = build_measurement_value(
        cpu_percent=10.0,
        measured_at="2026-08-29T05:32:10.000Z",
        overload_status="normal",
        overload_evidence=None,
        top_process=None,
        ram_percent=None,
        ram_used_bytes=None,
        ram_available_bytes=None,
        ram_status="insufficient-data",
        ram_evidence=None,
        ram_top_process=None,
        disk_capacity=None,
        disk_active_percent=None,
        disk_io_status="insufficient-data",
        disk_io_evidence=None,
        disk_top_io_process=None,
    )

    assert value["ramPercent"] is None
    assert value["diskCapacity"] is None
    assert value["diskActivePercent"] is None


def _default_value():
    return build_measurement_value(
        cpu_percent=10.0,
        measured_at="2026-08-29T05:32:10.000Z",
        overload_status="normal",
        overload_evidence=None,
        top_process=None,
        ram_percent=50.0,
        ram_used_bytes=1,
        ram_available_bytes=1,
        ram_status="normal",
        ram_evidence=None,
        ram_top_process=None,
        disk_capacity=None,
        disk_active_percent=None,
        disk_io_status="insufficient-data",
        disk_io_evidence=None,
        disk_top_io_process=None,
    )


def test_post_measurement_sends_code_and_json_serialized_value():
    calls = []

    def fake_post(url, json_body):
        calls.append((url, json_body))
        return FakeResponse(status_code=200)

    result = post_measurement(
        code="AB12CD",
        value=_default_value(),
        base_url="https://pcproject-tau.vercel.app",
        http_post=fake_post,
    )

    assert result == {"success": True}
    assert len(calls) == 1
    url, body = calls[0]
    assert url == "https://pcproject-tau.vercel.app/api/data"
    assert body["code"] == "AB12CD"
    parsed = json.loads(body["value"])
    assert parsed["cpuPercent"] == 10.0
    assert parsed["ramPercent"] == 50.0


def test_post_measurement_reports_failure_on_error_response():
    result = post_measurement(
        code="AB12CD",
        value=_default_value(),
        base_url="https://pcproject-tau.vercel.app",
        http_post=lambda url, json_body: FakeResponse(status_code=500),
    )
    assert result["success"] is False
    assert "error" in result


def test_post_measurement_reports_failure_on_connection_error():
    def raising_post(url, json_body):
        raise ConnectionError("network unreachable")

    result = post_measurement(
        code="AB12CD",
        value=_default_value(),
        base_url="https://pcproject-tau.vercel.app",
        http_post=raising_post,
    )
    assert result["success"] is False
    assert "error" in result
