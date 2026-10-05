import { Fragment, useState } from "react";
import { hhmm, minText, pctText, signedMinText, TONE, toneOf, untilText, withYeok } from "../format";
import { lineColorOf, nodeOf } from "../usePlan";
import Icon from "./Icon";
import LinePill from "./LinePill";

// 경로 결과(화면 2) 타임라인: 노선 색 막대 + 환승 카드(⚠ = 놓치면 귀가 불가). 환승 카드를 누르면 화면 3.
// 시간표 시각은 회색 숫자, 실측 확률은 판정 색 굵은 글씨로 구분한다.
export default function RouteTimeline({ data, journey, homeId, originWalkSec, onTransferClick }) {
  const rides = journey.legs.filter((l) => l.type === "ride");
  const homeTone = toneOf(journey.p_home);

  return (
    <section className="px-4 pt-6" aria-labelledby="route-title">
      <div className="flex items-baseline justify-between">
        <h3 id="route-title" className="text-[15px] font-bold">경로</h3>
        <span className="text-[13px] text-ink-400 tabular-nums">
          {hhmm(journey.depart_sec)} 출발 → {hhmm(journey.arrive_sec)} 도착
        </span>
      </div>
      <ol className="mt-3">
        {originWalkSec != null && (
          <Row rail={<span className="h-full w-0 border-l-2 border-dotted border-ink-500" />}>
            <div className="flex items-center gap-1.5 pb-4 text-[14px] text-ink-300">
              <Icon name="walk" className="h-4 w-4 text-ink-400" />
              {withYeok(nodeOf(data, rides[0].from_node)?.station)}까지 걸어서 약 {untilText(originWalkSec)}
              <span className="text-[12px] text-ink-500">(직선거리 추정)</span>
            </div>
          </Row>
        )}
        {rides.map((leg, i) => (
          <Fragment key={i}>
            <RideRows data={data} leg={leg} arriveTone={i === rides.length - 1 ? homeTone : null} homeId={homeId} />
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

// 세 칸 격자: 시각 | 레일(노선 색 막대) | 내용
function Row({ time, rail, children }) {
  return (
    <li className="grid grid-cols-[42px_28px_1fr] gap-x-2">
      <div className="pt-0.5 text-right text-[13px] text-ink-400 tabular-nums">{time}</div>
      <div className="relative flex justify-center">{rail}</div>
      <div className="min-w-0">{children}</div>
    </li>
  );
}

// arriveTone 이 있으면 마지막 구간: 하차 행을 "집 도착" 행으로 그린다
function RideRows({ data, leg, arriveTone, homeId }) {
  const [open, setOpen] = useState(false);
  const color = lineColorOf(data, leg.line);
  const from = nodeOf(data, leg.from_node);
  const to = nodeOf(data, leg.to_node);
  const middle = leg.stops.slice(1, -1).map((i) => nodeOf(data, i)?.nm);
  const bar = (cls) => <span className={`absolute w-1.5 ${cls}`} style={{ background: color }} />;
  const dot = <span className="relative z-10 mt-1 h-4 w-4 rounded-full border-[3.5px] bg-night-900" style={{ borderColor: color }} />;

  return (
    <>
      <Row time={hhmm(leg.dep)} rail={<>{bar("top-3 bottom-0")}{dot}</>}>
        <div className="text-[16px] font-bold">{from?.station ?? from?.nm} <span className="text-[13px] font-medium text-ink-400">승차</span></div>
        <div className="mt-1 flex items-center gap-1.5 text-[14px] text-ink-300">
          <LinePill line={leg.line} color={color} />
          <span className="truncate">{leg.dest}행</span>
        </div>
      </Row>
      <Row rail={bar("inset-y-0")}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="my-1 flex min-h-11 items-center gap-1 text-[13px] text-ink-400 hover:text-ink-100"
        >
          {leg.stops.length - 1}개 역 · {Math.round((leg.arr - leg.dep) / 60)}분
          <Icon name="chevronDown" className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open && middle.length > 0 && (
          <ul className="pb-2 text-[13px] leading-6 text-ink-400">
            {middle.map((nm, k) => <li key={k}>{nm}</li>)}
          </ul>
        )}
      </Row>
      {arriveTone ? (
        <Row
          time={hhmm(leg.arr)}
          rail={
            <>
              {bar("top-0 h-3")}
              <span className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full ${TONE[arriveTone].bg} text-night-950`}>
                <Icon name="home" className="h-4 w-4" strokeWidth={2.4} />
              </span>
            </>
          }
        >
          <div className="pt-0.5 text-[16px] font-bold">
            {to?.station ?? homeId} 도착 <span className="text-[13px] font-medium text-ink-400">집</span>
          </div>
        </Row>
      ) : (
        <Row time={hhmm(leg.arr)} rail={<>{bar("top-0 h-3")}{dot}</>}>
          <div className="pb-1 text-[16px] font-bold">{to?.station ?? to?.nm} <span className="text-[13px] font-medium text-ink-400">하차</span></div>
        </Row>
      )}
    </>
  );
}

function TransferRow({ data, transfer: t, walkSec, onClick }) {
  if (!t) {
    // 확률 정보가 없는 환승(엔진이 transfers 에 넣지 않은 경우): 도보만
    return (
      <Row rail={<span className="h-full w-0 border-l-2 border-dashed border-ink-500" />}>
        <p className="py-3 text-[14px] text-ink-300">환승{walkSec != null ? ` · 걸어서 ${minText(walkSec)}` : ""}</p>
      </Row>
    );
  }
  const tone = toneOf(t.p);
  return (
    <Row rail={<span className="h-full w-0 border-l-2 border-dashed border-ink-500" />}>
      <button
        type="button"
        onClick={onClick}
        className={`my-2 w-full rounded-2xl border p-3 text-left ${TONE[tone].border} ${TONE[tone].soft} hover:brightness-110`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 text-[15px] font-bold">
            <LinePill line={t.from_line} color={lineColorOf(data, t.from_line)} size="sm" />
            <span className="text-ink-400">→</span>
            <LinePill line={t.to_line} color={lineColorOf(data, t.to_line)} size="sm" />
            <span className="truncate">{t.at_station} 환승</span>
          </span>
          <Icon name="chevronRight" className="h-4 w-4 shrink-0 text-ink-400" />
        </div>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={`text-[22px] leading-none font-extrabold tabular-nums ${TONE[tone].text}`}>{pctText(t.p)}</span>
          <span className="text-[13px] text-ink-300">환승 성공 확률 · 실측 지연 기반</span>
        </div>
        <div className="mt-1.5 text-[13px] text-ink-400 tabular-nums">
          걸어서 {minText(t.walk_sec)} · 시간표 여유 {signedMinText(t.buffer_sec)}
        </div>
        {t.critical ? (
          <div className="mt-2 flex items-center gap-1.5 text-[13px] font-semibold text-danger">
            <Icon name="warning" className="h-4 w-4" strokeWidth={2.4} /> 놓치면 이 역에서 지하철로는 집에 못 가요
          </div>
        ) : (
          <div className="mt-2 text-[13px] text-ink-400">놓쳐도 다른 열차로 귀가 {pctText(t.q)}</div>
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
