import { parseHHMM } from "./format";

// 브라우저 저장(localStorage)과 URL 프리셋.
// 저장은 개인 브라우저 안에서만 한다. 사생활 보호 모드 등에서 실패해도 앱은 그대로 돌아가야 하므로 모두 try/catch.

const KEYS = { home: "lastcall.home", origin: "lastcall.origin" };

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

// 시연 프리셋: ?from=역&home=역&t=HH:MM&day=DAY|SAT|END
export function readPreset() {
  const q = new URLSearchParams(window.location.search);
  const day = q.get("day");
  return {
    key: window.location.search, // 프리셋이 바뀌면 메인 화면을 새로 그리는 데 쓴다
    from: q.get("from"),
    home: q.get("home"),
    nowSec: parseHHMM(q.get("t")),
    tag: ["DAY", "SAT", "END"].includes(day) ? day : null,
  };
}
