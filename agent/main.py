import datetime
import os
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
)
from disk_agent import (
    STATUS_BOTTLENECK_CANDIDATE as DISK_STATUS_BOTTLENECK_CANDIDATE,
    collect_process_io_snapshot,
    compute_disk_active_percent,
    compute_disk_io_deltas,
    evaluate_disk_io_status,
    format_disk_io_status_line,
    parse_disk_capacity,
    pick_top_disk_io_process,
    should_collect_disk_process_samples,
)
from ram_agent import (
    STATUS_BOTTLENECK_CANDIDATE as RAM_STATUS_BOTTLENECK_CANDIDATE,
    collect_process_memory_samples,
    evaluate_ram_status,
    format_ram_status_line,
    pick_top_memory_process,
    should_collect_ram_process_samples,
)
from performance_upload import build_measurement_value, post_measurement

BASE_URL = "https://pcproject-tau.vercel.app"
MEASURE_INTERVAL_SECONDS = 2
# 프로세스 후보 수집(프라이밍 + 재측정)에 쓰는 짧은 창. CPU/RAM/Disk 병목
# 후보가 "새로 확정된" 주기에만 한 번 실행되므로, 매 주기 실행되는
# MEASURE_INTERVAL_SECONDS와 달리 판정에 쓰이는 measured_at 간격에
# 영향을 주지 않는다.
PROCESS_SAMPLE_SECONDS = 1
SYSTEM_DRIVE = os.environ.get("SystemDrive", "C:") + "\\"


def real_http_post(url, json_body):
    return requests.post(url, json=json_body, timeout=5)


def main():
    code = input("연결 코드를 입력하세요 (6자리 영숫자): ").strip()
    if not is_valid_connection_code(code):
        print("잘못된 연결 코드 형식")
        return

    print(f"연결됨 (코드: {code})")

    cpu_history = []
    last_cpu_evidence_started_at = None
    cached_top_cpu_process = None

    ram_history = []
    last_ram_evidence_started_at = None
    cached_top_ram_process = None

    disk_history = []
    last_disk_evidence_started_at = None
    cached_top_disk_process = None

    while True:
        # Disk I/O 활성 시간 비율은 아래 psutil.cpu_percent(interval=...)의
        # 블로킹 구간을 그대로 샘플링 창으로 재사용한다 (별도 sleep을
        # 추가로 넣지 않기 위함 — specs/disk-analysis.md 참고).
        try:
            disk_io_before = psutil.disk_io_counters()
        except Exception:
            disk_io_before = None
        disk_io_before_time = time.monotonic()

        try:
            cpu_percent = measure_cpu_percent(
                lambda: psutil.cpu_percent(interval=MEASURE_INTERVAL_SECONDS)
            )
        except CpuMeasurementError as exc:
            print(f"CPU 측정 실패: {exc}")
            time.sleep(MEASURE_INTERVAL_SECONDS)
            continue

        disk_io_after_time = time.monotonic()
        try:
            disk_io_after = psutil.disk_io_counters()
        except Exception:
            disk_io_after = None

        print(f"CPU 사용률: {cpu_percent:.1f}%")

        measured_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
        now = datetime.datetime.now(datetime.timezone.utc)

        # --- CPU (기존 판정/업로드 로직 그대로, 수정 없음) ---
        cpu_history.append({"cpuPercent": cpu_percent, "measuredAt": measured_at})
        cpu_history = trim_history(cpu_history, now)

        overload_result = evaluate_overload_status(cpu_history)
        print(format_overload_status_line(overload_result))

        top_process = None
        if overload_result["status"] == STATUS_OVERLOAD_CANDIDATE:
            if should_collect_process_samples(overload_result, last_cpu_evidence_started_at):
                processes = list(psutil.process_iter(["pid", "name"]))
                for proc in processes:
                    try:
                        proc.cpu_percent(None)
                    except Exception:
                        pass
                time.sleep(PROCESS_SAMPLE_SECONDS)
                process_samples = collect_process_samples(lambda: processes)
                cached_top_cpu_process = pick_top_process(process_samples)
                last_cpu_evidence_started_at = overload_result["evidence"]["startedAt"]

            top_process = cached_top_cpu_process
            if top_process is not None:
                print(
                    f"관련 프로세스 후보: {top_process['name']} "
                    f"(PID {top_process['pid']}, CPU {top_process['cpuPercent']:.1f}%)"
                )

        # --- RAM ---
        try:
            vm = psutil.virtual_memory()
            ram_percent = vm.percent
            ram_used_bytes = vm.used
            ram_available_bytes = vm.available
        except Exception as exc:
            print(f"RAM 측정 실패: {exc}")
            ram_percent = None
            ram_used_bytes = None
            ram_available_bytes = None

        ram_result = {"status": "insufficient-data", "evidence": None}
        top_ram_process = None
        if ram_percent is not None:
            print(f"RAM 사용률: {ram_percent:.1f}%")

            ram_history.append({"ramPercent": ram_percent, "measuredAt": measured_at})
            ram_history = trim_history(ram_history, now)

            ram_result = evaluate_ram_status(ram_history)
            print(format_ram_status_line(ram_result))

            if ram_result["status"] == RAM_STATUS_BOTTLENECK_CANDIDATE:
                if should_collect_ram_process_samples(ram_result, last_ram_evidence_started_at):
                    ram_processes = list(psutil.process_iter(["pid", "name"]))
                    memory_samples = collect_process_memory_samples(lambda: ram_processes)
                    cached_top_ram_process = pick_top_memory_process(memory_samples)
                    last_ram_evidence_started_at = ram_result["evidence"]["startedAt"]

                top_ram_process = cached_top_ram_process
                if top_ram_process is not None:
                    rss_mb = top_ram_process["rss"] / (1024 * 1024)
                    print(
                        f"RAM 관련 프로세스 후보: {top_ram_process['name']} "
                        f"(PID {top_ram_process['pid']}, {rss_mb:.1f}MB)"
                    )

        # --- Disk 용량 (판정 없음, 정보 제공 전용) ---
        disk_capacity = None
        try:
            disk_capacity = parse_disk_capacity(psutil.disk_usage(SYSTEM_DRIVE))
        except Exception as exc:
            print(f"Disk 용량 측정 실패: {exc}")

        if disk_capacity is not None:
            print(f"Disk 용량 사용률({SYSTEM_DRIVE}): {disk_capacity['percent']:.1f}%")

        # --- Disk I/O 성능 병목 후보 ---
        disk_active_percent = None
        if disk_io_before is not None and disk_io_after is not None:
            disk_active_percent = compute_disk_active_percent(
                disk_io_before, disk_io_after, disk_io_before_time, disk_io_after_time
            )

        disk_result = {"status": "insufficient-data", "evidence": None}
        top_disk_process = None
        if disk_active_percent is not None:
            disk_history.append({"diskActivePercent": disk_active_percent, "measuredAt": measured_at})
            disk_history = trim_history(disk_history, now)

            disk_result = evaluate_disk_io_status(disk_history)
            print(format_disk_io_status_line(disk_result))

            if disk_result["status"] == DISK_STATUS_BOTTLENECK_CANDIDATE:
                if should_collect_disk_process_samples(disk_result, last_disk_evidence_started_at):
                    io_processes = list(psutil.process_iter(["pid", "name"]))
                    io_before = collect_process_io_snapshot(lambda: io_processes)
                    io_before_time = time.monotonic()
                    time.sleep(PROCESS_SAMPLE_SECONDS)
                    io_after = collect_process_io_snapshot(lambda: io_processes)
                    io_after_time = time.monotonic()

                    io_deltas = compute_disk_io_deltas(
                        io_before, io_after, io_after_time - io_before_time
                    )
                    cached_top_disk_process = pick_top_disk_io_process(io_deltas)
                    last_disk_evidence_started_at = disk_result["evidence"]["startedAt"]

                top_disk_process = cached_top_disk_process
                if top_disk_process is not None:
                    kb_per_sec = top_disk_process["bytesPerSec"] / 1024
                    print(
                        f"Disk 관련 프로세스 후보: {top_disk_process['name']} "
                        f"(PID {top_disk_process['pid']}, {kb_per_sec:.1f}KB/s)"
                    )
        else:
            print("Disk I/O 상태: 데이터 부족 (측정 실패)")

        # --- CPU/RAM/Disk를 하나의 payload로 합쳐 한 번만 업로드 ---
        # (같은 code에 여러 번 쓰면 뒤의 쓰기가 앞의 쓰기를 덮어쓰므로,
        # 반드시 한 번에 합쳐서 보낸다.)
        value = build_measurement_value(
            cpu_percent=cpu_percent,
            measured_at=measured_at,
            overload_status=overload_result["status"],
            overload_evidence=overload_result["evidence"],
            top_process=top_process,
            ram_percent=ram_percent,
            ram_used_bytes=ram_used_bytes,
            ram_available_bytes=ram_available_bytes,
            ram_status=ram_result["status"],
            ram_evidence=ram_result["evidence"],
            ram_top_process=top_ram_process,
            disk_capacity=disk_capacity,
            disk_active_percent=disk_active_percent,
            disk_io_status=disk_result["status"],
            disk_io_evidence=disk_result["evidence"],
            disk_top_io_process=top_disk_process,
        )

        result = post_measurement(code=code, value=value, base_url=BASE_URL, http_post=real_http_post)

        if result["success"]:
            print("업로드 성공")
        else:
            print(f"업로드 실패: API 연결 실패 ({result['error']})")


if __name__ == "__main__":
    main()
