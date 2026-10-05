import { useMemo, useState } from "react";
import { untilText } from "../format";
import { lineColorOf, stationListOf } from "../usePlan";
import Icon from "./Icon";
import LinePill from "./LinePill";

// 역 검색 목록. 화면 0(집 등록)과 출발역·집 바꾸기 모달에서 같이 쓴다.
// nearby: 현위치에서 가까운 역 [{id, walk_sec}] — 있으면 검색어가 비었을 때 맨 위에 보여 준다.
export default function StationPicker({ data, onPick, nearby, currentId, placeholder = "역 이름 검색", autoFocus = false }) {
  const [query, setQuery] = useState("");
  const stations = stationListOf(data);
  const byId = useMemo(() => new Map(stations.map((s) => [s.id, s])), [stations]);

  // 공백·끝의 "역"은 무시하고, 이름이 검색어로 시작하는 역을 앞에 둔다
  const results = useMemo(() => {
    const norm = (s) => s.replace(/\s/g, "").replace(/역$/, "");
    const key = norm(query);
    const sorted = [...stations].sort((a, b) => a.name.localeCompare(b.name, "ko"));
    if (!key) return sorted;
    return sorted
      .filter((s) => norm(s.name).includes(key))
      .sort((a, b) => Number(norm(b.name).startsWith(key)) - Number(norm(a.name).startsWith(key)));
  }, [query, stations]);

  const row = (s, extra) => (
    <li key={s.id + (extra ? "-near" : "")}>
      <button
        type="button"
        onClick={() => onPick(s.id)}
        className={`flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-canvas focus-visible:bg-canvas focus-visible:outline-none ${
          s.id === currentId ? "bg-chip/60" : ""
        }`}
      >
        <span className="min-w-0 flex-1 truncate text-[16px] font-semibold">{s.name}</span>
        {extra && <span className="shrink-0 text-[13px] text-muted tabular-nums">{extra}</span>}
        <span className="flex shrink-0 gap-1">
          {s.lines.map((l) => (
            <LinePill key={l} line={l} color={lineColorOf(data, l)} size="sm" />
          ))}
        </span>
      </button>
    </li>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <label className="relative block shrink-0">
        <span className="sr-only">{placeholder}</span>
        <Icon name="search" className="pointer-events-none absolute top-1/2 left-3.5 h-5 w-5 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          enterKeyHint="search"
          className="h-13 w-full rounded-2xl border border-line bg-canvas pr-4 pl-11 text-[17px] text-text placeholder:text-muted focus:border-brand focus:outline-none"
          onKeyDown={(e) => e.key === "Enter" && results[0] && onPick(results[0].id)}
        />
      </label>
      <div className="soft-scroll mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
        {!query && nearby?.length > 0 && (
          <>
            <p className="px-3 pt-2 pb-1 text-[13px] font-semibold text-muted">현위치에서 가까운 역</p>
            <ul>{nearby.map((n) => byId.get(n.id) && row(byId.get(n.id), `걸어서 ${untilText(n.walk_sec)}`))}</ul>
            <p className="px-3 pt-3 pb-1 text-[13px] font-semibold text-muted">전체 역</p>
          </>
        )}
        <ul>{results.map((s) => row(s))}</ul>
        {results.length === 0 && (
          <p className="px-3 py-6 text-center text-[15px] text-muted">
            ‘{query}’ 역을 찾지 못했어요.
            <br />
            1~9호선 역만 찾을 수 있어요.
          </p>
        )}
      </div>
    </div>
  );
}
