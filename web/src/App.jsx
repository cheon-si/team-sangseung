import { useEffect, useState } from "react";
import { loadData } from "./data";
import MapTab from "./tabs/MapTab";
import ProbabilityTab from "./tabs/ProbabilityTab";

// 앱 뼈대: 데이터를 한 번 읽고 탭 두 개를 전환한다.
export default function App() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("prob");
  const [picked, setPicked] = useState(null);
  useEffect(() => { loadData().then(setData); }, []);

  if (!data) return <div className="p-8 text-slate-500">불러오는 중…</div>;
  const m = data.prob.meta;
  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      <header>
        <h1 className="text-2xl font-bold">막차 러시아룰렛</h1>
        <p className="text-slate-600 text-sm">
          서울 지하철 막차 환승, 시간표가 아니라 실제로 측정한 지연으로 본 성공 확률
        </p>
        {m.provisional && (
          <p className="mt-2 inline-block rounded bg-amber-100 text-amber-800 text-xs px-2 py-1">
            잠정 결과 (평일 {m.nights.weekday}밤 · 주말 {m.nights.weekend}밤 기준, 수집 진행 중)
          </p>
        )}
      </header>
      <nav className="flex gap-2">
        <TabButton on={tab === "prob"} onClick={() => setTab("prob")}>막차 러시아룰렛</TabButton>
        <TabButton on={tab === "map"} onClick={() => setTab("map")}>어디가 위험한가</TabButton>
      </nav>
      {tab === "prob" ? (
        <ProbabilityTab data={data} initialStation={picked} />
      ) : (
        <MapTab data={data} onPick={(s) => { setPicked(s); setTab("prob"); }} />
      )}
      <footer className="text-xs text-slate-400 pt-6 border-t">
        2026 통계최강자전 · 팀 상승. 서울 열린데이터광장 실시간 지하철 위치·도착 정보를 22:00~02:00, 3분 간격으로 직접
        수집해 계산했습니다. 노선 단위 지연 분포를 각 역에 적용한 값이며, 역별 개별 추정이 아닙니다.
      </footer>
    </div>
  );
}

function TabButton({ on, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-4 py-2 text-sm font-medium ${on ? "bg-slate-800 text-white" : "bg-white border border-slate-300 text-slate-700"}`}
    >
      {children}
    </button>
  );
}
