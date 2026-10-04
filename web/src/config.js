// 팀원이 고치는 곳. 파이썬 없이 판정 기준과 문구를 바꿀 수 있다.
// 판정은 점추정(성공 확률)으로 한다. 구간은 화면에 표시만 한다(plan.md 10/2 결정표 12번).

export const THRESHOLDS = {
  safe: 0.8, // 이 이상이면 "타세요"
  alternative: 0.5, // 이 미만이면 "대안 찾으세요"
};

export const VERDICT_TEXT = {
  safe: { label: "타세요", desc: "대부분의 밤에 갈아탈 수 있었습니다.", color: "emerald" },
  gamble: { label: "도박입니다", desc: "밤에 따라 성패가 갈립니다. 조금이라도 늦으면 놓칠 수 있습니다.", color: "amber" },
  alternative: { label: "대안 찾으세요", desc: "실측 지연으로 보면 갈아타기 어렵습니다. 아래 대안을 확인하세요.", color: "rose" },
  impossible: { label: "시간표상 불가", desc: "열차가 정시에 와도 갈아탈 막차가 먼저 떠납니다.", color: "slate" },
};

// 귀가 앱 첫 화면(집까지 귀가 확률) 판정 문구. 색 기준은 위 THRESHOLDS 와 같다.
export const HOME_TEXT = {
  safe: "여유 있게 갈 수 있어요",
  gamble: "아슬아슬해요",
  danger: "놓칠 수 있어요 · 대안 확인",
};

// 시연 프리셋 3개(메뉴 · 화면 0에서 한 번에 연다). URL 쿼리 ?from=&home=&t=&day= 와 같은 값.
// 모두 평일, 다른 노선으로 갈아타는 막차 환승 하나가 귀가를 가르는 경로다(놓치면 귀가 불가 ⚠).
// 고를 때 엔진 결과(web/public/data 2026-10-04 생성본 기준, 데이터를 다시 만들면 달라질 수 있음):
//   안전 강남→천호 00:15  95.7%  00:23 2호선 → 잠실(시간표 여유 9.9분) → 8호선 막차, 00:52 도착
//   아슬 서울역→강남 00:20 62.9%  00:27 4호선 → 사당(여유 28초) → 2호선 막차, 00:54 도착
//   위험 마포→잠실 00:05   42.7%  00:11 5호선 → 천호(여유 1초) → 8호선 막차, 00:54 도착 (95% 구간 35~49%)
//   (아슬은 00:15로 두면 00:16 출발 93%가 대표 여정이 되므로 00:16 열차가 떠난 뒤인 00:20으로 둔다)
export const DEMO_PRESETS = [
  { id: "safe", label: "안전", tone: "safe", from: "강남", home: "천호", t: "00:15", day: "DAY" },
  { id: "gamble", label: "아슬아슬", tone: "gamble", from: "서울역", home: "강남", t: "00:20", day: "DAY" },
  { id: "danger", label: "거의 불가", tone: "danger", from: "마포", home: "잠실", t: "00:05", day: "DAY" },
];

export const presetQuery = (p) => new URLSearchParams({ from: p.from, home: p.home, t: p.t, day: p.day }).toString();

export const DAY_TYPES = [
  { tag: "DAY", label: "평일" },
  { tag: "SAT", label: "토요일" },
  { tag: "END", label: "일요일·공휴일" },
];

export function verdictOf(row) {
  if (row.p_success == null) return null;
  if (row.p_timetable === 0 && row.p_success < 0.05) return "impossible";
  if (row.p_success >= THRESHOLDS.safe) return "safe";
  if (row.p_success < THRESHOLDS.alternative) return "alternative";
  return "gamble";
}
