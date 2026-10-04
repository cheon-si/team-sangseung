import { useCallback, useEffect, useState } from "react";
import BottomSheet from "../components/BottomSheet";
import DepartureStrip from "../components/DepartureStrip";
import Icon from "../components/Icon";
import MissedAlt from "../components/MissedAlt";
import Modal from "../components/Modal";
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
import { loadSaved, saveValue } from "../settings";
import { nearestId, nearestStations, serviceDayOf, serviceEndOf, stationById, useDayData, usePlan } from "../usePlan";

const DAY_SHORT = { DAY: "평일", SAT: "토요일", END: "휴일" };

// 화면 1·2. 모바일: 지도 전면 + 끌어올리는 하단 시트. 넓은 화면: 왼쪽 패널 + 오른쪽 지도.
// data = 기본 엔진 data(역·지연 분포, 시간표 없음), raw = 그 원본 JSON. 요일 시간표는 useDayData 가 그 요일만 읽는다.
export default function MainScreen({ data: baseData, raw, home, onChangeHome, preset, onOpenRisk, onPreset }) {
  const desktop = useMediaQuery("(min-width: 768px)");
  const [demo, setDemo] = useState(() => (preset.nowSec != null || preset.tag ? { nowSec: preset.nowSec, tag: preset.tag } : null));
  const clock = useClock(demo);
  const day = useDayData(raw, clock.tag);
  const data = day.data ?? baseData; // 시간표를 읽는 동안에도 역 검색·지도 핀은 그린다
  const [origin, setOrigin] = useState(() => initialOrigin(baseData, preset)); // {id, via: url|saved|geo|pick, walkSec?}
  const [userPos, setUserPos] = useState(null);
  const [nearby, setNearby] = useState([]);
  const [toast, setToast] = useState(null);
  const [selDep, setSelDep] = useState(null); // 출발 시각 띠에서 고른 출발(없으면 가장 빨리 도착하는 여정)
  const [transferIdx, setTransferIdx] = useState(null);
  const [modal, setModal] = useState(null); // time | origin | home | menu
  const [snap, setSnap] = useState("peek");
  const [sheet, setSheet] = useState({ peek: 280, height: 280 });

  const plan = usePlan(day.data, { origin: origin?.id, home, tag: clock.tag, nowSec: clock.nowSec });
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
      onChangeHome={() => setModal("home")} onPickOrigin={() => setModal("origin")} onLocate={() => locate(true)}
      onShowRoute={showRoute} onOpenTime={() => setModal("time")}
    />
  );

  const body = (
    <div className="pb-[max(env(safe-area-inset-bottom),28px)]">
      {ok && <DepartureStrip options={options} selectedDep={journey?.depart_sec} leaveBy={plan.leave_by} onSelect={setSelDep} />}
      {ok && <SaferHint journey={journey} safe={plan.leave_by?.safe} onSelect={setSelDep} />}
      {journey && (
        <RouteTimeline
          data={data} journey={journey} homeId={home}
          originWalkSec={origin?.via === "geo" ? origin.walkSec : null}
          onTransferClick={openTransfer}
        />
      )}
      {altStation && <MissedAlt station={altStation} near={stationById(data, altStation)} title={criticalAt ? "놓치면" : "대안"} />}
      <section className="px-4 pt-8">
        <button type="button" onClick={onOpenRisk} className="flex min-h-16 w-full items-center gap-3 rounded-2xl bg-night-800 px-4 text-left hover:bg-night-700">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-night-700 text-ink-300">
            <Icon name="chart" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">위험한 환승역</span>
            <span className="block text-[13px] text-ink-400">역별 막차 환승 확률표와 위험 지도</span>
          </span>
          <Icon name="chevronRight" className="h-5 w-5 text-ink-400" />
        </button>
      </section>
      <Footnote />
    </div>
  );

  const topBar = (floating) => (
    <TopBar
      floating={floating} clock={clock} originId={origin?.id}
      onTime={() => setModal("time")} onOrigin={() => setModal("origin")} onMenu={() => setModal("menu")}
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
      className={`absolute z-10 flex h-12 w-12 items-center justify-center rounded-full bg-night-900/95 text-ink-100 shadow-lg ring-1 ring-night-600 ${cls}`}
    >
      <Icon name="locate" className="h-6 w-6" />
    </button>
  );

  return (
    <>
      {desktop ? (
        <div className="flex h-dvh overflow-hidden">
          <aside className="flex w-[400px] shrink-0 flex-col border-r border-night-700 bg-night-900">
            {topBar(false)}
            <div className="dark-scroll min-h-0 flex-1 overflow-y-auto">
              {summary}
              {body}
            </div>
          </aside>
          <main className="relative min-w-0 flex-1">
            {map(48, 48)}
            {locateButton("right-4 bottom-6")}
          </main>
        </div>
      ) : (
        <div className="relative h-dvh overflow-hidden bg-night-900">
          {/* 지도는 요약 시트 위까지만: 카카오맵 로고가 가려지지 않게 */}
          <div className="absolute inset-x-0 top-0" style={{ bottom: Math.max(0, sheet.peek - 1) }}>
            {map(76, snap === "mid" ? sheet.height - sheet.peek + 32 : 32)}
            {locateButton("right-3 bottom-8")}
          </div>
          {topBar(true)}
          <BottomSheet snap={snap} onSnapChange={setSnap} summary={summary} onLayout={setSheet}>
            {body}
          </BottomSheet>
        </div>
      )}

      {toast && (
        <div role="status" className="pointer-events-none fixed inset-x-0 top-[calc(max(env(safe-area-inset-top),12px)+56px)] z-[60] flex justify-center px-4 md:left-[400px]">
          <span className="rounded-full bg-night-800/95 px-4 py-2.5 text-[14px] font-medium shadow-lg ring-1 ring-night-600">{toast}</span>
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
      {(modal === "origin" || modal === "home") && (
        <Modal onClose={close} labelledBy="picker-title" tall>
          <div className="flex min-h-0 flex-1 flex-col px-4 pt-1 pb-3">
            <h2 id="picker-title" className="px-1 pb-3 text-[20px] font-bold">{modal === "origin" ? "어디서 출발하나요?" : "집 근처 역을 골라 주세요"}</h2>
            {modal === "origin" && (
              <button
                type="button"
                onClick={() => { locate(true); close(); }}
                className="mb-3 flex min-h-12 shrink-0 items-center gap-2 rounded-2xl bg-night-700 px-4 text-left font-semibold"
              >
                <Icon name="locate" className="h-5 w-5 text-me" /> 현위치에서 가장 가까운 역
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
            {modal === "home" && <p className="pt-2 text-center text-[12px] text-ink-500">브라우저에만 저장되고 서버로 보내지 않습니다.</p>}
          </div>
        </Modal>
      )}
      {modal === "menu" && (
        <Modal onClose={close} labelledBy="menu-title">
          <div className="px-3 pt-1 pb-4">
            <h2 id="menu-title" className="px-2 pb-2 text-[13px] font-semibold text-ink-400">메뉴</h2>
            <MenuItem icon="chart" title="위험한 환승역" sub="분석 결과 · 역별 막차 환승 확률" onClick={() => { close(); onOpenRisk(); }} />
            <MenuItem icon="home" title="집 역 바꾸기" sub={home} onClick={() => setModal("home")} />
            <MenuItem icon="pin" title="출발역 바꾸기" sub={origin?.id ?? "정하지 않음"} onClick={() => setModal("origin")} />
            <MenuItem icon="clock" title="시각·요일 바꾸기" sub="시연 모드" onClick={() => setModal("time")} />
            <h3 className="px-2 pt-4 pb-1 text-[13px] font-semibold text-ink-400">시연 프리셋 · 평일</h3>
            <PresetList onPick={(p) => { close(); onPreset(p); }} />
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

function TopBar({ floating, clock, originId, onTime, onOrigin, onMenu }) {
  return (
    <div
      className={
        floating
          ? "pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center gap-2 px-3 pt-[max(env(safe-area-inset-top),12px)]"
          : "flex items-center gap-2 px-4 pt-4 pb-1"
      }
    >
      <Chip onClick={onTime} accent={clock.isDemo}>
        <span className="whitespace-nowrap">
          {clock.isDemo ? "시연" : "지금"} <span className="tabular-nums">{hhmm(clock.nowSec)}</span> · {DAY_SHORT[clock.tag]}
        </span>
        <Icon name="chevronDown" className="h-4 w-4 shrink-0 opacity-70" />
      </Chip>
      <Chip onClick={onOrigin} className="min-w-0">
        <Icon name="pin" className="h-4 w-4 shrink-0" />
        <span className="truncate">{originId ? `${originId}에서` : "출발역 선택"}</span>
        <Icon name="chevronDown" className="h-4 w-4 shrink-0 opacity-70" />
      </Chip>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onMenu}
        aria-label="메뉴"
        className="pointer-events-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-night-900/95 text-ink-100 shadow-lg ring-1 ring-night-600"
      >
        <Icon name="menu" />
      </button>
    </div>
  );
}

function Chip({ onClick, accent, className = "", children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`pointer-events-auto flex h-11 items-center gap-1 rounded-full px-3 text-[14px] font-semibold shadow-lg ring-1 ${
        accent ? "bg-gamble text-night-950 ring-gamble" : "bg-night-900/95 text-ink-100 ring-night-600"
      } ${className}`}
    >
      {children}
    </button>
  );
}

function MenuItem({ icon, title, sub, onClick }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 text-left hover:bg-night-700">
      <Icon name={icon} className="h-5 w-5 shrink-0 text-ink-300" />
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-semibold">{title}</span>
        {sub && <span className="block truncate text-[13px] text-ink-400">{sub}</span>}
      </span>
      <Icon name="chevronRight" className="h-5 w-5 shrink-0 text-ink-500" />
    </button>
  );
}

// 고른 출발이 위험하면 더 안전한 출발을 한 줄로 권한다 ("23:44 출발하면 96% · 8분 일찍")
function SaferHint({ journey, safe, onSelect }) {
  if (!journey || !safe || journey.p_home >= THRESHOLDS.safe || safe.depart_sec === journey.depart_sec) return null;
  const diff = shownMinutes(safe.depart_sec, journey.depart_sec); // 화면에 보이는 두 시각의 차이(초는 버림)
  return (
    <div className="px-4 pt-3">
      <button
        type="button"
        onClick={() => onSelect(safe.depart_sec)}
        className={`flex min-h-12 w-full items-center gap-2 rounded-2xl border px-3.5 text-left ${TONE.safe.border} ${TONE.safe.soft}`}
      >
        <span className="flex-1 text-[14px]">
          <b className="tabular-nums">{hhmm(safe.depart_sec)}</b> 출발하면{" "}
          <b className={`tabular-nums ${TONE[toneOf(safe.p_home)].text}`}>{pctText(safe.p_home)}</b>
          <span className="text-ink-400"> · {Math.abs(diff)}분 {diff > 0 ? "일찍" : "늦게"}</span>
        </span>
        <Icon name="chevronRight" className="h-4 w-4 text-ink-400" />
      </button>
    </div>
  );
}

// 근거 한 줄: 실측 기간·밤 수 (delay_cdf.json meta)
function Footnote() {
  const cdf = useJson("delay_cdf");
  const n = cdf?.meta?.nights;
  if (!n?.list?.length) return null;
  const md = (d) => `${Number(d.slice(4, 6))}/${Number(d.slice(6, 8))}`;
  return (
    <p className="px-5 pt-5 text-[12px] leading-relaxed text-ink-500">
      확률은 {md(n.list[0])}~{md(n.list.at(-1))} 밤 22~02시에 직접 수집한 열차 지연(평일 {n.weekday}밤·주말 {n.weekend}밤
      {cdf.meta.provisional ? ", 잠정" : ""})으로 계산했어요. 주말 기록이 부족한 일부 노선은 평일 기록을 빌렸어요(환승 상세에 표시).
      환승이 여럿이면 환승끼리 서로 영향이 없다고 가정한 추정치예요. 시각은 시간표 기준이에요.
    </p>
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

