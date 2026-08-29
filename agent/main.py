import datetime
import time

import psutil
import requests

from cpu_agent import (
    CpuMeasurementError,
    STATUS_OVERLOAD_CANDIDATE,
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

BASE_URL = "https://pcproject-tau.vercel.app"
MEASURE_INTERVAL_SECONDS = 2
# 프로세스 후보 수집(프라이밍 + 재측정)에 쓰는 짧은 창. CPU 과부하 후보가
# "새로 확정된" 주기에만 한 번 실행되므로, 매 주기 실행되는
# MEASURE_INTERVAL_SECONDS와 달리 판정에 쓰이는 measured_at 간격에
# 영향을 주지 않는다.
PROCESS_SAMPLE_SECONDS = 1


def real_http_post(url, json_body):
    return requests.post(url, json=json_body, timeout=5)


def main():
    code = input("연결 코드를 입력하세요 (6자리 영숫자): ").strip()
    if not is_valid_connection_code(code):
        print("잘못된 연결 코드 형식")
        return

    print(f"연결됨 (코드: {code})")

    history = []
    last_evidence_started_at = None
    cached_top_process = None

    while True:
        try:
            cpu_percent = measure_cpu_percent(
                lambda: psutil.cpu_percent(interval=MEASURE_INTERVAL_SECONDS)
            )
        except CpuMeasurementError as exc:
            print(f"CPU 측정 실패: {exc}")
            time.sleep(MEASURE_INTERVAL_SECONDS)
            continue

        print(f"CPU 사용률: {cpu_percent:.1f}%")

        measured_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
        now = datetime.datetime.now(datetime.timezone.utc)

        history.append({"cpuPercent": cpu_percent, "measuredAt": measured_at})
        history = trim_history(history, now)

        overload_result = evaluate_overload_status(history)
        print(format_overload_status_line(overload_result))

        top_process = None
        if overload_result["status"] == STATUS_OVERLOAD_CANDIDATE:
            if should_collect_process_samples(overload_result, last_evidence_started_at):
                processes = list(psutil.process_iter(["pid", "name"]))
                for proc in processes:
                    try:
                        proc.cpu_percent(None)
                    except Exception:
                        pass
                time.sleep(PROCESS_SAMPLE_SECONDS)
                process_samples = collect_process_samples(lambda: processes)
                cached_top_process = pick_top_process(process_samples)
                last_evidence_started_at = overload_result["evidence"]["startedAt"]

            top_process = cached_top_process
            if top_process is not None:
                print(
                    f"관련 프로세스 후보: {top_process['name']} "
                    f"(PID {top_process['pid']}, CPU {top_process['cpuPercent']:.1f}%)"
                )

        result = upload_measurement(
            code=code,
            cpu_percent=cpu_percent,
            measured_at=measured_at,
            base_url=BASE_URL,
            http_post=real_http_post,
            overload_status=overload_result["status"],
            overload_evidence=overload_result["evidence"],
            top_process=top_process,
        )

        if result["success"]:
            print("업로드 성공")
        else:
            print(f"업로드 실패: API 연결 실패 ({result['error']})")


if __name__ == "__main__":
    main()
