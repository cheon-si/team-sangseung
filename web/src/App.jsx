import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { presetQuery } from "./config";
import HomeSetup from "./screens/HomeSetup";
import MainScreen from "./screens/MainScreen";
import { loadSaved, readPreset, saveValue } from "./settings";
import { stationById, useRouteData } from "./usePlan";

// 보조 화면(위험한 환승역)은 그래프 라이브러리가 무거워 열 때만 불러온다
const RiskScreen = lazy(() => import("./screens/RiskScreen"));

// 앱 뼈대: 기본 데이터(역·지연 분포)를 한 번 읽고 화면을 고른다. 요일 시간표는 메인 화면이 그 요일만 따로 읽는다.
// 집 역 없음 → 화면 0(집 등록) / 있음 → 화면 1·2(지도 + 시트) / #risk → 위험한 환승역(보고서·심사용)
export default function App() {
  const [preset, setPreset] = useState(readPreset);
  const route = useRouteData();
  const [home, setHome] = useState(() => preset.home || loadSaved("home"));
  const [view, setView] = useState(() => (window.location.hash === "#risk" ? "risk" : "main"));
  const openedInApp = useRef(false);

  useEffect(() => {
    const onHash = () => setView(window.location.hash === "#risk" ? "risk" : "main");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const openRisk = () => {
    openedInApp.current = true;
    window.location.hash = "risk";
  };
  const closeRisk = () => {
    // 앱 안에서 열었으면 뒤로 가기, 링크로 바로 들어왔으면 주소만 바꾼다
    if (openedInApp.current) window.history.back();
    else {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      setView("main");
    }
  };

  const pickHome = (id) => {
    setHome(id);
    // URL 프리셋으로 들어온 시연에서는 저장된 집을 덮지 않는다
    if (!preset.home) saveValue("home", id);
  };

  // 시연 프리셋 열기: 주소를 프리셋 쿼리로 바꾸고 메인 화면을 그 값으로 새로 그린다(MainScreen key).
  // 저장된 집·출발역은 건드리지 않는다.
  const applyPreset = (p) => {
    window.history.replaceState(null, "", `${window.location.pathname}?${presetQuery(p)}`);
    const next = readPreset();
    setPreset(next);
    setHome(next.home);
  };

  // 위험한 환승역은 지도 화면 위에 덮어 연다(돌아왔을 때 출발역·시연 시각이 그대로 남도록)
  const risk = view === "risk" && (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-slate-50">
      <Suspense fallback={<p className="p-8 text-slate-500">불러오는 중…</p>}>
        <RiskScreen onBack={closeRisk} />
      </Suspense>
    </div>
  );

  let main;
  if (route.status === "loading") main = <Splash text="역 정보 불러오는 중…" />;
  else if (route.status === "error") main = <Splash text="데이터를 불러오지 못했어요. 인터넷 연결을 확인해 주세요." onRetry={route.retry} />;
  else if (!home || !stationById(route.data, home)) main = <HomeSetup data={route.data} onPick={pickHome} onPreset={applyPreset} />;
  else {
    main = (
      <MainScreen
        key={preset.key}
        data={route.data} raw={route.raw} home={home} onChangeHome={pickHome} preset={preset}
        onOpenRisk={openRisk} onPreset={applyPreset}
      />
    );
  }

  return (
    <>
      {main}
      {risk}
    </>
  );
}

function Splash({ text, onRetry }) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-2 px-6 text-center">
      <p className="text-[13px] font-bold tracking-wide text-ink-400">막차 러시아룰렛</p>
      <p className="text-[15px] text-ink-300" role={onRetry ? "alert" : "status"}>{text}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-3 min-h-12 rounded-2xl bg-ink-100 px-6 font-bold text-night-900">
          다시 시도
        </button>
      )}
    </div>
  );
}
