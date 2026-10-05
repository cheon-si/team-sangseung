import { useEffect, useRef, useState } from "react";
import { TONE, toneOf } from "../format";
import { loadKakaoMaps } from "../kakao";

// 위험한 환승역 지도(카카오맵). 환승역마다 점 하나: 색 = 그 요일에 시간표상 갈아탈 수 있는 막차 환승 중 가장 낮은 성공 확률,
// 크기 = 23시·0시 하차 인원. 위험·아슬아슬한 역과 고른 역에는 이름표를 붙인다. 점을 누르면 그 역만 목록에 남긴다.
// worst: Map(물리 역 id → 최악 확률, B 모형 p_b). 없는 역은 "시간표상 가능한 조합 없음"(회색).
export default function RiskMap({ stations, worst, selected, onSelect }) {
  const boxRef = useRef(null);
  const mapRef = useRef(null);
  const drawnRef = useRef([]);
  const boundsRef = useRef(null); // 환승역 전체 범위. 창 크기가 바뀌면 다시 맞춘다
  const selectRef = useRef(onSelect);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    selectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    let alive = true;
    loadKakaoMaps()
      .then((kakao) => {
        if (!alive || !boxRef.current || mapRef.current) return;
        const map = new kakao.maps.Map(boxRef.current, { center: new kakao.maps.LatLng(37.54, 126.99), level: 9 });
        const bounds = new kakao.maps.LatLngBounds();
        stations.filter((s) => s.lat && s.lon).forEach((s) => bounds.extend(new kakao.maps.LatLng(s.lat, s.lon)));
        boundsRef.current = bounds.isEmpty() ? null : bounds;
        if (boundsRef.current) map.setBounds(boundsRef.current, 24, 24, 24, 24);
        // 축소된 상태(레벨 8 이상)에서는 도심 이름표가 서로 겹치므로 위험·선택한 역만 남기고, 확대하면 아슬아슬한 역도 보인다
        const markCoarse = () => boxRef.current?.setAttribute("data-coarse", map.getLevel() >= 8 ? "1" : "0");
        kakao.maps.event.addListener(map, "zoom_changed", markCoarse);
        markCoarse();
        mapRef.current = map;
        setStatus("ready");
      })
      .catch(() => alive && setStatus("failed"));
    return () => {
      alive = false;
    };
  }, [stations]);

  // 컨테이너 크기가 바뀌면(모바일↔데스크톱) 지도를 다시 배치하고 환승역 전체가 보이게 다시 맞춘다
  // (데스크톱 크기에서 맞춘 범위를 그대로 두면 좁은 화면에서는 서울 밖이 보인다)
  useEffect(() => {
    if (status !== "ready") return;
    const ro = new ResizeObserver(() => {
      const map = mapRef.current;
      if (!map) return;
      map.relayout();
      if (boundsRef.current) map.setBounds(boundsRef.current, 24, 24, 24, 24);
    });
    ro.observe(boxRef.current);
    return () => ro.disconnect();
  }, [status]);

  useEffect(() => {
    if (status !== "ready") return;
    const { kakao } = window;
    const map = mapRef.current;
    drawnRef.current.forEach((o) => o.setMap(null));
    const maxN = Math.max(1, ...stations.map((s) => s.night_alight || 0));
    const drawn = [];
    // 큰 점이 작은 점을 덮지 않게 큰 역부터 그린다(작은 점이 위에 올라옴)
    [...stations]
      .filter((s) => s.lat && s.lon)
      .sort((a, b) => (b.night_alight || 0) - (a.night_alight || 0))
      .forEach((s) => {
        const p = worst.get(s.station);
        const tone = worst.has(s.station) ? toneOf(p) : "none";
        const isSel = selected === s.station;
        const size = Math.round(12 + 16 * Math.sqrt((s.night_alight || 0) / maxN));
        const el = dot(s, tone, size, isSel, tone === "danger" || isSel ? "always" : tone === "gamble" ? "zoomed" : null);
        el.addEventListener("click", () => selectRef.current?.(isSel ? null : s.station));
        drawn.push(
          new kakao.maps.CustomOverlay({
            map,
            position: new kakao.maps.LatLng(s.lat, s.lon),
            content: el,
            yAnchor: 0.5,
            zIndex: isSel ? 10 : tone === "danger" ? 6 : tone === "gamble" ? 5 : 2,
            clickable: true,
          }),
        );
      });
    drawnRef.current = drawn;
  }, [status, stations, worst, selected]);

  return (
    <div className="map-light relative h-full w-full bg-canvas">
      <div ref={boxRef} className="absolute inset-0" />
      {status !== "ready" && (
        <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-sm text-muted">
          {status === "loading" ? "지도 불러오는 중…" : "지도를 불러오지 못했어요. 아래 목록은 그대로 볼 수 있어요."}
        </div>
      )}
      {/* 카카오맵 내부 레이어가 z-index 를 쓰므로 그 위에 오도록 z-index 를 준다 */}
      <div className="card-shadow pointer-events-none absolute left-3 top-3 z-[500] inline-flex max-w-[calc(100%-24px)] flex-wrap gap-x-3 gap-y-1 rounded-xl bg-surface/95 px-3 py-2 text-[12px] text-text">
        <Legend tone="danger" text="50% 미만" />
        <Legend tone="gamble" text="50~80%" />
        <Legend tone="safe" text="80% 이상" />
        <Legend tone="none" text="해당 없음" />
        <span className="text-muted">· 크기 = 심야 하차 인원</span>
      </div>
    </div>
  );
}

function Legend({ tone, text }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: TONE[tone].hex }} />
      {text}
    </span>
  );
}

// 지도 위 점 DOM (React 밖). 역 이름은 textContent 로 넣는다.
function dot(station, tone, size, selected, label) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `risk-dot${selected ? " is-selected" : ""}`;
  el.style.setProperty("--size", `${size}px`);
  el.style.setProperty("--tone", TONE[tone].hex);
  el.setAttribute("aria-label", `${station.station} ${station.lines.join("·")}호선`);
  if (label) {
    const name = document.createElement("span");
    name.className = `risk-dot-label${label === "zoomed" ? " is-zoomed" : ""}`;
    name.textContent = station.station;
    el.append(name);
  }
  return el;
}
