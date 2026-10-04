import { useEffect, useState } from "react";
import Icon from "../components/Icon";
import { loadData } from "../data";
import MapTab from "../tabs/MapTab";
import ProbabilityTab from "../tabs/ProbabilityTab";

// 보조 화면 "위험한 환승역" (보고서·심사용). 예전 탭 두 개(막차 환승 확률표, 위험 지도)를 그대로 보여 준다.
// 읽는 화면이라 밝은 배경을 쓴다.
export default function RiskScreen({ onBack }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState("prob");
  const [picked, setPicked] = useState(null);
  useEffect(() => {
    loadData().then(setData, () => setFailed(true));
  }, []);

  const m = data?.prob.meta;
  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-1 px-2 py-1">
          <button type="button" onClick={onBack} aria-label="귀가 경로로 돌아가기" className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-slate-100">
            <Icon name="chevronLeft" className="h-6 w-6" />
          </button>
          <h1 className="text-[17px] font-bold">위험한 환승역</h1>
        </div>
      </header>
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-6">
        <div>
          <p className="text-sm text-slate-600">
            서울 지하철 막차 환승, 시간표가 아니라 실제로 측정한 지연으로 본 성공 확률
          </p>
          {m?.provisional && (
            <p className="mt-2 inline-block rounded bg-amber-100 px-2 py-1 text-xs text-amber-800">
              잠정 결과 (평일 {m.nights.weekday}밤 · 주말 {m.nights.weekend}밤 기준, 수집 진행 중)
            </p>
          )}
        </div>
        <nav className="flex gap-2">
          <TabButton on={tab === "prob"} onClick={() => setTab("prob")}>막차 환승 확률</TabButton>
          <TabButton on={tab === "map"} onClick={() => setTab("map")}>어디가 위험한가</TabButton>
        </nav>
        {failed && <p className="text-slate-500">데이터를 불러오지 못했어요.</p>}
        {!data && !failed && <p className="text-slate-500">불러오는 중…</p>}
        {data &&
          (tab === "prob" ? (
            <ProbabilityTab data={data} initialStation={picked} />
          ) : (
            <MapTab data={data} onPick={(s) => { setPicked(s); setTab("prob"); }} />
          ))}
        <footer className="border-t pt-6 text-xs text-slate-400">
          2026 통계최강자전 · 팀 상승. 서울 열린데이터광장 실시간 지하철 위치·도착 정보를 22:00~02:00, 3분 간격으로 직접
          수집해 계산했습니다. 노선 단위 지연 분포를 각 역에 적용한 값이며, 역별 개별 추정이 아닙니다.
        </footer>
      </div>
    </div>
  );
}

function TabButton({ on, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-11 rounded-lg px-4 text-sm font-medium ${on ? "bg-slate-800 text-white" : "border border-slate-300 bg-white text-slate-700"}`}
    >
      {children}
    </button>
  );
}
