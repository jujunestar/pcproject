// 브라우저 없이도 각 와이어프레임 상태가 런타임 오류 없이 렌더링되고
// 핵심 문구가 나타나는지 확인하는 스모크 테스트다. react-dom/server는 이미
// 설치된 의존성(react-dom)이라 새 패키지를 추가하지 않는다. 실제 브라우저에서의
// 레이아웃/스타일 확인은 별도로 필요하다 — 이 테스트는 "렌더링이 깨지지
// 않는다"만 보증한다.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnalysisScreen } from "./AnalysisScreen";
import { CompareScreen } from "./CompareScreen";
import { StartScreen } from "./StartScreen";
import type { PerformanceStatus } from "@/lib/performance-status";

type Received = Extract<PerformanceStatus, { status: "received" }>;

function baseReceived(overrides: Partial<Received> = {}): Received {
  return {
    status: "received",
    cpuPercent: 20.0,
    measuredAt: "2026-08-29T05:00:00.000Z",
    overloadStatus: "normal",
    overloadEvidence: null,
    topProcess: null,
    ram: {
      percent: 40.0,
      usedBytes: 1000,
      availableBytes: 2000,
      status: "normal",
      evidence: null,
      topProcess: null,
    },
    disk: {
      capacity: { totalBytes: 100, usedBytes: 50, freeBytes: 50, percent: 50.0 },
      activePercent: 1.0,
      ioStatus: "normal",
      ioEvidence: null,
      topIoProcess: null,
    },
    ...overrides,
  };
}

const cpuCandidate: Received = baseReceived({
  overloadStatus: "overload-candidate",
  overloadEvidence: {
    startedAt: "2026-08-29T05:00:00.000Z",
    endedAt: "2026-08-29T05:00:08.000Z",
    durationSeconds: 8.0,
    maxCpuPercent: 96.2,
  },
  topProcess: { pid: 111, name: "cpu-hog.exe", cpuPercent: 95.0 },
});

const tiedCandidates: Received = baseReceived({
  ram: {
    percent: 94.0,
    usedBytes: 1000,
    availableBytes: 100,
    status: "bottleneck-candidate",
    evidence: {
      startedAt: "2026-08-29T05:00:00.000Z",
      endedAt: "2026-08-29T05:00:06.000Z",
      durationSeconds: 6.0,
      maxRamPercent: 94.0,
    },
    topProcess: { pid: 5336, name: "powershell.exe", rss: 7346740429, memoryPercent: 40 },
  },
  disk: {
    capacity: { totalBytes: 100, usedBytes: 50, freeBytes: 50, percent: 50.0 },
    activePercent: 132.5,
    ioStatus: "bottleneck-candidate",
    ioEvidence: {
      startedAt: "2026-08-29T05:00:00.000Z",
      endedAt: "2026-08-29T05:00:06.000Z",
      durationSeconds: 6.0,
      maxDiskActivePercent: 132.5,
    },
    topIoProcess: { pid: 8821, name: "chrome.exe", bytesPerSec: 524698.9 },
  },
});

const allInsufficientData: Received = baseReceived({
  overloadStatus: "insufficient-data",
  ram: null,
  disk: null,
});

describe("AnalysisScreen 와이어프레임 상태", () => {
  const noop = () => {};

  it("loading 상태를 렌더링한다", () => {
    const html = renderToStaticMarkup(
      <AnalysisScreen status={null} isLoading onRequestReanalysis={noop} onBackToStart={noop} />
    );
    expect(html).toContain("측정 중");
  });

  it("no-data 상태를 렌더링한다", () => {
    const html = renderToStaticMarkup(
      <AnalysisScreen status={{ status: "no-data" }} isLoading={false} onRequestReanalysis={noop} onBackToStart={noop} />
    );
    expect(html).toContain("아직 수신된 데이터 없음");
  });

  it("error 상태를 렌더링한다", () => {
    const html = renderToStaticMarkup(
      <AnalysisScreen
        status={{ status: "fetch-failed" }}
        isLoading={false}
        onRequestReanalysis={noop}
        onBackToStart={noop}
      />
    );
    expect(html).toContain("조회 실패");
  });

  it("all normal 상태를 렌더링한다", () => {
    const html = renderToStaticMarkup(
      <AnalysisScreen status={baseReceived()} isLoading={false} onRequestReanalysis={noop} onBackToStart={noop} />
    );
    expect(html).toContain("측정한 CPU/RAM/Disk 범위에서 병목 후보가 발견되지 않았습니다");
  });

  it("insufficient-data 상태를 렌더링한다", () => {
    const html = renderToStaticMarkup(
      <AnalysisScreen
        status={allInsufficientData}
        isLoading={false}
        onRequestReanalysis={noop}
        onBackToStart={noop}
      />
    );
    expect(html).toContain("아직 판단할 데이터가 부족합니다");
  });

  it("bottleneck 1개 상태를 렌더링하고 그래프/추천 영역을 포함한다", () => {
    const html = renderToStaticMarkup(
      <AnalysisScreen status={cpuCandidate} isLoading={false} onRequestReanalysis={noop} onBackToStart={noop} />
    );
    expect(html).toContain("가장 의심되는 병목 후보: CPU");
    expect(html).toContain("예시 그래프");
    expect(html).toContain("CPU 사용률이 높은 프로그램 확인해보기");
  });

  it("bottleneck 여러 개(동률) 상태를 렌더링한다", () => {
    const html = renderToStaticMarkup(
      <AnalysisScreen status={tiedCandidates} isLoading={false} onRequestReanalysis={noop} onBackToStart={noop} />
    );
    expect(html).toContain("동시에 감지된 병목 후보: RAM, Disk");
  });
});

describe("StartScreen 와이어프레임 상태", () => {
  const noop = () => {};

  it("초기 상태를 렌더링한다", () => {
    const html = renderToStaticMarkup(
      <StartScreen
        code=""
        inputCode=""
        connectionCheck={null}
        onInputCodeChange={noop}
        onIssueCode={noop}
        onCheckConnection={noop}
        onStartAnalysis={noop}
      />
    );
    expect(html).toContain("아직 연결 코드가 없습니다");
  });

  it("연결 완료 상태를 렌더링한다", () => {
    const html = renderToStaticMarkup(
      <StartScreen
        code="ABC123"
        inputCode="ABC123"
        connectionCheck={baseReceived()}
        onInputCodeChange={noop}
        onIssueCode={noop}
        onCheckConnection={noop}
        onStartAnalysis={noop}
      />
    );
    expect(html).toContain("연결 완료");
  });

  it("연결 실패 상태를 렌더링한다", () => {
    const html = renderToStaticMarkup(
      <StartScreen
        code="ABC123"
        inputCode="ABC123"
        connectionCheck={{ status: "fetch-failed" }}
        onInputCodeChange={noop}
        onIssueCode={noop}
        onCheckConnection={noop}
        onStartAnalysis={noop}
      />
    );
    expect(html).toContain("연결 실패");
  });
});

describe("CompareScreen 와이어프레임 상태", () => {
  const noop = () => {};

  it("previousStatus 없음(empty state)을 렌더링한다", () => {
    const html = renderToStaticMarkup(
      <CompareScreen
        previousStatus={null}
        currentStatus={null}
        isLoading={false}
        onReanalyze={noop}
        onBackToAnalysis={noop}
      />
    );
    expect(html).toContain("비교할 이전 분석 결과가 없습니다");
  });

  it("개선 시나리오(RAM 94% → 67%)를 렌더링한다", () => {
    const previous = tiedCandidates;
    const current = baseReceived({ ram: { ...baseReceived().ram!, percent: 67.0 } });

    const html = renderToStaticMarkup(
      <CompareScreen
        previousStatus={previous}
        currentStatus={current}
        isLoading={false}
        onReanalyze={noop}
        onBackToAnalysis={noop}
      />
    );

    expect(html).toContain("94.0%");
    expect(html).toContain("67.0%");
    expect(html).toContain("병목 후보 → 현재 측정에서는 발견되지 않음");
  });

  it("다시 분석 중(loading) 상태를 렌더링한다", () => {
    const html = renderToStaticMarkup(
      <CompareScreen
        previousStatus={baseReceived()}
        currentStatus={null}
        isLoading
        onReanalyze={noop}
        onBackToAnalysis={noop}
      />
    );
    expect(html).toContain("다시 측정 중");
  });
});
