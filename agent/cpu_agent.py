import json
import re

CONNECTION_CODE_PATTERN = re.compile(r"^[A-Za-z0-9]{6}$")


class CpuMeasurementError(Exception):
    pass


def is_valid_connection_code(code):
    return bool(CONNECTION_CODE_PATTERN.match(code))


def measure_cpu_percent(cpu_percent_fn):
    try:
        return cpu_percent_fn()
    except Exception as exc:
        raise CpuMeasurementError(str(exc)) from exc


def upload_measurement(code, cpu_percent, measured_at, base_url, http_post):
    body = {
        "code": code,
        "value": json.dumps({"cpuPercent": cpu_percent, "measuredAt": measured_at}),
    }
    url = f"{base_url}/api/data"

    try:
        response = http_post(url, body)
    except Exception as exc:
        return {"success": False, "error": str(exc)}

    if response.status_code == 200:
        return {"success": True}
    return {"success": False, "error": f"HTTP {response.status_code}"}
