import { Fragment } from "react";
import { HOME_TEXT } from "../config";
import { useJson } from "../data";
import { hhmm, pctText, shownMinutes, TONE, toneOf, untilText, withYeok } from "../format";
import { lineColorOf, NIGHT_START, nodeOf } from "../usePlan";
import Icon from "./Icon";
import LinePill from "./LinePill";

// 시트 요약(화면 1): 결론 한 줄 — 큰 숫자 2개(귀가 확률, 출발 마감) + 판정 색 + 경로 한 줄.
// Citymapper "Get Me Home" 처럼 첫 화면에서 답을 끝낸다. 통계 설명은 넣지 않는다.
// 모양은 레퍼런스 카드 문법: 흰 카드, 연한 칩 안 노선 번호, 연파랑 라벨 + 진한 값.
export default function SummaryCard({
  data, plan, journey, isBest, originId, homeId, clock, dayStatus, onRetryDay, serviceEnd,
  onPickOrigin, onLocate, onShowRoute, onOpenTime,
}) {
  const p = journey?.p_home ?? null;
  const tone = plan?.status === "ok" ? toneOf(p) : plan?.status === "no_route" ? "danger" : "none";
  // 안전한 출발(귀가 확률 ≥80%) 마감이 지났으면 카드 위쪽을 빨강 기운으로 (와이어프레임 화면 1)
  const pastSafe = plan?.status === "ok" && !plan.leave_by?.safe;
  const glow = TONE[pastSafe ? "danger" : tone].hex;

  return (
    <div className="px-3 pb-1">
      <div
        className="card-shadow rounded-3xl bg-surface p-4"
        style={{ background: tone === "none" ? undefined : `linear-gradient(180deg, ${glow}1c 0%, #ffffff 58%)` }}
      >
        <Body
          data={data} plan={plan} journey={journey} isBest={isBest} tone={tone} p={p}
          originId={originId} homeId={homeId} clock={clock} dayStatus={dayStatus} onRetryDay={onRetryDay} serviceEnd={serviceEnd}
          onPickOrigin={onPickOrigin} onLocate={onLocate} onShowRoute={onShowRoute}
        />
        {/* 21시 전: 오늘 밤 막차 기준으로 21:00 출발을 계산했다는 안내(엔진이 21:00 으로 올려 탐색) */}
        {plan?.status === "ok" && clock.nowSec < NIGHT_START && (
          <button type="button" onClick={onOpenTime} className="mt-3 flex min-h-11 w-full items-center gap-2 rounded-xl bg-canvas px-3 py-2 text-left text-[13px] text-muted">
            <Icon name="clock" className="h-4 w-4 shrink-0" />
            <span className="flex-1">오늘 밤 막차 기준이에요. 아직 21시 전이라 21:00 출발로 계산했어요.</span>
            <span className="shrink-0 font-semibold text-brand-ink">시각 바꾸기</span>
          </button>
        )}
      </div>
    </div>
  );
}

function Body({ data, plan, journey, isBest, tone, p, originId, homeId, clock, dayStatus, onRetryDay, serviceEnd, onPickOrigin, onLocate, onShowRoute }) {
  // 확증 전 잠정 결과면 큰 숫자 옆에도 밝힌다(delay_cdf.json meta.provisional)
  const provisional = useJson("delay_cdf")?.meta?.provisional;
  if (!originId) {
    return (
      <div>
        <p className="text-[22px] font-bold">어디서 출발하나요?</p>
        <p className="mt-1 text-[14px] text-muted">현위치에서 가장 가까운 역을 찾거나 직접 고르세요.</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={onLocate} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-brand-strong font-semibold text-white">
            <Icon name="locate" className="h-5 w-5" /> 현위치로 찾기
          </button>
          <button type="button" onClick={onPickOrigin} className="min-h-12 rounded-2xl bg-chip font-semibold text-brand-ink">
            역 고르기
          </button>
        </div>
      </div>
    );
  }
  if (dayStatus === "loading") return <p className="py-8 text-center text-muted" role="status">오늘 밤 열차 시간표 불러오는 중…</p>;
  if (dayStatus === "error") {
    return (
      <div role="alert">
        <p className="text-[20px] font-bold">시간표를 불러오지 못했어요</p>
        <p className="mt-1 text-[14px] text-muted">인터넷 연결을 확인하고 다시 시도해 주세요.</p>
        <button type="button" onClick={onRetryDay} className="mt-4 min-h-11 rounded-xl bg-brand-strong px-4 text-sm font-bold text-white">
          다시 시도
        </button>
      </div>
    );
  }
  if (!plan) return <p className="py-8 text-center text-muted">계산 중…</p>;

  if (plan.status !== "ok") {
    // 그 요일 마지막 열차까지 떠났으면 출발역과 상관없이 "운행 종료"
    const ended = plan.status === "no_route" && serviceEnd != null && clock.nowSec > serviceEnd;
    const msg = {
      no_route: ended
        ? ["오늘 지하철 운행은 끝났어요", `마지막 열차가 ${hhmm(serviceEnd)}에 떠났어요. 아래에서 N버스·따릉이 위치를 확인하세요.`]
        : ["오늘 밤 지하철로는 집에 갈 수 없어요", `${originId}에서 ${hhmm(Math.max(clock.nowSec, NIGHT_START))} 이후 출발해 ${homeId}까지 가는 열차가 시간표에 없어요.`],
      same_station: ["이미 집 역이에요", "출발역을 바꿔 보세요."],
      unsupported: ["지원하지 않는 역이에요", "1~9호선 역만 계산할 수 있어요."],
    }[plan.status] ?? ["경로를 계산하지 못했어요", "잠시 뒤 다시 시도해 주세요."];
    return (
      <div>
        <p className={`text-[24px] leading-tight font-bold text-balance ${plan.status === "no_route" ? "text-danger-ink" : ""}`}>{msg[0]}</p>
        <p className="mt-1.5 text-[14px] text-muted">{msg[1]}</p>
        <button type="button" onClick={plan.status === "no_route" ? onShowRoute : onPickOrigin} className="mt-4 min-h-11 rounded-xl bg-chip px-4 text-sm font-semibold text-brand-ink">
          {plan.status === "no_route" ? "대안 보기" : "출발역 바꾸기"}
        </button>
      </div>
    );
  }

  const { safe, last } = plan.leave_by ?? {};
  const deadline = safe ?? last;
  const deadlineIsLast = !safe && !!last;
  const isNight = clock.nowSec >= NIGHT_START;
  const leftLabel = !isBest
    ? `${hhmm(journey.depart_sec)} 출발하면`
    : !isNight ? "21:00 출발하면" : tone === "safe" ? "지금 출발하면" : "지금 출발해도";
  const relaxed = last && last.depart_sec - Math.max(clock.nowSec, NIGHT_START) > 3600; // 막차까지 1시간 넘게 남음(21시 전 포함)
  const verdict = relaxed && tone === "safe"
    ? `아직 여유 · 막차 기준 출발 마감 ${hhmm(last.depart_sec)}`
    : !safe && tone !== "danger" ? "안전한 출발 마감은 지났어요" : HOME_TEXT[tone];

  return (
    <>
      {/* 레퍼런스 카드 윗줄: 도보 > [노선 칩] ······ 도착 시각 */}
      <div className="flex items-center justify-between gap-2">
        <RouteChips data={data} journey={journey} />
        <span className="shrink-0 text-[13px] text-muted">
          도착 <b className="text-[15px] font-bold text-text tabular-nums">{hhmm(journey.arrive_sec)}</b>
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3">
        <div className="min-w-0">
          <div className="text-[13px] text-muted">{leftLabel}</div>
          <BigPct p={p} className={TONE[tone].big} />
          <div className="mt-1.5 text-[13px] font-medium text-muted">귀가 확률{provisional ? " · 잠정" : ""}</div>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[13px] text-muted">
            출발 마감
            {deadline && isNight && deadline.depart_sec >= clock.nowSec && (
              <span className="rounded-full bg-chip px-1.5 py-px text-[12px] font-semibold text-brand-ink tabular-nums">
                {untilText(shownMinutes(clock.nowSec, deadline.depart_sec) * 60)} 남음
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[44px] leading-none font-extrabold tracking-[-0.03em] tabular-nums">
            {deadline ? hhmm(deadline.depart_sec) : "—"}
          </div>
          {/* 긴 역명(동대문역사문화공원)이면 줄을 넘겨서라도 "· 막차"가 보이게 한다(잘리면 막차라는 경고가 사라짐) */}
          <div className={`mt-1.5 text-[13px] font-medium break-keep ${deadlineIsLast ? "text-danger-ink" : "text-muted"}`}>
            까지 {withYeok(originId)} 탑승{deadlineIsLast ? " · 막차" : ""}
          </div>
        </div>
      </div>

      <div className="mt-3.5">
        <div className="h-2 overflow-hidden rounded-full bg-chip" role="img" aria-label={`귀가 확률 ${pctText(p)}`}>
          <div className={`h-full rounded-full ${TONE[tone].bg}`} style={{ width: `${Math.max(2, Math.round((p ?? 0) * 100))}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className={`min-w-0 text-[14px] font-semibold ${TONE[tone].text}`}>{verdict}</div>
          <button type="button" onClick={onShowRoute} className="flex min-h-11 shrink-0 items-center gap-0.5 rounded-xl bg-chip pr-2 pl-3 text-[14px] font-semibold text-brand-ink hover:bg-soft/50">
            경로 자세히 <Icon name="chevronRight" className="h-4 w-4" />
          </button>
        </div>
      </div>
    </>
  );
}

// 큰 확률 숫자. ">99%" 의 기호·% 는 작게
function BigPct({ p, className }) {
  const text = pctText(p);
  const sign = /^[<>]/.test(text) ? text[0] : "";
  const num = text.replace(/[<>%]/g, "");
  return (
    <div className={`mt-0.5 flex items-baseline text-[44px] leading-none font-extrabold tracking-[-0.03em] tabular-nums ${className}`}>
      {sign && <span className="mr-0.5 text-[26px] font-bold">{sign}</span>}
      {num}
      <span className="ml-0.5 text-[26px] font-bold">%</span>
    </div>
  );
}

// 경로 한 줄(레퍼런스의 "도보 > [버스 123]" 자리): 🚶 > [ [2] 잠실 ⚠ [8] ]
// 노선 번호는 공식 색 그대로, 연한 칩 안에 담는다. 결정적 환승(⚠)만 판정 색으로 칠한다
export function RouteChips({ data, journey }) {
  const rides = journey.legs.filter((l) => l.type === "ride");
  return (
    <span className="flex min-w-0 items-center gap-1">
      <Icon name="walk" className="h-5 w-5 shrink-0 text-soft" />
      <Icon name="chevronRight" className="h-3.5 w-3.5 shrink-0 text-soft" />
      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg bg-chip px-2 py-1">
        {rides.map((leg, i) => {
          const t = i < rides.length - 1 ? journey.transfers?.[i] : null;
          return (
            <Fragment key={i}>
              <LinePill line={leg.line} color={lineColorOf(data, leg.line)} />
              {t && (
                <span className={`flex items-center gap-0.5 text-[13px] font-semibold ${t.critical ? TONE[toneOf(t.p)].text : "text-brand-ink"}`}>
                  {t.critical && <Icon name="warning" className="h-3.5 w-3.5" strokeWidth={2.4} />}
                  {t.at_station ?? nodeOf(data, leg.to_node)?.station}
                </span>
              )}
            </Fragment>
          );
        })}
      </span>
    </span>
  );
}
