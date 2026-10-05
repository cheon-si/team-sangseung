import { DEFAULT_PACE, MARGIN_OPTIONS, WALK_OPTIONS } from "./config";
import { parseHHMM } from "./format";

// 브라우저 저장(localStorage)과 URL 프리셋.
// 저장은 개인 브라우저 안에서만 한다. 사생활 보호 모드 등에서 실패해도 앱은 그대로 돌아가야 하므로 모두 try/catch.

const KEYS = { home: "lastcall.home", origin: "lastcall.origin", walk: "lastcall.walk", margin: "lastcall.margin" };

export function loadSaved(name) {
  try {
    return window.localStorage.getItem(KEYS[name]);
  } catch {
    return null;
  }
}

export function saveValue(name, value) {
  try {
    if (value == null) window.localStorage.removeItem(KEYS[name]);
    else window.localStorage.setItem(KEYS[name], value);
  } catch {
    // 저장 못 해도 이번 방문에서는 고른 값을 그대로 쓴다
  }
}

// 시연 프리셋: ?from=역&home=역&t=HH:MM&day=DAY|SAT|END(&walk=slow|normal|fast&margin=0|30|60)
export function readPreset() {
  const q = new URLSearchParams(window.location.search);
  const day = q.get("day");
  return {
    key: window.location.search, // 프리셋이 바뀌면 메인 화면을 새로 그리는 데 쓴다
    from: q.get("from"),
    home: q.get("home"),
    nowSec: parseHHMM(q.get("t")),
    tag: ["DAY", "SAT", "END"].includes(day) ? day : null,
    walk: validWalk(q.get("walk")),
    margin: validMargin(q.get("margin")),
  };
}

const validWalk = (v) => (WALK_OPTIONS.some((o) => o.id === v) ? v : null);
const validMargin = (v) => (MARGIN_OPTIONS.some((o) => o.id === v) ? v : null);

// 걸음 속도·여유 선호 처음 값: URL 쿼리 → 저장값 → 기본(보통 · 0초)
export function initialPace() {
  const p = readPreset();
  return {
    walk: p.walk ?? validWalk(loadSaved("walk")) ?? DEFAULT_PACE.walk,
    margin: p.margin ?? validMargin(loadSaved("margin")) ?? DEFAULT_PACE.margin,
  };
}

// 바꾼 설정 저장. 주소에 walk·margin 이 있으면(시연 링크) 그 값도 바꿔, 새로고침해도 고른 설정이 남게 한다
export function savePace(pace) {
  saveValue("walk", pace.walk);
  saveValue("margin", pace.margin);
  const q = new URLSearchParams(window.location.search);
  if (!q.has("walk") && !q.has("margin")) return;
  q.set("walk", pace.walk);
  q.set("margin", pace.margin);
  window.history.replaceState(null, "", `${window.location.pathname}?${q}${window.location.hash}`);
}

// 설정 id → 엔진 옵션 { walkSpeed, marginSec } 과 화면 표시용 이름
export function paceOptions(pace) {
  const walk = WALK_OPTIONS.find((o) => o.id === pace.walk) ?? WALK_OPTIONS[1];
  const margin = MARGIN_OPTIONS.find((o) => o.id === pace.margin) ?? MARGIN_OPTIONS[0];
  return {
    walkSpeed: walk.speed,
    marginSec: margin.sec,
    isDefault: walk.id === DEFAULT_PACE.walk && margin.id === DEFAULT_PACE.margin,
    label: `${walk.label} 걸음 · 여유 ${margin.sec}초`,
    walk,
    margin,
  };
}
