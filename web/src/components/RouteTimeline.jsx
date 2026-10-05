import { Fragment, useState } from "react";
import { hhmm, minText, pctText, signedMinText, TONE, toneOf, untilText, withYeok } from "../format";
import { lineColorOf, nodeOf } from "../usePlan";
import Icon from "./Icon";
import LinePill from "./LinePill";
import ModelBNote from "./ModelBNote";

// 경로 결과(화면 2) 타임라인 카드(레퍼런스 오른쪽 화면): 채운 파랑 점 출발역 → 노선 칩 승차 → "N개 역 ▾" → 연한 점 하차
// → 환승 카드(⚠ = 놓치면 귀가 불가, 누르면 화면 3) → … → 빈 원 집 도착. 왼쪽 막대는 노선 공식 색.
// 시간표 시각은 오른쪽 연파랑 숫자, 확률(B 모형)은 판정 색 굵은 글씨로 구분한다.
export default function RouteTimeline({ data, journey, homeId, originWalkSec, onTransferClick }) {
  const rides = journey.legs.filter((l) => l.type === "ride");

  return (
    <section className="px-3 pt-6" aria-labelledby="route-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 px-1">
        <h3 id="route-title" className="text-[16px] font-bold">경로</h3>
        <span className="text-[13px] text-muted tabular-nums">
          {hhmm(journey.depart_sec)} 출발 → {hhmm(journey.arrive_sec)} 도착
        </span>
      </div>
      <ol className="card-shadow mt-2.5 rounded-2xl bg-surface px-3.5 py-3.5">
        {originWalkSec != null && (
          <Row icon={<Icon name="walk" className="relative z-10 h-4 w-4 bg-surface text-soft" />} rail={<DashRail />}>
            <div className="pb-3 text-[14px] text-muted">
              {withYeok(nodeOf(data, rides[0].from_node)?.station)}까지 걸어서 약 {untilText(originWalkSec)}{" "}
              <span className="text-[12px]">(직선거리 추정)</span>
            </div>
          </Row>
        )}
        {rides.map((leg, i) => (
          <Fragment key={i}>
            <RideRows data={data} leg={leg} first={i === 0} last={i === rides.length - 1} homeId={homeId} />
            {i < rides.length - 1 && (
              <TransferRow
                data={data}
                transfer={findTransfer(journey, leg, rides[i + 1], i)}
                walkSec={journey.legs.find((l) => l.type === "transfer" && l.from_node === leg.to_node)?.walk_sec}
                onClick={() => onTransferClick(findTransferIndex(journey, leg, rides[i + 1], i))}
              />
            )}
          </Fragment>
        ))}
      </ol>
    </section>
  );
}

// 세 칸 격자: 점·아이콘(+ 세로 막대) | 내용 | 시각(오른쪽). 시각이 없으면 내용이 오른쪽 끝까지 쓴다
function Row({ icon, rail, time, children }) {
  return (
    <li className="grid grid-cols-[24px_minmax(0,1fr)_auto] gap-x-2.5">
      <div className="relative flex justify-center pt-1">
        {rail}
        {icon}
      </div>
      <div className={`min-w-0 ${time == null ? "col-span-2" : ""}`}>{children}</div>
      {time != null && <div className="pt-0.5 text-right text-[14px] font-semibold text-muted tabular-nums">{time}</div>}
    </li>
  );
}

const DashRail = () => <span className="absolute top-0 bottom-0 left-1/2 w-0 -translate-x-1/2 border-l-2 border-dashed border-soft" />;

// first: 첫 승차(채운 파랑 점), last: 마지막 하차를 "집 도착"(빈 원)으로
function RideRows({ data, leg, first, last, homeId }) {
  const [open, setOpen] = useState(false);
  const color = lineColorOf(data, leg.line);
  const from = nodeOf(data, leg.from_node);
  const to = nodeOf(data, leg.to_node);
  const middle = leg.stops.slice(1, -1).map((i) => nodeOf(data, i)?.nm);
  const bar = (cls) => <span className={`absolute left-1/2 w-[3px] -translate-x-1/2 rounded-full ${cls}`} style={{ background: color }} />;
  // 환승 승차·하차 점: 연한 점 + 노선 색 테두리
  const lightDot = <span className="relative z-10 mt-0.5 h-3.5 w-3.5 rounded-full border-[3px] bg-dot" style={{ borderColor: color }} />;
  const startDot = <span className="relative z-10 mt-0.5 h-4 w-4 rounded-full bg-brand ring-4 ring-brand/20" />;

  return (
    <>
      <Row icon={first ? startDot : lightDot} rail={bar("top-4 bottom-0")} time={hhmm(leg.dep)}>
        <div className="text-[16px] leading-6 font-bold">
          {from?.station ?? from?.nm} <span className="text-[13px] font-medium text-muted">승차</span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted">
          <span className="flex shrink-0 items-center gap-1 rounded-md bg-chip py-0.5 pr-1.5 pl-1">
            <LinePill line={leg.line} color={color} size="sm" />
            <span className="font-semibold text-brand-ink">{leg.line}호선</span>
          </span>
          <span className="truncate">{leg.dest}행</span>
        </div>
      </Row>
      <Row rail={bar("inset-y-0")}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="my-0.5 flex min-h-11 items-center gap-1 border-b border-line pr-6 text-[13px] text-muted hover:text-text"
        >
          {leg.stops.length - 1}개 역 · {Math.round((leg.arr - leg.dep) / 60)}분
          <Icon name="chevronDown" className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open && middle.length > 0 && (
          <ul className="pt-1 pb-2 text-[13px] leading-6 text-muted">
            {middle.map((nm, k) => <li key={k}>{nm}</li>)}
          </ul>
        )}
      </Row>
      {last ? (
        <Row
          icon={<span className="relative z-10 mt-0.5 h-4 w-4 rounded-full border-[3px] border-brand bg-surface" />}
          rail={bar("top-0 h-2")}
          time={<span className="text-text">{hhmm(leg.arr)}</span>}
        >
          <div className="flex items-center gap-1.5 text-[16px] leading-6 font-bold">
            {to?.station ?? homeId} 도착
            <span className="flex items-center gap-0.5 rounded-md bg-chip px-1.5 py-px text-[12px] font-semibold text-brand-ink">
              <Icon name="home" className="h-3.5 w-3.5" strokeWidth={2.4} /> 집
            </span>
          </div>
        </Row>
      ) : (
        <Row icon={lightDot} rail={bar("top-0 h-2")} time={hhmm(leg.arr)}>
          <div className="pb-1 text-[16px] leading-6 font-bold">
            {to?.station ?? to?.nm} <span className="text-[13px] font-medium text-muted">하차</span>
          </div>
        </Row>
      )}
    </>
  );
}

function TransferRow({ data, transfer: t, walkSec, onClick }) {
  const walkIcon = <Icon name="walk" className="relative z-10 h-4 w-4 bg-surface text-soft" />;
  if (!t) {
    // 확률 정보가 없는 환승(엔진이 transfers 에 넣지 않은 경우): 도보만
    return (
      <Row icon={walkIcon} rail={<DashRail />}>
        <p className="py-2 text-[14px] text-muted">환승{walkSec != null ? ` · 걸어서 ${minText(walkSec)}` : ""}</p>
      </Row>
    );
  }
  const tone = toneOf(t.p);
  return (
    <Row icon={walkIcon} rail={<DashRail />}>
      <p className="text-[13px] leading-6 text-muted">환승 · 걸어서 {minText(t.walk_sec)}</p>
      <button
        type="button"
        onClick={onClick}
        className={`mt-1 mb-3 w-full rounded-2xl border p-3 text-left ${TONE[tone].border} ${TONE[tone].soft} hover:brightness-[0.98]`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 text-[15px] font-bold">
            <LinePill line={t.from_line} color={lineColorOf(data, t.from_line)} size="sm" />
            <Icon name="chevronRight" className="h-3.5 w-3.5 shrink-0 text-muted" />
            <LinePill line={t.to_line} color={lineColorOf(data, t.to_line)} size="sm" />
            <span className="truncate">{t.at_station} 환승</span>
          </span>
          <Icon name="chevronRight" className="h-4 w-4 shrink-0 text-muted" />
        </div>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={`text-[24px] leading-none font-extrabold tabular-nums ${TONE[tone].text}`}>{pctText(t.p)}</span>
          <span className="text-[13px] text-muted">환승 성공 확률</span>
        </div>
        <div className="mt-1.5 text-[13px] text-muted tabular-nums">시간표 여유 {signedMinText(t.slack_sec)}</div>
        <ModelBNote s90={t.s90} slack={t.slack_sec} toLine={t.to_line} compact />
        {t.critical ? (
          <div className="mt-2 flex items-center gap-1.5 text-[13px] font-semibold text-danger-ink">
            <Icon name="warning" className="h-4 w-4 shrink-0" strokeWidth={2.4} /> 놓치면 이 역에서 지하철로는 집에 못 가요
          </div>
        ) : (
          <div className="mt-2 text-[13px] text-muted">놓쳐도 다른 열차로 귀가 {pctText(t.q)}</div>
        )}
      </button>
    </Row>
  );
}

// ride i 와 ride i+1 사이 환승: 노드로 맞추고, 못 맞추면 순서로
function findTransferIndex(journey, a, b, i) {
  const k = (journey.transfers ?? []).findIndex((t) => t.from_node === a.to_node && t.to_node === b.from_node);
  return k >= 0 ? k : i;
}

function findTransfer(journey, a, b, i) {
  return journey.transfers?.[findTransferIndex(journey, a, b, i)] ?? null;
}
