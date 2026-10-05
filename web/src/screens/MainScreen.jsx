import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import BottomSheet from "../components/BottomSheet";
import DepartureStrip from "../components/DepartureStrip";
import Icon from "../components/Icon";
import MissedAlt from "../components/MissedAlt";
import Modal from "../components/Modal";
import PaceSettings, { PaceChip } from "../components/PaceSettings";
import PresetList from "../components/PresetList";
import RouteMap from "../components/RouteMap";
import RouteTimeline from "../components/RouteTimeline";
import StationPicker from "../components/StationPicker";
import SummaryCard from "../components/SummaryCard";
import TimePanel from "../components/TimePanel";
import TransferSheet from "../components/TransferSheet";
import { THRESHOLDS } from "../config";
import { useJson } from "../data";
import { hhmm, pctText, shownMinutes, TONE, toneOf, untilText, withYeok } from "../format";
import { loadSaved, paceOptions, saveValue } from "../settings";
import { nearestId, nearestStations, serviceDayOf, serviceEndOf, stationById, useDayData, usePlan } from "../usePlan";

const DAY_SHORT = { DAY: "평일", SAT: "토요일", END: "휴일" };
const TABBAR_H = 68; // 하단 탭바 높이(안전 영역 제외). 모바일 시트는 이 위에 놓인다
// 탭바 실제 높이(아이폰 홈 막대 안전 영역 포함). App 의 위험한 환승역 화면도 같은 값으로 탭바 자리를 비운다
export const TABBAR_BOTTOM = "calc(60px + max(env(safe-area-inset-bottom), 8px))";

// 하단 탭: 귀가(이 화면) · 위험한 환승역 · 시연(프리셋·시각) · 내 역(집·출발역, 걸음 속도·여유)
const TABS = [
  { id: "home", icon: "home", label: "귀가" },
  { id: "risk", icon: "chart", label: "위험 환승역" },
  { id: "demo", icon: "play", label: "시연" },
  { id: "mine", icon: "pin", label: "내 역" },
];

// 화면 1·2. 모바일: 파랑 헤더 + 지도 전면 + 끌어올리는 하단 시트 + 하단 탭바. 넓은 화면: 왼쪽 패널(헤더·시트 내용·탭바) + 오른쪽 지도.
// data = 기본 엔진 data(역·지연 분포, 시간표 없음), raw = 그 원본 JSON. 요일 시간표는 useDayData 가 그 요일만 읽는다.
// riskOpen / methodOpen: 위험한 환승역 / 「어떻게 계산했나요」 화면이 위에 열려 있는가(탭바 활성 표시용). onCloseRisk 는 둘 다 닫는다
// pace / onChangePace: 걸음 속도·여유 선호(App 이 보관·저장, settings.js). 경로 탐색과 확률에 같이 들어간다
export default function MainScreen({
  data: baseData, raw, home, onChangeHome, preset, onOpenRisk, onCloseRisk, riskOpen, onPreset, onOpenMethod, methodOpen,
  pace, onChangePace,
}) {
  const desktop = useMediaQuery("(min-width: 768px)");
  const [demo, setDemo] = useState(() => (preset.nowSec != null || preset.tag ? { nowSec: preset.nowSec, tag: preset.tag } : null));
  const clock = useClock(demo);
  const day = useDayData(raw, clock.tag);
  const data = day.data ?? baseData; // 시간표를 읽는 동안에도 역 검색·지도 핀은 그린다
  const [origin, setOrigin] = useState(() => initialOrigin(baseData, preset)); // {id, via: url|saved|geo|pick, walkSec?}
  const [userPos, setUserPos] = useState(null);
  const [nearby, setNearby] = useState([]);
  const [toast, setToast] = useState(null);
  const [selDep, setSelDep] = useState(null); // 추천 출발 목록에서 고른 출발(없으면 가장 빨리 도착하는 여정)
  const [transferIdx, setTransferIdx] = useState(null);
  const [modal, setModal] = useState(null); // time | origin | home | menu | demo | mine | pace
  const [snap, setSnap] = useState("peek");
  const [sheet, setSheet] = useState({ peek: 280, height: 280 });
  const headerRef = useRef(null);
  const [headerH, setHeaderH] = useState(176); // 모바일 헤더 높이: 지도 위 여백·알림 위치에 쓴다

  const po = paceOptions(pace);
  const plan = usePlan(day.data, {
    origin: origin?.id, home, tag: clock.tag, nowSec: clock.nowSec, walkSpeed: po.walkSpeed, marginSec: po.marginSec,
  });
  const serviceEnd = day.data ? serviceEndOf(day.data, clock.tag) : null; // 그 요일 마지막 열차 출발

  // ── 고른 여정 ──
  const ok = plan?.status === "ok";
  const options = ok ? plan.options : [];
  const selOpt = selDep != null ? options.find((o) => o.depart_sec === selDep) : null;
  const journey = ok ? (selOpt?.journey ?? plan.best) : null;
  const isBest = !selOpt || selOpt.depart_sec === plan.best?.depart_sec;
  const transfer = journey && transferIdx != null ? journey.transfers?.[transferIdx] : null;

  // 출발역·집·요일이 바뀌면 고른 출발과 열린 환승 상세를 닫는다
  useEffect(() => {
    setSelDep(null);
    setTransferIdx(null);
  }, [origin?.id, home, clock.tag]);

  useEffect(() => {
    if (origin && (origin.via === "pick" || origin.via === "geo")) saveValue("origin", origin.id);
  }, [origin]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(id);
  }, [toast]);

  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    setHeaderH(el.offsetHeight);
    const ro = new ResizeObserver(() => setHeaderH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [desktop]);

  // 현위치 → 직선거리 가장 가까운 역을 출발역으로 (계약 3장 nearestStations).
  // 직접 요청했는데 위치를 못 쓰면(권한 거부·시간 초과·3km 밖) 출발역 고르기 창을 바로 연다.
  const locate = useCallback(
    (userAsked) => {
      const fallback = (msg) => {
        if (!userAsked) return;
        setToast(msg);
        setModal("origin");
      };
      if (!navigator.geolocation) {
        fallback("이 브라우저에서는 현위치를 쓸 수 없어요. 출발역을 골라 주세요.");
        return;
      }
      if (userAsked) setToast("현위치 찾는 중…");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const p = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          setUserPos(p);
          const near = nearestStations(baseData, p.lat, p.lon, 3).map((n) => ({ id: nearestId(n), walk_sec: n.walk_sec, distance_m: n.distance_m }));
          setNearby(near);
          const first = near[0];
          if (!first || first.distance_m > 3000) {
            fallback("가까운 역이 3km 넘게 떨어져 있어요. 출발역을 골라 주세요.");
            return;
          }
          // 이번 방문에 직접 고른 출발역은 자동 위치로 덮지 않는다
          setOrigin((cur) => (userAsked || !cur || cur.via !== "pick" ? { id: first.id, via: "geo", walkSec: first.walk_sec } : cur));
          if (userAsked) setToast(`${withYeok(first.id)}에서 출발 · 걸어서 약 ${untilText(first.walk_sec)}`);
        },
        (err) =>
          fallback(err.code === 1 ? "위치 권한이 꺼져 있어요. 출발역을 직접 골라 주세요." : "현위치를 찾지 못했어요. 출발역을 직접 골라 주세요."),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
      );
    },
    [baseData],
  );

  // 위치 권한을 이미 허락한 경우에만 자동으로 현위치를 쓴다(첫 화면부터 권한 창을 띄우지 않음). 시연 프리셋이면 건너뜀.
  useEffect(() => {
    if (preset.from) return;
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((s) => s.state === "granted" && locate(false))
      .catch(() => {});
  }, [preset.from, locate]);

  const openTransfer = useCallback((k) => setTransferIdx(k), []);
  const close = useCallback(() => setModal(null), []);
  const showRoute = () => {
    if (desktop) document.getElementById("route-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
    else setSnap(ok ? "full" : "mid");
  };

  // "놓치면" 대안을 보여 줄 역: 결정적 환승역 → (확률이 낮으면) 출발역 → (경로 없음) 출발역.
  // 놓친 환승이 없는 경우(출발역 대안)는 제목을 "놓치면" 대신 "대안"으로 쓴다
  const criticalAt = ok ? journey?.transfers?.find((t) => t.critical)?.at_station : null;
  const altStation = ok
    ? (criticalAt ?? (journey?.p_home < THRESHOLDS.alternative ? origin?.id : null))
    : plan?.status === "no_route" ? origin?.id : null;

  const summary = (
    <SummaryCard
      data={data} plan={plan} journey={journey} isBest={isBest} originId={origin?.id} homeId={home} clock={clock}
      dayStatus={day.status} onRetryDay={day.retry} serviceEnd={serviceEnd}
      onPickOrigin={() => setModal("origin")} onLocate={() => locate(true)}
      onShowRoute={showRoute} onOpenTime={() => setModal("time")}
    />
  );

  const body = (
    <div className="pb-6">
      {ok && (
        <DepartureStrip
          data={data} options={options} selectedDep={journey?.depart_sec} leaveBy={plan.leave_by} nowSec={clock.nowSec} onSelect={setSelDep}
        />
      )}
      {ok && <SaferHint journey={journey} safe={plan.leave_by?.safe} onSelect={setSelDep} />}
      {journey && (
        <RouteTimeline
          data={data} journey={journey} homeId={home}
          originWalkSec={origin?.via === "geo" ? origin.walkSec : null}
          onTransferClick={openTransfer}
        />
      )}
      {altStation && <MissedAlt station={altStation} near={stationById(data, altStation)} title={criticalAt ? "놓치면" : "대안"} />}
      <section className="px-3 pt-6">
        <button type="button" onClick={onOpenRisk} className="card-shadow flex min-h-16 w-full items-center gap-3 rounded-2xl bg-surface px-4 text-left hover:bg-chip/40">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-chip text-brand-ink">
            <Icon name="chart" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">위험한 환승역</span>
            <span className="block text-[13px] text-muted">역별 막차 환승 확률표와 위험 지도</span>
          </span>
          <Icon name="chevronRight" className="h-5 w-5 text-muted" />
        </button>
      </section>
      <Footnote onOpenMethod={onOpenMethod} />
    </div>
  );

  const header = (
    <Header
      headerRef={headerRef} desktop={desktop} clock={clock} originId={origin?.id} homeId={home}
      onTime={() => setModal("time")} onOrigin={() => setModal("origin")} onHome={() => setModal("home")}
      onLocate={() => locate(true)} onMenu={() => setModal("menu")} pace={pace} onPace={() => setModal("pace")}
    />
  );

  const map = (padTop, padBottom) => (
    <RouteMap
      data={data} journey={journey} originId={origin?.id} homeId={home} userPos={userPos}
      padTop={padTop} padBottom={padBottom} onTransferClick={openTransfer} zoomControl={desktop}
    />
  );

  const locateButton = (cls) => (
    <button
      type="button"
      onClick={() => locate(true)}
      aria-label="내 위치에서 가까운 역으로 출발"
      className={`absolute z-10 flex h-12 w-12 items-center justify-center rounded-full bg-brand-strong text-white shadow-[0_6px_18px_rgb(21_101_192/0.35)] ring-4 ring-white/70 ${cls}`}
    >
      <Icon name="locate" className="h-6 w-6" />
    </button>
  );

  // 탭바: 지금 열린 화면을 활성으로. 위험한 환승역은 App 이 이 화면 위에 덮어 연다
  const activeTab = riskOpen ? "risk" : modal === "demo" ? "demo" : modal === "home" || modal === "mine" ? "mine" : "home";
  const selectTab = (id) => {
    if (id === "risk") {
      if (!riskOpen) onOpenRisk();
      return;
    }
    if (riskOpen || methodOpen) onCloseRisk();
    setModal({ home: null, demo: "demo", mine: "mine" }[id]);
  };
  const tabBar = (fixed) => <TabBar active={activeTab} onSelect={selectTab} fixed={fixed} />;

  return (
    <>
      {desktop ? (
        <div className="flex h-dvh overflow-hidden bg-page">
          <aside className="z-10 flex w-[400px] shrink-0 flex-col bg-canvas shadow-[8px_0_30px_rgb(21_101_192/0.12)]">
            {header}
            <div className="soft-scroll min-h-0 flex-1 overflow-y-auto pt-3">
              {summary}
              {body}
            </div>
            {tabBar(false)}
          </aside>
          <main className="relative min-w-0 flex-1">
            {map(48, 48)}
            {locateButton("right-4 bottom-6")}
          </main>
        </div>
      ) : (
        <div className="relative h-dvh overflow-hidden bg-canvas">
          {/* 지도는 요약 시트 위까지만: 카카오맵 로고가 가려지지 않게 */}
          <div className="absolute inset-x-0 top-0" style={{ bottom: TABBAR_H + Math.max(0, sheet.peek - 1) }}>
            {map(headerH + 12, snap === "mid" ? sheet.height - sheet.peek + 32 : 32)}
            {locateButton("right-3 bottom-8")}
          </div>
          {header}
          <BottomSheet snap={snap} onSnapChange={setSnap} summary={summary} onLayout={setSheet} bottomOffset={TABBAR_H} bottomCss={TABBAR_BOTTOM}>
            {body}
          </BottomSheet>
          {tabBar(true)}
        </div>
      )}

      {toast && (
        <div
          role="status"
          className="pointer-events-none fixed inset-x-0 z-[75] flex justify-center px-4 md:left-[400px]"
          style={{ top: desktop ? 16 : headerH + 10 }}
        >
          <span className="rounded-full bg-text px-4 py-2.5 text-[14px] font-medium text-white shadow-lg">{toast}</span>
        </div>
      )}

      {modal === "time" && (
        <Modal onClose={close} labelledBy="time-title">
          <TimePanel
            clock={clock}
            onApply={(v) => { setDemo(v); close(); }}
            onReset={() => { setDemo(null); close(); }}
          />
        </Modal>
      )}
      {modal === "demo" && (
        <Modal onClose={close} labelledBy="demo-title">
          <div className="px-3 pt-1">
            <h2 id="demo-title" className="px-2 text-[20px] font-bold">시연</h2>
            <p className="px-2 pt-1 text-[14px] text-muted">발표용 경로를 바로 열거나, 시각·요일을 바꿔 그때 기준으로 계산해요.</p>
            <h3 className="px-2 pt-4 pb-1 text-[13px] font-semibold text-muted">시연 프리셋 · 평일</h3>
            <PresetList onPick={(p) => { close(); onPreset(p); }} />
          </div>
          <div className="mx-5 mt-3 h-px shrink-0 bg-line" />
          <TimePanel
            clock={clock}
            onApply={(v) => { setDemo(v); close(); }}
            onReset={() => { setDemo(null); close(); }}
          />
        </Modal>
      )}
      {(modal === "origin" || modal === "home") && (
        <Modal onClose={close} labelledBy="picker-title" tall>
          <div className="flex min-h-0 flex-1 flex-col px-4 pt-1 pb-3">
            <h2 id="picker-title" className="px-1 pb-3 text-[20px] font-bold">{modal === "origin" ? "어디서 출발하나요?" : "집 근처 역을 골라 주세요"}</h2>
            {modal === "origin" && (
              <button
                type="button"
                onClick={() => { locate(true); close(); }}
                className="mb-3 flex min-h-12 shrink-0 items-center gap-2 rounded-2xl bg-chip px-4 text-left font-semibold text-brand-ink"
              >
                <Icon name="locate" className="h-5 w-5" /> 현위치에서 가장 가까운 역
              </button>
            )}
            <StationPicker
              data={data}
              nearby={modal === "origin" ? nearby : null}
              currentId={modal === "origin" ? origin?.id : home}
              onPick={(id) => {
                if (modal === "origin") setOrigin({ id, via: "pick" });
                else onChangeHome(id);
                close();
              }}
            />
            {modal === "home" && <p className="pt-2 text-center text-[12px] text-muted">브라우저에만 저장되고 서버로 보내지 않습니다.</p>}
          </div>
        </Modal>
      )}
      {modal === "menu" && (
        <Modal onClose={close} labelledBy="menu-title">
          <div className="px-3 pt-1 pb-4">
            <h2 id="menu-title" className="px-2 pb-2 text-[13px] font-semibold text-muted">메뉴</h2>
            <MenuItem icon="chart" title="위험한 환승역" sub="분석 결과 · 역별 막차 환승 확률" onClick={() => { close(); onOpenRisk(); }} />
            <MenuItem icon="info" title="어떻게 계산했나요" sub="데이터 · 판정 · 모형 · 검증 · 핵심 발견" onClick={() => { close(); onOpenMethod(); }} />
            <MenuItem icon="home" title="집 역 바꾸기" sub={home} onClick={() => setModal("home")} />
            <MenuItem icon="pin" title="출발역 바꾸기" sub={origin?.id ?? "정하지 않음"} onClick={() => setModal("origin")} />
            <MenuItem icon="clock" title="시각·요일 바꾸기" sub="시연 모드" onClick={() => setModal("time")} />
            <MenuItem icon="walk" title="걸음 속도·여유" sub={po.label} onClick={() => setModal("pace")} />
            <h3 className="px-2 pt-4 pb-1 text-[13px] font-semibold text-muted">시연 프리셋 · 평일</h3>
            <PresetList onPick={(p) => { close(); onPreset(p); }} />
          </div>
        </Modal>
      )}
      {modal === "pace" && (
        <Modal onClose={close} labelledBy="pace-title">
          <div className="px-5 pt-1 pb-6">
            <h2 id="pace-title" className="pb-1 text-[20px] font-bold">걸음 속도·여유</h2>
            <p className="pb-4 text-[14px] text-muted">내 걸음과 여유에 맞춰 환승 성공 확률을 다시 계산해요.</p>
            <PaceSettings pace={pace} onChange={onChangePace} />
          </div>
        </Modal>
      )}
      {modal === "mine" && (
        <Modal onClose={close} labelledBy="mine-title">
          <div className="px-5 pt-1 pb-6">
            <h2 id="mine-title" className="pb-3 text-[20px] font-bold">내 역</h2>
            <div className="divide-y divide-line rounded-2xl bg-canvas">
              <MineRow icon="home" label="집 근처 역" value={withYeok(home)} onClick={() => setModal("home")} />
              <MineRow icon="pin" label="출발역" value={origin?.id ? withYeok(origin.id) : "정하지 않음"} onClick={() => setModal("origin")} />
            </div>
            <h3 className="pt-6 pb-3 text-[17px] font-bold">걸음 속도·여유</h3>
            <PaceSettings pace={pace} onChange={onChangePace} />
          </div>
        </Modal>
      )}
      {transfer && (
        <Modal onClose={() => setTransferIdx(null)} labelledBy="transfer-title">
          <TransferSheet data={data} transfer={transfer} />
        </Modal>
      )}
    </>
  );
}

// 상단 헤더(레퍼런스 왼쪽 화면 축소판): 메뉴 · 출발 시각 / 흰 카드 안 출발·도착 두 줄 + 점선 + 오른쪽 둥근 현위치 버튼.
// 모바일은 지도 위에 떠 있고, 넓은 화면은 왼쪽 패널 맨 위에 붙는다.
// 헤더 오른쪽은 연하늘이라 흰 글씨 대비가 안 나와, 메뉴·시각 버튼은 진한 파랑 알약(.header-pill)에 얹는다
function Header({ headerRef, desktop, clock, originId, homeId, onTime, onOrigin, onHome, onLocate, onMenu, pace, onPace }) {
  return (
    <header
      ref={headerRef}
      className={`brand-header shrink-0 rounded-b-[28px] ${
        desktop ? "px-4 pt-4 pb-4" : "absolute inset-x-0 top-0 z-10 px-3 pt-[max(env(safe-area-inset-top),10px)] pb-3.5 shadow-[0_8px_24px_rgb(21_101_192/0.2)]"
      }`}
    >
      <div className="flex items-center gap-2">
        <button type="button" onClick={onMenu} aria-label="메뉴" className="header-pill flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
          <Icon name="menu" />
        </button>
        <button type="button" onClick={onTime} className="header-pill flex h-11 min-w-0 items-center gap-1.5 rounded-full pr-2.5 pl-3.5 text-[14px] font-medium">
          {clock.isDemo && <span className="rounded-full bg-gamble px-1.5 py-px text-[11px] font-bold text-[#1f2333]">시연</span>}
          <span className="truncate whitespace-nowrap">
            출발 시각: <b className="font-bold tabular-nums">{clock.isDemo ? hhmm(clock.nowSec) : `지금 ${hhmm(clock.nowSec)}`}</b> · {DAY_SHORT[clock.tag]}
          </span>
          <Icon name="chevronDown" className="h-4 w-4 shrink-0" />
        </button>
      </div>
      <div className="card-shadow mt-3 flex items-center gap-2 rounded-2xl bg-surface py-1 pr-2 pl-3.5 text-text">
        <div className="flex flex-col items-center self-stretch py-[19px]" aria-hidden="true">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-brand" />
          <span className="my-1 w-0 flex-1 border-l-2 border-dashed border-soft" />
          <span className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-brand bg-surface" />
        </div>
        <div className="min-w-0 flex-1">
          <PlaceRow label="출발" value={originId ? withYeok(originId) : "출발역 고르기"} empty={!originId} onClick={onOrigin} />
          <div className="ml-1 h-px bg-line" />
          <PlaceRow label="도착" value={`집(${homeId})`} onClick={onHome} />
        </div>
        <button
          type="button"
          onClick={onLocate}
          aria-label="내 위치에서 가까운 역으로 출발"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-strong text-white shadow-[0_4px_12px_rgb(21_101_192/0.35)]"
        >
          <Icon name="locate" className="h-6 w-6" />
        </button>
      </div>
      {/* 걸음 속도·여유 칩: 출발·도착 카드 바로 아래. 누르면 설정 시트 */}
      <div className="mt-2 flex">
        <PaceChip pace={pace} onClick={onPace} />
      </div>
    </header>
  );
}

function PlaceRow({ label, value, empty = false, onClick }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-12 w-full flex-col items-start justify-center rounded-lg px-1 text-left hover:bg-canvas">
      <span className="text-[12px] leading-4 text-muted">{label}</span>
      <span className={`w-full truncate text-[15px] leading-5 font-bold ${empty ? "text-brand-ink" : ""}`}>{value}</span>
    </button>
  );
}

// 하단 탭바(흰색, 위 모서리 둥글게). 활성 탭은 파랑 채운 둥근 사각형 + 흰 아이콘. 아이콘만으로는 뜻이 모호해 작은 이름을 붙인다
function TabBar({ active, onSelect, fixed }) {
  return (
    <nav
      aria-label="주요 화면"
      className={`${fixed ? "fixed inset-x-0 bottom-0 z-[65]" : "relative shrink-0"} rounded-t-[28px] bg-surface px-2 pt-2 pb-[max(env(safe-area-inset-bottom),8px)] shadow-[0_-6px_24px_rgb(21_101_192/0.1)]`}
    >
      <ul className="grid grid-cols-4">
        {TABS.map((t) => {
          const on = active === t.id;
          return (
            <li key={t.id}>
              <button
                type="button"
                aria-current={on ? "page" : undefined}
                onClick={() => onSelect(t.id)}
                className="flex h-[52px] w-full flex-col items-center justify-center gap-0.5 rounded-xl"
              >
                <span className={`flex h-8 w-12 items-center justify-center rounded-xl transition-colors ${on ? "bg-brand-strong text-white" : "text-brand"}`}>
                  <Icon name={t.icon} className="h-[22px] w-[22px]" strokeWidth={on ? 2.3 : 2} />
                </span>
                <span className={`text-[11px] leading-4 font-semibold ${on ? "text-brand-ink" : "text-muted"}`}>{t.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// 「내 역」 시트의 한 줄: 아이콘 · 이름 · 지금 값 · ›
function MineRow({ icon, label, value, onClick }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-14 w-full items-center gap-3 px-4 text-left">
      <Icon name={icon} className="h-5 w-5 shrink-0 text-brand-ink" />
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] text-muted">{label}</span>
        <span className="block truncate text-[16px] font-semibold">{value}</span>
      </span>
      <Icon name="chevronRight" className="h-5 w-5 shrink-0 text-muted" />
    </button>
  );
}

function MenuItem({ icon, title, sub, onClick }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 text-left hover:bg-canvas">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-chip text-brand-ink">
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-semibold">{title}</span>
        {sub && <span className="block truncate text-[13px] text-muted">{sub}</span>}
      </span>
      <Icon name="chevronRight" className="h-5 w-5 shrink-0 text-muted" />
    </button>
  );
}

// 고른 출발이 위험하면 더 안전한 출발을 한 줄로 권한다 ("23:44 출발하면 96% · 8분 일찍")
function SaferHint({ journey, safe, onSelect }) {
  if (!journey || !safe || journey.p_home >= THRESHOLDS.safe || safe.depart_sec === journey.depart_sec) return null;
  const diff = shownMinutes(safe.depart_sec, journey.depart_sec); // 화면에 보이는 두 시각의 차이(초는 버림)
  return (
    <div className="px-3 pt-3">
      <button
        type="button"
        onClick={() => onSelect(safe.depart_sec)}
        className={`flex min-h-12 w-full items-center gap-2 rounded-2xl border bg-surface px-3.5 text-left ${TONE.safe.border}`}
      >
        <span className="flex-1 text-[14px]">
          <b className="tabular-nums">{hhmm(safe.depart_sec)}</b> 출발하면{" "}
          <b className={`tabular-nums ${TONE[toneOf(safe.p_home)].text}`}>{pctText(safe.p_home)}</b>
          <span className="text-muted"> · {Math.abs(diff)}분 {diff > 0 ? "일찍" : "늦게"}</span>
        </span>
        <Icon name="chevronRight" className="h-4 w-4 text-muted" />
      </button>
    </div>
  );
}

// 근거 한 줄: B 모형 설명·학습 밤·검증 수치(model_b_findings.json, 수치는 export_model_b.py 한 곳에서 관리)
function Footnote({ onOpenMethod }) {
  const f = useJson("model_b_findings");
  const cdf = useJson("delay_cdf");
  if (!f) return null;
  const v = f.validation;
  return (
    <div className="px-4 pt-5 text-[12px] leading-relaxed text-muted">
      <p>
        확률은 다중회귀(노선·요일·경과 운행시간) + 과거 오차 분포로 계산했어요({f.data.period} {f.data.nights}밤 직접 수집
        {cdf?.meta?.provisional ? ", 잠정" : ""}). 시간표 판단보다 오차(Brier)가 {v.reduction_pct}% 작아요({v.brier_baseline}→{v.brier_model}).
        환승이 여럿이면 환승끼리 서로 영향이 없다고 가정한 추정치예요. 시각은 시간표 기준이에요.
      </p>
      {onOpenMethod && (
        <button type="button" onClick={onOpenMethod} className="mt-1 flex min-h-11 items-center gap-1 font-semibold text-brand-ink">
          어떻게 계산했나요 <Icon name="chevronRight" className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// 지금 시각(30초마다 갱신) 또는 시연 모드 고정 시각. nowSec 는 분 단위로 내려 계획을 매초 다시 계산하지 않게 한다.
function useClock(demo) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (demo?.nowSec != null) return;
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, [demo]);
  const real = serviceDayOf(now);
  return {
    nowSec: demo?.nowSec ?? Math.floor(real.nowSec / 60) * 60,
    tag: demo?.tag ?? real.tag,
    isDemo: demo != null,
  };
}

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

// 출발역 처음 값: URL 프리셋 → 지난번 출발역 → 없음(현위치 또는 직접 고르기)
function initialOrigin(data, preset) {
  for (const [id, via] of [[preset.from, "url"], [loadSaved("origin"), "saved"]]) {
    if (id && stationById(data, id)) return { id, via };
  }
  return null;
}
