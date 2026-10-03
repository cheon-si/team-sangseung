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
