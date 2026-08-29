import type { UsageSeriesPoint } from "@/lib/live-samples";

type SeriesKey = "cpu" | "ram" | "disk";

const SERIES_LABEL: Record<SeriesKey, string> = { cpu: "CPU", ram: "RAM", disk: "Disk" };
const SERIES_DASH: Record<SeriesKey, string> = { cpu: "0", ram: "6 4", disk: "2 3" };
const SERIES_ORDER: SeriesKey[] = ["cpu", "ram", "disk"];

export const THRESHOLD_PERCENT = 90;
const WIDTH = 320;
const HEIGHT = 140;
const PADDING = 24;

export function UsageGraph({
  title,
  series,
  currentValues,
  evidenceNote,
  caption,
}: {
  title: string;
  series: UsageSeriesPoint[];
  currentValues: { cpu: number | null; ram: number | null; disk: number | null };
  evidenceNote?: string | null;
  caption?: string;
}) {
  const allValues = series.flatMap((point) => [point.cpu, point.ram, point.disk]);
  const maxValue = Math.max(THRESHOLD_PERCENT, ...allValues) * 1.1;

  function toX(index: number): number {
    if (series.length <= 1) return PADDING; // 점이 1개뿐일 때 0으로 나누기 방지
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
        {[0.25, 0.5, 0.75].map((position) => (
          <line
            key={position}
            x1={PADDING}
            y1={PADDING + (HEIGHT - PADDING * 2) * position}
            x2={WIDTH - PADDING}
            y2={PADDING + (HEIGHT - PADDING * 2) * position}
            className="usage-graph-gridline"
          />
        ))}
        {series.length === 1 &&
          SERIES_ORDER.map((key) => (
            // sample이 1개뿐이면 <path d="M x y">는 line-to 명령이 없어
            // 브라우저에 아무것도 그려지지 않는다(SVG 표준 동작) — 그래서
            // 실제 점 하나라도 눈에 보이도록 원으로 그린다. fake 점을
            // 추가하는 게 아니라, 있는 유일한 실제 값을 표시 방식만
            // 바꾸는 것이다.
            <circle key={key} cx={toX(0)} cy={toY(series[0][key])} r={3} className={`usage-graph-point usage-graph-point-${key}`} />
          ))}
        {series.length >= 2 &&
          SERIES_ORDER.map((key) => (
            <path key={key} d={buildPath(key)} className={`usage-graph-line usage-graph-line-${key}`} style={{ strokeDasharray: SERIES_DASH[key] }} />
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
        {caption ?? `예시 그래프 (실제 이력 연결은 다음 단계) · 점선: 병목 기준 ${THRESHOLD_PERCENT}%`}
      </p>
      {evidenceNote && <p className="usage-graph-evidence">{evidenceNote}</p>}
    </div>
  );
}
