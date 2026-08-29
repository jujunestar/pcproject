import type { UsageSeriesPoint } from "@/lib/fake-timeseries";

type SeriesKey = "cpu" | "ram" | "disk";

const SERIES_LABEL: Record<SeriesKey, string> = { cpu: "CPU", ram: "RAM", disk: "Disk" };
const SERIES_DASH: Record<SeriesKey, string> = { cpu: "0", ram: "6 4", disk: "2 3" };
const SERIES_ORDER: SeriesKey[] = ["cpu", "ram", "disk"];

const THRESHOLD_PERCENT = 90;
const WIDTH = 320;
const HEIGHT = 140;
const PADDING = 24;

export function UsageGraph({
  title,
  series,
  currentValues,
  evidenceNote,
}: {
  title: string;
  series: UsageSeriesPoint[];
  currentValues: { cpu: number | null; ram: number | null; disk: number | null };
  evidenceNote?: string | null;
}) {
  const allValues = series.flatMap((point) => [point.cpu, point.ram, point.disk]);
  const maxValue = Math.max(THRESHOLD_PERCENT, ...allValues) * 1.1;

  function toX(index: number): number {
    return PADDING + (index / (series.length - 1)) * (WIDTH - PADDING * 2);
  }
  function toY(value: number): number {
    return HEIGHT - PADDING - (value / maxValue) * (HEIGHT - PADDING * 2);
  }
  function buildPath(key: SeriesKey): string {
    return series.map((point, index) => `${index === 0 ? "M" : "L"} ${toX(index).toFixed(1)} ${toY(point[key]).toFixed(1)}`).join(" ");
  }

  const thresholdY = toY(THRESHOLD_PERCENT);

  return (
    <div className="usage-graph">
      <p className="usage-graph-title">{title}</p>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="usage-graph-svg"
        role="img"
        aria-label={`${title} — 예시 그래프`}
      >
        <line
          x1={PADDING}
          y1={thresholdY}
          x2={WIDTH - PADDING}
          y2={thresholdY}
          className="usage-graph-threshold"
        />
        {SERIES_ORDER.map((key) => (
          <path key={key} d={buildPath(key)} className="usage-graph-line" style={{ strokeDasharray: SERIES_DASH[key] }} />
        ))}
      </svg>
      <div className="usage-graph-legend">
        {SERIES_ORDER.map((key) => (
          <span key={key} className="usage-graph-legend-item">
            <span className={`usage-graph-swatch usage-graph-swatch-${key}`} />
            {SERIES_LABEL[key]} {currentValues[key] !== null ? `${currentValues[key]!.toFixed(1)}%` : "-"}
          </span>
        ))}
      </div>
      <p className="usage-graph-caption">
        예시 그래프 (실제 이력 연결은 다음 단계) · 점선: 병목 기준 {THRESHOLD_PERCENT}%
      </p>
      {evidenceNote && <p className="usage-graph-evidence">{evidenceNote}</p>}
    </div>
  );
}
