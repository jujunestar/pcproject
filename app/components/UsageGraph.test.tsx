// UsageGraph는 effect가 없는 순수 렌더링 컴포넌트라 SSR(react-dom/server)로도
// 충분히 테스트할 수 있다 — jsdom이 필요 없다.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UsageGraph } from "./UsageGraph";
import type { UsageSeriesPoint } from "@/lib/live-samples";

describe("UsageGraph — sample 개수에 따른 표시 방식", () => {
  it("sample이 1개뿐이면 선(path)이 아니라 실제 점(circle)이 보여야 한다", () => {
    const series: UsageSeriesPoint[] = [{ label: "0", cpu: 9.9, ram: 40.0, disk: 1.0 }];

    const html = renderToStaticMarkup(
      <UsageGraph title="Before" series={series} currentValues={{ cpu: 9.9, ram: 40.0, disk: 1.0 }} />
    );

    // 점 1개짜리 <path d="M x y">는 line-to 명령이 없어 화면에 아무것도
    // 그려지지 않는다(SVG 표준 동작) — 그래서 선 대신 점으로 그려야 한다.
    expect(html).not.toContain("usage-graph-line");
    expect(html).toContain("usage-graph-point");
  });

  it("sample이 2개 이상이면 실제 line(path)이 그려져야 한다", () => {
    const series: UsageSeriesPoint[] = [
      { label: "0", cpu: 9.9, ram: 40.0, disk: 1.0 },
      { label: "1", cpu: 7.5, ram: 38.0, disk: 1.2 },
    ];

    const html = renderToStaticMarkup(
      <UsageGraph title="After" series={series} currentValues={{ cpu: 7.5, ram: 38.0, disk: 1.2 }} />
    );

    expect(html).toContain("usage-graph-line");
    expect(html).not.toContain("usage-graph-point");
  });
});
