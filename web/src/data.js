// 정적 JSON 3종을 한 번 읽어 두고 조회 함수를 제공한다. 서버도 API 호출도 없다.

export async function loadData() {
  const get = (name) => fetch(`${import.meta.env.BASE_URL}data/${name}.json`).then((r) => r.json());
  const [prob, cdf, alt] = await Promise.all([get("prob_table"), get("delay_cdf"), get("station_alt")]);
  return { prob, cdf, alt };
}

// 물리 역 이름: 4호선 총신대입구와 7호선 이수는 같은 역
export const stationId = (name) => (name === "이수" ? "총신대입구" : name);

export function stationsOf(rows) {
  return [...new Set(rows.map((r) => stationId(r.station)))].sort((a, b) => a.localeCompare(b, "ko"));
}

export function fromLinesOf(rows, station) {
  return [...new Set(rows.filter((r) => stationId(r.station) === station).map((r) => r.from_line))].sort();
}

export function toLinesOf(rows, station, fromLine) {
  return [
    ...new Set(
      rows.filter((r) => stationId(r.station) === station && r.from_line === fromLine).map((r) => r.to_line),
    ),
  ].sort();
}

export function candidates(rows, station, fromLine, toLine, ttTag) {
  return rows.filter(
    (r) =>
      stationId(r.station) === station && r.from_line === fromLine && r.to_line === toLine && r.tt_tag === ttTag,
  );
}

export const pct = (p) => (p == null ? "-" : `${Math.round(p * 100)}%`);
