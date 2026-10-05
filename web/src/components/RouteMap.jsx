import { useEffect, useRef, useState } from "react";
import { pctText, TONE, toneOf } from "../format";
import { loadKakaoMaps } from "../kakao";
import { lineColorOf, nodeOf, stationById } from "../usePlan";
import { iconSvg } from "./Icon";

const SEOUL = { lat: 37.5665, lon: 126.978 };
const SIDE_PAD = 70; // 화면 맞춤 좌우 여백(px). 핀·배지 라벨 폭의 절반보다 커야 가장자리에서 잘리지 않는다
const TIGHT_PAD = 20; // 한 단계 더 확대해 볼 때의 좌우 여백. 이름표가 전부 화면 안에 들어올 때만 그 단계를 쓴다
const EDGE = 6; // 이름표가 화면 가장자리에서 떨어져야 하는 최소 거리(px)
const SINGLE_LEVEL = 6; // 점이 하나뿐일 때(집만 등록) 동네가 보이는 확대 수준. setBounds 는 골목(30m)까지 확대해 버린다

// 화면 1·2의 지도(카카오맵). 구간별 노선 색 경로, 환승 배지(확률·판정 색), 출발·집·현위치를 그린다.
// 지도가 안 떠도(키 없음·도메인 미등록·네트워크) 시트는 따로 동작하도록 대체 문구만 보여 준다.
export default function RouteMap({ data, journey, originId, homeId, userPos, padTop = 76, padBottom = 32, onTransferClick, zoomControl = false }) {
  const boxRef = useRef(null);
  const mapRef = useRef(null);
  const drawnRef = useRef([]);
  const boundsRef = useRef(null); // { bounds, single } — single = 점이 하나뿐이면 그 좌표
  const fitKeyRef = useRef(null); // 마지막으로 화면을 맞춘 경로 범위
  const labelsRef = useRef([]); // 화면 맞춤 때 잘리지 않아야 하는 이름표(출발·집 핀, 환승 배지): { pos, el, yAnchor }
  const clickRef = useRef(onTransferClick);
  const padRef = useRef({ padTop, padBottom });
  const [status, setStatus] = useState("loading");
  const [attempt, setAttempt] = useState(0); // "다시 시도" 횟수(바뀌면 SDK 를 다시 불러온다)
  const [drawCount, setDrawCount] = useState(0);

  useEffect(() => {
    clickRef.current = onTransferClick;
    padRef.current = { padTop, padBottom };
  }, [onTransferClick, padTop, padBottom]);

  // SDK 로드 + 지도 생성 (1회)
  useEffect(() => {
    let alive = true;
    loadKakaoMaps()
      .then((kakao) => {
        if (!alive || !boxRef.current || mapRef.current) return;
        const map = new kakao.maps.Map(boxRef.current, { center: new kakao.maps.LatLng(SEOUL.lat, SEOUL.lon), level: 8 });
        if (zoomControl) map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
        mapRef.current = map;
        setStatus("ready");
      })
      .catch(() => alive && setStatus("failed"));
    return () => {
      alive = false;
    };
  }, [zoomControl, attempt]);

  // 컨테이너 크기가 바뀌면(시트 요약 높이·창 크기) 지도를 다시 배치하고 경로 전체가 보이게 다시 맞춘다.
  // (경로를 맞춘 뒤에 요약 높이가 정해져 지도가 줄어들면, 맞추지 않을 경우 경로 끝이 잘린다)
  useEffect(() => {
    if (status !== "ready") return;
    const ro = new ResizeObserver(() => {
      const map = mapRef.current;
      if (!map) return;
      map.relayout();
      fitView(map, boundsRef.current, padRef.current.padTop, padRef.current.padBottom, labelsRef.current, boxRef.current);
    });
    ro.observe(boxRef.current);
    return () => ro.disconnect();
  }, [status]);

  // 경로·배지·마커를 지우고 다시 그린다
  useEffect(() => {
    if (status !== "ready") return;
    const { kakao } = window;
    const map = mapRef.current;
    drawnRef.current.forEach((o) => o.setMap(null));
    const drawn = [];
    const bounds = new kakao.maps.LatLngBounds();
    const latlng = (p) => new kakao.maps.LatLng(p.lat, p.lon);
    const points = new Map(); // 화면 맞춤에 넣은 서로 다른 좌표(하나뿐이면 setBounds 대신 가운데 맞춤)
    const extend = (p) => {
      bounds.extend(p);
      points.set(p.toString(), p);
    };
    const labels = [];
    const addOverlay = (pos, content, zIndex, yAnchor = 1, isLabel = false) => {
      drawn.push(new kakao.maps.CustomOverlay({ map, position: latlng(pos), content, zIndex, yAnchor, clickable: true }));
      if (isLabel) labels.push({ pos: latlng(pos), el: content, yAnchor });
    };

    // 1) 탑승 구간: 정차 좌표 순서대로, 흰 테두리 위에 노선 색 선을 겹쳐 지도 위에서도 또렷하게
    for (const leg of journey?.legs ?? []) {
      if (leg.type !== "ride") continue;
      const stops = leg.stops.map((i) => nodeOf(data, i)).filter(Boolean);
      const path = stops.map(latlng);
      path.forEach(extend);
      const color = lineColorOf(data, leg.line);
      drawn.push(new kakao.maps.Polyline({ map, path, strokeWeight: 11, strokeColor: "#ffffff", strokeOpacity: 0.95 }));
      drawn.push(new kakao.maps.Polyline({ map, path, strokeWeight: 6, strokeColor: color, strokeOpacity: 1 }));
      stops.slice(1, -1).forEach((s) => addOverlay(s, stopDot(color), 2, 0.5));
    }

    // 2) 환승 지점 배지 (누르면 화면 3)
    (journey?.transfers ?? []).forEach((t, k) => {
      const at = nodeOf(data, t.to_node) ?? nodeOf(data, t.from_node);
      if (at) addOverlay(at, transferBadge(t, () => clickRef.current?.(k)), 6, 1, true);
    });

    // 3) 출발역·집
    const origin = stationById(data, originId);
    const home = stationById(data, homeId);
    if (origin) {
      addOverlay(origin, pin("pin", "출발", origin.name), 5, 1, true);
      extend(latlng(origin));
    }
    if (home && home.id !== origin?.id) {
      addOverlay(home, pin("home", "집", home.name), 5, 1, true);
      extend(latlng(home));
    }

    // 4) 현위치 (출발역에서 3km 안일 때만 화면 맞춤에 넣는다 — 멀리 있으면 지도가 너무 축소됨)
    if (userPos) {
      addOverlay(userPos, meDot(), 4, 0.5);
      if (!origin || distanceM(userPos, origin) < 3000) extend(latlng(userPos));
    }

    drawnRef.current = drawn;
    labelsRef.current = labels;
    boundsRef.current = bounds.isEmpty() ? null : { bounds, single: points.size === 1 ? [...points.values()][0] : null };
    // 화면 맞춤은 경로 범위가 바뀔 때만: 실시간 모드는 1분마다 계획을 다시 계산하는데,
    // 같은 경로인데도 다시 맞추면 사용자가 옮겨 둔 지도가 매분 되돌아간다
    const fitKey = boundsRef.current ? bounds.toString() : "";
    if (fitKey !== fitKeyRef.current) {
      fitKeyRef.current = fitKey;
      setDrawCount((c) => c + 1);
    }
  }, [status, data, journey, originId, homeId, userPos]);

  // 경로 범위가 바뀌었거나 시트 높이가 바뀌면 전체가 보이게 맞춘다
  useEffect(() => {
    if (status !== "ready" || !boundsRef.current) return;
    const map = mapRef.current;
    map.relayout();
    fitView(map, boundsRef.current, padTop, padBottom, labelsRef.current, boxRef.current);
  }, [status, drawCount, padTop, padBottom]);

  return (
    <div className="relative h-full w-full bg-night-800">
      <div ref={boxRef} className="absolute inset-0" />
      {status !== "ready" && (
        <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_50%_35%,#1a2a4f,#060c1b_70%)] px-8 pb-24 text-center">
          {status === "loading" ? (
            <p className="text-sm text-ink-400">지도 불러오는 중…</p>
          ) : (
            <div>
              <p className="font-semibold text-ink-100">지도를 불러오지 못했어요</p>
              <p className="mt-1 text-sm text-ink-400">경로와 귀가 확률은 아래 카드에서 그대로 볼 수 있어요.</p>
              <button
                type="button"
                onClick={() => {
                  setStatus("loading");
                  setAttempt((a) => a + 1);
                }}
                className="mt-4 min-h-11 rounded-xl bg-night-700 px-4 text-sm font-semibold text-ink-100"
              >
                다시 시도
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// 경로 전체가 보이게 맞춘다. 점이 하나뿐이면(집만 등록) 그 점을 가운데 두고 동네 수준으로.
// 카카오맵 확대 단계는 2배씩이라 넉넉한 좌우 여백(SIDE_PAD)으로 맞추면 경로가 화면의 절반 남짓만 차는 경우가 있다
// (375px 폭에서 마포→잠실 14km가 8km 축척으로 열림). 그래서 좁은 여백으로 한 단계 더 확대해 보고,
// 출발·집 핀과 환승 배지 이름표가 모두 화면(위 칩·아래 시트 제외) 안에 들어오면 그 단계를 쓴다.
function fitView(map, fit, padTop, padBottom, labels = [], box = null) {
  if (!fit) return;
  if (fit.single) {
    map.setLevel(SINGLE_LEVEL);
    map.setCenter(fit.single);
    return;
  }
  map.setBounds(fit.bounds, padTop, SIDE_PAD, padBottom, SIDE_PAD);
  if (!box) return;
  const loose = map.getLevel();
  map.setBounds(fit.bounds, padTop, TIGHT_PAD, padBottom, TIGHT_PAD);
  if (map.getLevel() < loose && !labelsFit(map, labels, box, padTop, padBottom)) {
    map.setBounds(fit.bounds, padTop, SIDE_PAD, padBottom, SIDE_PAD);
  }
}

// 이름표가 모두 보이는 영역 안에 있는가. 이름표는 좌표 위 가운데(xAnchor 0.5)에 yAnchor 비율만큼 올라가 그려진다.
// 위쪽은 상단 칩 줄(padTop)에 살짝 걸치는 것까지(절반), 아래쪽은 시트 윗선까지 허용한다.
function labelsFit(map, labels, box, padTop, padBottom) {
  const proj = map.getProjection();
  const W = box.clientWidth;
  const H = box.clientHeight;
  return labels.every(({ pos, el, yAnchor }) => {
    const p = proj.containerPointFromCoords(pos);
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (!w || !h) return false; // 아직 그려지지 않은 이름표는 크기를 모르니 넉넉한 여백을 쓴다
    const left = p.x - w / 2;
    const top = p.y - h * yAnchor;
    return left >= EDGE && left + w <= W - EDGE && top >= padTop / 2 && top + h <= H - padBottom + EDGE;
  });
}

// ── 지도 오버레이 DOM (React 밖). 역 이름은 textContent 로 넣는다. ──

// 환승 배지. 판정 색은 결정적 환승(놓치면 다음 열차로 귀가 불가)에만 칠한다.
// 놓쳐도 다음 열차로 귀가할 수 있는 환승을 p 색(주황·빨강)으로 칠하면 ">99%" 요약과 정반대 신호가 된다
function transferBadge(t, onClick) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "map-badge";
  el.style.background = TONE[t.critical ? toneOf(t.p) : "none"].hex;
  el.setAttribute(
    "aria-label",
    `${t.at_station} 환승 성공 확률 ${pctText(t.p)}, ${t.critical ? `놓치면 이 역에서 지하철로는 귀가 불가` : `놓쳐도 다른 열차로 귀가 ${pctText(t.q)}`}`,
  );
  if (t.critical) el.insertAdjacentHTML("beforeend", iconSvg("warning"));
  const name = document.createElement("small");
  name.textContent = t.at_station;
  el.append(name, ` ${pctText(t.p)}`);
  el.addEventListener("click", onClick);
  return el;
}

function pin(icon, label, name) {
  const el = document.createElement("div");
  el.className = "map-pin";
  el.insertAdjacentHTML("beforeend", iconSvg(icon));
  const b = document.createElement("b");
  b.textContent = label;
  el.append(b, name);
  return el;
}

function stopDot(color) {
  const el = document.createElement("div");
  el.className = "map-stop";
  el.style.color = color;
  return el;
}

function meDot() {
  const el = document.createElement("div");
  el.className = "me-dot";
  el.setAttribute("aria-label", "현위치");
  return el;
}

function distanceM(a, b) {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return 6371000 * Math.hypot(x, y);
}
