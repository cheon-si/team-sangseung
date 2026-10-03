import { useEffect, useMemo, useState } from "react";
import AltList from "../components/AltList";
import CdfChart from "../components/CdfChart";
import ResultCard from "../components/ResultCard";
import { DAY_TYPES } from "../config";
import { candidates, fromLinesOf, stationsOf, toLinesOf } from "../data";

// 탭 1. 환승역 → 타고 온 노선 → 갈아탈 노선 → 요일 유형 → 방면을 고르면 성공 확률을 보여준다.
export default function ProbabilityTab({ data, initialStation }) {
  const rows = data.prob.rows;
  const stations = useMemo(() => stationsOf(rows), [rows]);
  const [station, setStation] = useState(initialStation || "종로3가");
  const fromLines = useMemo(() => fromLinesOf(rows, station), [rows, station]);
  const [fromLine, setFromLine] = useState(fromLines[0]);
  const toLines = useMemo(() => toLinesOf(rows, station, fromLine), [rows, station, fromLine]);
  const [toLine, setToLine] = useState(toLines[0]);
  const [ttTag, setTtTag] = useState("DAY");
  const cands = useMemo(() => candidates(rows, station, fromLine, toLine, ttTag), [rows, station, fromLine, toLine, ttTag]);
  const [pick, setPick] = useState(0);

  // 상위 선택이 바뀌면 하위 선택을 첫 항목으로 되돌린다
  useEffect(() => { if (initialStation) setStation(initialStation); }, [initialStation]);
  useEffect(() => { if (!fromLines.includes(fromLine)) setFromLine(fromLines[0]); }, [fromLines, fromLine]);
  useEffect(() => { if (!toLines.includes(toLine)) setToLine(toLines[0]); }, [toLines, toLine]);
  useEffect(() => setPick(0), [station, fromLine, toLine, ttTag]);

  const row = cands[pick] || cands[0];
  const altStation = data.alt.stations.find((s) => s.station === station);
  const dist = row ? data.cdf.dists[row.dist_key] : null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Select label="환승역" value={station} onChange={setStation} options={stations.map((s) => [s, s])} />
        <Select label="타고 온 노선" value={fromLine} onChange={setFromLine} options={fromLines.map((l) => [l, `${l}호선`])} />
        <Select label="갈아탈 노선" value={toLine} onChange={setToLine} options={toLines.map((l) => [l, `${l}호선`])} />
        <Select label="요일" value={ttTag} onChange={setTtTag} options={DAY_TYPES.map((d) => [d.tag, d.label])} />
        <Select
          label="방면"
          value={String(pick)}
          onChange={(v) => setPick(Number(v))}
          options={cands.map((r, i) => [String(i), `${r.a_dest}행 → ${r.d_dest}행`])}
        />
      </div>

      {row ? (
        <>
          <ResultCard row={row} />
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="font-semibold">{row.from_line}호선 도착 지연 분포</h3>
            <p className="text-sm text-slate-500 mb-2">
              빨간 선이 시간표상 여유입니다. 선 왼쪽 초록 영역의 높이가 "열차가 이만큼 이하로 늦을 확률"이고,
              그게 곧 성공 확률입니다.
              {ttTag !== "DAY" && " 지연 분포는 토요일과 일요일·공휴일을 묶은 주말 전체 기준입니다."}
            </p>
            <CdfChart dist={dist} gridSec={data.cdf.meta.grid_sec} bufferSec={row.buffer_sec} />
          </div>
          <AltList station={altStation} />
        </>
      ) : (
        <p className="text-slate-500">이 조합의 막차 정보가 없습니다.</p>
      )}
    </div>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="text-sm">
      <span className="block text-slate-500 mb-1">{label}</span>
      <select
        className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map(([v, t]) => (
          <option key={v} value={v}>{t}</option>
        ))}
      </select>
    </label>
  );
}
