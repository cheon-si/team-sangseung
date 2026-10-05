import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { presetQuery } from "./config";
import HomeSetup from "./screens/HomeSetup";
import MainScreen, { TABBAR_BOTTOM } from "./screens/MainScreen";
import { initialPace, loadSaved, readPreset, savePace, saveValue } from "./settings";
import { stationById, useRouteData } from "./usePlan";

// 보조 화면(위험한 환승역 · 어떻게 계산했나요)은 열 때만 불러온다(위험한 환승역은 그래프 라이브러리가 무겁다)
const RiskScreen = lazy(() => import("./screens/RiskScreen"));
const MethodScreen = lazy(() => import("./screens/MethodScreen"));

const VIEWS = { "#risk": "risk", "#method": "method" };
const viewOfHash = () => VIEWS[window.location.hash] ?? "main";

// 앱 뼈대: 기본 데이터(역·지연 분포)를 한 번 읽고 화면을 고른다. 요일 시간표는 메인 화면이 그 요일만 따로 읽는다.
// 집 역 없음 → 화면 0(집 등록) / 있음 → 화면 1·2(지도 + 시트) / #risk → 위험한 환승역(보고서·심사용)
// #method → 「어떻게 계산했나요」(B 모형 설명)
export default function App() {
  const [preset, setPreset] = useState(readPreset);
  const route = useRouteData();
  const [home, setHome] = useState(() => preset.home || loadSaved("home"));
  const [view, setView] = useState(viewOfHash);
  // 걸음 속도·여유 선호: 시연 URL(&walk=&margin=) → 저장값 → 기본. 메인·위험한 환승역 화면이 같이 쓴다
  const [pace, setPace] = useState(initialPace);
  const changePace = (next) => {
    setPace(next);
    savePace(next);
  };
  const openedInApp = useRef(0); // 앱 안에서 연 보조 화면 수(1이면 뒤로 가기로 닫는다)

  useEffect(() => {
    const onHash = () => setView(viewOfHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // 보조 화면끼리는 쌓지 않는다(위험한 환승역 → 어떻게 계산했나요로 가면 바꿔 끼움). 닫으면 항상 지도 화면으로
  const openView = (name) => {
    if (viewOfHash() !== "main") {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${name}`);
      setView(name);
      return;
    }
    openedInApp.current += 1;
    window.location.hash = name;
  };
  const openRisk = () => openView("risk");
  const openMethod = () => openView("method");
  const closeRisk = () => {
    // 앱 안에서 열었으면 뒤로 가기, 링크로 바로 들어왔으면 주소만 바꾼다
    if (openedInApp.current > 0) {
      openedInApp.current -= 1;
      window.history.back();
    } else {
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

  // 메인 화면(하단 탭바 있음)을 그리는가: 집이 등록돼 있고 기본 데이터를 읽었을 때
  const withTabs = route.status === "ready" && !!home && !!stationById(route.data, home);
  const desktop = useMediaQuery("(min-width: 768px)");

  // 위험한 환승역은 지도 화면 위에 덮어 연다(돌아왔을 때 출발역·시연 시각이 그대로 남도록).
  // 모바일 메인 화면에서는 하단 탭바가 보이도록 탭바 높이만큼 비운다(넓은 화면은 전체를 덮고 뒤로 가기 버튼을 쓴다)
  const risk = (view === "risk" || view === "method") && (
    <div
      className="fixed inset-x-0 top-0 z-[60] overflow-y-auto bg-canvas"
      style={{ bottom: withTabs && !desktop ? TABBAR_BOTTOM : 0 }}
    >
      <Suspense fallback={<p className="p-8 text-muted">불러오는 중…</p>}>
        {view === "risk" ? (
          <RiskScreen onBack={closeRisk} onOpenMethod={openMethod} pace={pace} />
        ) : (
          <MethodScreen onBack={closeRisk} />
        )}
      </Suspense>
    </div>
  );

  let main;
  if (route.status === "loading") main = <Splash text="역 정보 불러오는 중…" />;
  else if (route.status === "error") main = <Splash text="데이터를 불러오지 못했어요. 인터넷 연결을 확인해 주세요." onRetry={route.retry} />;
  else if (!withTabs) main = <HomeSetup data={route.data} onPick={pickHome} onPreset={applyPreset} />;
  else {
    main = (
      <MainScreen
        key={preset.key}
        data={route.data} raw={route.raw} home={home} onChangeHome={pickHome} preset={preset}
        onOpenRisk={openRisk} onCloseRisk={closeRisk} riskOpen={view === "risk"} onPreset={applyPreset}
        onOpenMethod={openMethod} methodOpen={view === "method"} pace={pace} onChangePace={changePace}
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
    <div className="flex h-dvh flex-col items-center justify-center gap-2 bg-canvas px-6 text-center">
      <p className="text-[15px] font-extrabold tracking-wide text-brand-ink">막차될까</p>
      <p className="text-[15px] text-muted" role={onRetry ? "alert" : "status"}>{text}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-3 min-h-12 rounded-2xl bg-brand-strong px-6 font-bold text-white">
          다시 시도
        </button>
      )}
    </div>
  );
}

// 화면 폭 조건(넓은 화면 여부). MainScreen 의 같은 이름 함수와 같은 동작
function useMediaQuery(query) {
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const onChange = () => setOn(m.matches);
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, [query]);
  return on;
}
