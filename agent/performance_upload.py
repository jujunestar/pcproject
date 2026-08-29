import json


def build_measurement_value(
    cpu_percent,
    measured_at,
    overload_status,
    overload_evidence,
    top_process,
    ram_percent,
    ram_used_bytes,
    ram_available_bytes,
    ram_status,
    ram_evidence,
    ram_top_process,
    disk_capacity,
    disk_active_percent,
    disk_io_status,
    disk_io_evidence,
    disk_top_io_process,
):
    """CPU/RAM/Disk 측정 결과를 /api/data의 value 하나로 합친다.

    기존 CPU 필드(cpuPercent, measuredAt, overloadStatus, overloadEvidence,
    topProcess)는 이름과 형태를 그대로 유지해 lib/cpu-status.ts와의 하위
    호환을 지킨다. 측정하지 못한 값은 None(→ JSON null)으로 두고 임의로
    채우지 않는다.
    """
    return {
        "cpuPercent": cpu_percent,
        "measuredAt": measured_at,
        "overloadStatus": overload_status,
        "overloadEvidence": overload_evidence,
        "topProcess": top_process,
        "ramPercent": ram_percent,
        "ramUsedBytes": ram_used_bytes,
        "ramAvailableBytes": ram_available_bytes,
        "ramStatus": ram_status,
        "ramEvidence": ram_evidence,
        "ramTopProcess": ram_top_process,
        "diskCapacity": disk_capacity,
        "diskActivePercent": disk_active_percent,
        "diskIoStatus": disk_io_status,
        "diskIoEvidence": disk_io_evidence,
        "diskTopIoProcess": disk_top_io_process,
    }


def post_measurement(code, value, base_url, http_post):
    body = {"code": code, "value": json.dumps(value)}
    url = f"{base_url}/api/data"

    try:
        response = http_post(url, body)
    except Exception as exc:
        return {"success": False, "error": str(exc)}

    if response.status_code == 200:
        return {"success": True}
    return {"success": False, "error": f"HTTP {response.status_code}"}
