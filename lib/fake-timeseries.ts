// 와이어프레임 전용: 실제 이력 데이터를 아직 저장하지 않으므로, 마지막 지점만
// 실제 현재값으로 고정하고 그 앞은 결정적인(랜덤 아님) 파형으로 채운 예시
// 시계열이다. 다음 화면 슬라이스에서 실제 GET /api/data 재조회 기반 이력으로
// 교체될 자리다.

export type UsageSeriesPoint = {
  label: string;
  cpu: number;
  ram: number;
  disk: number;
};

const POINT_COUNT = 8;
const STEP_SECONDS = 5;
const DEFAULT_CPU = 20;
const DEFAULT_RAM = 30;
const DEFAULT_DISK = 10;

function waveOffset(index: number, phase: number): number {
  return Math.sin((index + phase) * 0.9) * 12;
}

function clampNonNegative(value: number): number {
  return Math.max(0, value);
}

export function buildFakeUsageSeries(current: {
  cpu: number | null;
  ram: number | null;
  disk: number | null;
}): UsageSeriesPoint[] {
  const targetCpu = current.cpu ?? DEFAULT_CPU;
  const targetRam = current.ram ?? DEFAULT_RAM;
  const targetDisk = current.disk ?? DEFAULT_DISK;

  const points: UsageSeriesPoint[] = [];
  for (let index = 0; index < POINT_COUNT; index++) {
    const label = `${index * STEP_SECONDS}s`;
    const isLastPoint = index === POINT_COUNT - 1;

    points.push({
      label,
      cpu: isLastPoint ? targetCpu : clampNonNegative(targetCpu + waveOffset(index, 0)),
      ram: isLastPoint ? targetRam : clampNonNegative(targetRam + waveOffset(index, 2)),
      disk: isLastPoint ? targetDisk : clampNonNegative(targetDisk + waveOffset(index, 4)),
    });
  }
  return points;
}
