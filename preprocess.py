"""작업 1. 실시간 수집분 전처리 → 관측 사건 테이블.

collected/YYYYMMDD/{position,arrival}_YYYYMMDD.jsonl.gz 를 읽어
  1) 원 스탬프(시간표 매칭 전)       data/processed/events/stamps_YYYYMMDD.csv
  2) 시간표와 붙인 사건(첫 스탬프)   data/processed/events/events_YYYYMMDD.csv
  3) 매칭 실패 스탬프와 사유         data/processed/events/unmatched_YYYYMMDD.csv
  4) 밤 메타, (밤,노선) 시간표 적합  data/processed/night_meta.csv, tt_fit.csv
  5) 전체 밤 합본                    data/processed/delay_events.csv
를 만든다. 규칙은 common.py, 근거는 plan.md 작업 1.

사용:
    python preprocess.py                    # 새로 들어온 밤만 처리
    python preprocess.py --nights all --force
    python preprocess.py --nights 20260929,20260930
"""

import argparse
import gzip
import json

import numpy as np
import pandas as pd

import common as c

EVENTS_DIR = c.PROCESSED_DIR / "events"
PAGING_COLS = ["beginRow", "endRow", "curPage", "pageRow", "totalCount", "rowNum", "selectedCount"]
STATUS_POS = {"1": "arr", "2": "dep", "3": "prev_dep"}    # trainSttus
STATUS_ARR = {"1": "arr", "2": "dep", "3": "prev_dep"}    # arvlCd (0진입 4·5전역 99운행중은 버림)
DEADHEAD_3 = (3802, 3983)        # 3호선 도착 API 회송 추정 번호대(시간표·위치 API에 없음)
# 도착 API의 '도착'(arvlCd=1)이 같은 열차·역의 위치 API 도착보다 매일 12~18분 이르게 찍히는 노선.
# 15밤 모두 같았다(중앙값 −17분). 같은 노선의 '출발'은 위치 API와 차이 0분이라 그대로 쓴다.
ARR_API_BAD_ARRIVAL_LINES = {"8"}
FUTURE_TOL = 5                   # 수집 시각보다 이만큼(초) 넘게 미래인 recptnDt는 버린다
EARLY_E = 70                     # 관측 창 시작 여유(초). 작업 2에서 확증 세트 전 정상 평일 도착 지연 p1 절댓값으로 확정
TT_FIT_MIN_RATE = 0.6            # 23시 이후 시간표 열차 관측률이 이보다 낮으면 그 (밤,노선)은 tt_unknown
TT_FIT_MAX_MED = 600             # 또는 지연 중앙값 절댓값이 이보다 크면 tt_unknown
GAP_MAX_POS_ROWS = 2             # 위치 행이 이 이하이고
GAP_MIN_ARR_ROWS = 50            # 도착 행이 이 이상인 틱 = 위치 API 공백 틱


# ── 읽기 ────────────────────────────────────────────────────

def read_gz(path) -> pd.DataFrame:
    """JSONL.gz → DataFrame. 모든 값은 문자열. pandas 날짜 자동 변환을 피하려고 직접 읽는다."""
    if not path.exists():
        return pd.DataFrame()
    with gzip.open(path, "rt", encoding="utf-8") as f:
        rows = [json.loads(line) for line in f]
    df = pd.DataFrame(rows).astype(str)
    return df.drop(columns=[col for col in PAGING_COLS if col in df.columns])


def load_night(night: str) -> tuple[pd.DataFrame, pd.DataFrame, int]:
    """한 밤의 위치·도착 원본. 도착은 1~9호선만. 미래 시각 스탬프는 버리고 그 수를 돌려준다."""
    folder = c.COLLECTED_DIR / night
    pos = read_gz(folder / f"position_{night}.jsonl.gz")
    arr = read_gz(folder / f"arrival_{night}.jsonl.gz")
    if not arr.empty:
        arr = arr[arr["subwayId"].str.fullmatch(r"100[1-9]")].copy()
    dropped = 0
    for df in (pos, arr):
        if df.empty:
            continue
        df["line"] = df["subwayId"].str[-1]
        df["obs_sec"] = c.obs_sec(df["recptnDt"], df["_service_date"])
        df["collected_sec"] = c.obs_sec(df["_collected_at"], df["_service_date"])
        future = df["obs_sec"] > df["collected_sec"] + FUTURE_TOL
        dropped += int(future.sum())
        df.drop(index=df.index[future | df["obs_sec"].isna()], inplace=True)
    return pos, arr, dropped


_TT_CACHE = {}


def load_timetable(tt_tag: str) -> pd.DataFrame:
    """공식 시간표 CSV 중 한 요일 태그. 열차 운행 순서(seq)와 앞뒤 역 행(prev_uid, next_uid)을 붙인다."""
    if tt_tag in _TT_CACHE:
        return _TT_CACHE[tt_tag]
    tt = pd.read_csv(c.TIMETABLE_CSV, encoding="cp949", dtype=str)
    tt = tt[tt["주중주말"] == tt_tag].copy()
    tt["line"] = tt["호선"].str.extract(r"(\d)")[0]
    tt["uid"] = tt["고유번호"]
    tt["digits"] = c.timetable_digits(tt["열차코드"])
    tt["nm"] = c.norm_station(tt["역사명"])
    tt["arr_sec"] = c.hms_to_sec(tt["열차도착시간"])
    tt["dep_sec"] = c.hms_to_sec(tt["열차출발시간"])
    # 도착 '00:00:00' + 급행 = 정차하지 않고 통과하는 행으로 추정(경인선 비정차역에 몰림)
    tt["pass_through"] = (tt["열차도착시간"] == "00:00:00") & (tt["급행여부"] == "1")
    # 운행 순서: 같은 (노선, 열차코드) 안에서 시각순. 도착이 없으면(시발) 출발 시각으로 정렬
    tt["t_order"] = tt["arr_sec"].fillna(tt["dep_sec"])
    tt = tt.sort_values(["line", "열차코드", "t_order"]).reset_index(drop=True)
    grp = tt.groupby(["line", "열차코드"], sort=False)
    tt["seq"] = grp.cumcount()
    tt["prev_uid"] = grp["uid"].shift(1)
    tt["next_uid"] = grp["uid"].shift(-1)
    prev_dep = tt.set_index("uid")["dep_sec"]
    tt["prev_dep_sec"] = tt["prev_uid"].map(prev_dep)
    _TT_CACHE[tt_tag] = tt
    return tt


# ── 밤 메타 ─────────────────────────────────────────────────

def night_meta(night: str, pos: pd.DataFrame, arr: pd.DataFrame, n_future: int) -> dict:
    """틱 수, 첫·마지막 틱, 위치 API 공백 시작.

    공백 틱 = 위치 행 ≤ 2 이고 도착 행 ≥ 50. 정체 행 한두 개에 판정이 흔들리지 않게 하고,
    운행이 끝나 둘 다 비는 정상적인 마지막 틱과 구분하려고 도착 행 조건을 같이 본다.
    공백 시작 = 그 틱부터 끝까지 위치 행이 계속 ≤ 2 인 첫 공백 틱.
    """
    tt_tag, day_type = c.day_info(night)
    tick_p = pos.groupby("collected_sec").size() if not pos.empty else pd.Series(dtype=int)
    tick_a = arr.groupby("collected_sec").size() if not arr.empty else pd.Series(dtype=int)
    ticks = pd.DataFrame({"pos": tick_p, "arr": tick_a}).fillna(0).sort_index()
    gap_start = np.nan
    if not ticks.empty:
        low = (ticks["pos"] <= GAP_MAX_POS_ROWS)
        tail_low = low[::-1].cumprod()[::-1].astype(bool)          # 이후 끝까지 계속 낮음
        cand = ticks[tail_low & (ticks["arr"] >= GAP_MIN_ARR_ROWS)]
        if not cand.empty:
            gap_start = float(cand.index.min())
    return {
        "night": night, "tt_tag": tt_tag, "day_type": day_type,
        "first_tick": float(ticks.index.min()) if not ticks.empty else np.nan,
        "last_tick": float(ticks.index.max()) if not ticks.empty else np.nan,
        "n_ticks_pos": int((ticks["pos"] > 0).sum()) if not ticks.empty else 0,
        "n_ticks_arr": int((ticks["arr"] > 0).sum()) if not ticks.empty else 0,
        "pos_gap_start_sec": gap_start,
        "n_pos_rows": len(pos), "n_arr_rows_1to9": len(arr),
        "n_future_dropped": n_future,
    }


# ── 스탬프 ──────────────────────────────────────────────────

def extract_stamps(pos: pd.DataFrame, arr: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    """두 API에서 상태 사건(도착·출발·전역출발) 스탬프를 뽑아 한 형식으로 합친다.

    같은 (열차, 역, 상태, 출처, 관측 시각)이 여러 틱에 반복되면 한 행으로 줄이고 n_raw에 횟수를 둔다.
    재방문(2호선 순환 등)을 살리려고 관측 시각이 다르면 별도 행으로 남긴다.
    """
    parts = []
    if not pos.empty:
        p = pos[pos["trainSttus"].isin(STATUS_POS)].copy()
        p["status"] = p["trainSttus"].map(STATUS_POS)
        p["train_no"] = p["trainNo"]
        p["src"] = "pos"
        parts.append(p)
    n_deadhead = 0
    n_deadhead_extra = 0
    if not arr.empty:
        a = arr[arr["arvlCd"].isin(STATUS_ARR)].copy()
        a["status"] = a["arvlCd"].map(STATUS_ARR)
        a["train_no"] = a["btrainNo"]
        num = pd.to_numeric(a["train_no"], errors="coerce")
        deadhead = (a["line"] == "3") & num.between(*DEADHEAD_3)
        n_deadhead = int(deadhead.sum())
        bad_arr = a["line"].isin(ARR_API_BAD_ARRIVAL_LINES) & (a["status"] == "arr")
        n_deadhead_extra = int(bad_arr.sum())
        a = a[~deadhead & ~bad_arr]
        a["src"] = "arr_api"
        parts.append(a)
    if not parts:
        return pd.DataFrame(), n_deadhead, 0
    s = pd.concat(parts, ignore_index=True)
    s["key"] = c.match_key(s["line"], s["train_no"])
    s["station"] = c.norm_station(s["statnNm"], s["line"])
    cols = ["line", "train_no", "key", "station", "statnId", "status", "src", "obs_sec"]
    out = (s.groupby(cols, as_index=False)
             .agg(collected_sec=("collected_sec", "min"), n_raw=("collected_sec", "size")))
    return out.rename(columns={"statnId": "statn_id"}), n_deadhead, n_deadhead_extra


# ── 시간표 매칭 ─────────────────────────────────────────────

def match_timetable(stamps: pd.DataFrame, tt: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """스탬프를 시간표 행에 붙인다. 기준 시각: 도착=열차도착시간, 출발=열차출발시간, 전역출발=앞 역 출발.

    후보 = (노선, 열차코드 숫자부, 역명)이 같은 행. 그중 |관측 − 기준|이 가장 작은 행을 MATCH_WIN 안에서 고른다.
    두 후보의 기준 시각 차이가 2×|지연|보다 작으면 ambiguous(같은 역을 짧은 간격으로 두 번 지나는 경우).
    """
    t = tt[~tt["pass_through"]][["line", "digits", "nm", "uid", "열차코드", "방향", "급행여부", "도착역",
                                 "arr_sec", "dep_sec", "prev_dep_sec"]]
    m = stamps.reset_index().merge(t, left_on=["line", "key", "station"],
                                   right_on=["line", "digits", "nm"], how="left")
    ref = np.select([m["status"] == "arr", m["status"] == "dep"],
                    [m["arr_sec"], m["dep_sec"]], default=m["prev_dep_sec"])
    m["sched_sec"] = ref
    m["diff"] = m["obs_sec"] - m["sched_sec"]
    m["absdiff"] = m["diff"].abs()

    has_code = stamps.assign(_k=list(zip(stamps["line"], stamps["key"])))["_k"].isin(
        set(zip(tt["line"], tt["digits"])))
    lo, hi = c.MATCH_WIN
    m["in_win"] = m["diff"].between(lo, hi)
    cand = m[m["in_win"]].sort_values(["index", "absdiff"])
    best = cand.drop_duplicates("index", keep="first").set_index("index")
    second = cand[cand.duplicated("index", keep="first")].drop_duplicates("index").set_index("index")
    best["ambiguous"] = False
    common_idx = best.index.intersection(second.index)
    gap = (best.loc[common_idx, "sched_sec"] - second.loc[common_idx, "sched_sec"]).abs()
    best.loc[common_idx, "ambiguous"] = gap < 2 * best.loc[common_idx, "absdiff"]

    matched = stamps.loc[best.index].copy()
    for col in ["uid", "열차코드", "방향", "급행여부", "도착역", "sched_sec"]:
        matched[col] = best[col]
    matched["delay_sec"] = matched["obs_sec"] - matched["sched_sec"]
    matched["ambiguous"] = best["ambiguous"]
    matched = matched.rename(columns={"열차코드": "sched_code", "방향": "direction",
                                      "급행여부": "express", "도착역": "dest"})

    # 매칭 실패 사유
    rest = stamps.drop(index=best.index).copy()
    near = m[m["index"].isin(rest.index) & m["diff"].notna()].sort_values(["index", "absdiff"]) \
        .drop_duplicates("index").set_index("index")["diff"]
    reason = pd.Series("no_station", index=rest.index)
    reason[~has_code.loc[rest.index]] = "no_train_code"
    reason[near.reindex(rest.index) > hi] = "out_of_window_pos"
    reason[near.reindex(rest.index) < lo] = "out_of_window_neg"
    rest["reason"] = reason
    rest["nearest_diff"] = near.reindex(rest.index)
    return matched, rest


def first_stamp(matched: pd.DataFrame) -> pd.DataFrame:
    """(시간표 행, 상태, 출처)마다 가장 이른 관측 하나. 재방문은 시간표 행이 달라 자연히 분리된다.

    종착역에 선 열차가 '도착'으로 20분 넘게 잡히며 recptnDt가 갱신되는 것을 첫 스탬프로 막는다.
    """
    agg = matched.sort_values("obs_sec").groupby(["uid", "status", "src"], as_index=False)
    first = agg.first()
    first["n_raw"] = agg["n_raw"].sum()["n_raw"].values
    return first


# ── 시간표 적합 · 플래그 ────────────────────────────────────

def tt_fit(night: str, stamps: pd.DataFrame, events: pd.DataFrame, tt: pd.DataFrame) -> pd.DataFrame:
    """(밤, 노선)마다 23시 이후 시간표 열차가 실제로 관측된 비율과 그 시간대 도착 지연 중앙값.

    추석 연휴(9/24, 9/25, 9/27)에 2·5·6·7·8호선 열차번호가 공식 휴일 시간표와 달라 관측률이 0~39%였다.
    평일 5호선은 매번 79%(59xx번대 미관측, 원인 미확인)라 기준을 0.9가 아니라 0.6으로 둔다.
    """
    late = tt[(tt["arr_sec"] >= c.HOUR_BANDS["23"][0]) & tt["digits"].notna()]
    seen = set(zip(stamps.loc[stamps["src"] == "pos", "line"], stamps.loc[stamps["src"] == "pos", "key"]))
    rows = []
    for line, g in late.groupby("line"):
        codes = set(g["digits"])
        rate = len({k for k in codes if (line, k) in seen}) / len(codes) if codes else np.nan
        e = events[(events["line"] == line) & (events["status"] == "arr") & (events["sched_sec"] >= 82800)]
        med = float(e["delay_sec"].median()) if len(e) else np.nan
        bad = (rate < TT_FIT_MIN_RATE) or (abs(med) > TT_FIT_MAX_MED if not np.isnan(med) else False)
        rows.append({"night": night, "line": line, "n_sched_trains_23plus": len(codes),
                     "obs_rate_23plus": round(rate, 3), "delay_med_23plus": med, "tt_unknown": bool(bad)})
    return pd.DataFrame(rows)


def flag_events(ev: pd.DataFrame, meta: dict, fit: pd.DataFrame) -> pd.DataFrame:
    """시간대, 관측 창 안 여부, 위치 공백 영향, 시간표 불일치 노선 표시."""
    ev["hour_band"] = c.hour_band(ev["sched_sec"])
    start = meta["first_tick"] + EARLY_E
    end = meta["last_tick"] - c.TRUNC_W
    ok = ev["sched_sec"].between(start, end)
    gap = meta["pos_gap_start_sec"]
    ev["pos_gap"] = False
    if not np.isnan(gap):
        hit = (ev["src"] == "pos") & (ev["sched_sec"] > gap - c.TRUNC_W)
        ev["pos_gap"] = hit
        ok &= ~hit
    ev["in_window"] = ok
    unknown = set(fit.loc[fit["tt_unknown"], "line"])
    ev["tt_unknown"] = ev["line"].isin(unknown)
    return ev


# ── 실행 ────────────────────────────────────────────────────

EVENT_COLS = ["night", "tt_tag", "day_type", "line", "train_no", "key", "station", "statn_id",
              "status", "src", "obs_sec", "uid", "sched_code", "direction", "express", "dest",
              "sched_sec", "delay_sec", "hour_band", "n_raw", "ambiguous", "in_window", "pos_gap",
              "tt_unknown"]


def process_night(night: str) -> tuple[dict, pd.DataFrame]:
    pos, arr, n_future = load_night(night)
    meta = night_meta(night, pos, arr, n_future)
    tt = load_timetable(meta["tt_tag"])
    stamps, n_deadhead, n_bad8 = extract_stamps(pos, arr)
    meta["n_excl_3line_deadhead"] = n_deadhead
    meta["n_excl_8line_arrapi_arrival"] = n_bad8
    if stamps.empty:
        return meta, pd.DataFrame()
    matched, unmatched = match_timetable(stamps, tt)
    events = first_stamp(matched)
    fit = tt_fit(night, stamps, events, tt)
    events = flag_events(events, meta, fit)
    events["night"], events["tt_tag"], events["day_type"] = night, meta["tt_tag"], meta["day_type"]

    EVENTS_DIR.mkdir(parents=True, exist_ok=True)
    stamps.assign(night=night).to_csv(EVENTS_DIR / f"stamps_{night}.csv", index=False, encoding="utf-8-sig")
    events[EVENT_COLS].to_csv(EVENTS_DIR / f"events_{night}.csv", index=False, encoding="utf-8-sig")
    unmatched.assign(night=night).to_csv(EVENTS_DIR / f"unmatched_{night}.csv", index=False, encoding="utf-8-sig")
    fit.to_csv(EVENTS_DIR / f"ttfit_{night}.csv", index=False, encoding="utf-8-sig")

    meta["n_stamps"] = len(stamps)
    meta["n_events"] = len(events)
    meta["stamp_match_rate"] = round(len(matched) / len(stamps), 4)
    for r, n in unmatched["reason"].value_counts().items():
        meta[f"n_unmatched_{r}"] = int(n)
    return meta, fit


def list_nights() -> list[str]:
    return sorted(p.name for p in c.COLLECTED_DIR.iterdir()
                  if p.is_dir() and (p / f"arrival_{p.name}.jsonl.gz").exists())


def main() -> None:
    parser = argparse.ArgumentParser(description="실시간 수집분 전처리 (plan.md 작업 1)")
    parser.add_argument("--nights", default="new", help="all | new(기본, 처리 안 한 밤만) | YYYYMMDD,YYYYMMDD")
    parser.add_argument("--force", action="store_true", help="이미 처리한 밤도 다시 처리")
    args = parser.parse_args()

    nights = list_nights() if args.nights in ("all", "new") else args.nights.split(",")
    meta_path = c.PROCESSED_DIR / "night_meta.csv"
    fit_path = c.PROCESSED_DIR / "tt_fit.csv"
    old_meta = pd.read_csv(meta_path, dtype={"night": str}) if meta_path.exists() else pd.DataFrame()
    old_fit = pd.read_csv(fit_path, dtype={"night": str, "line": str}) if fit_path.exists() else pd.DataFrame()

    metas, fits = [], []
    for night in nights:
        done = (EVENTS_DIR / f"events_{night}.csv").exists()
        if done and not args.force:
            continue
        meta, fit = process_night(night)
        metas.append(meta)
        fits.append(fit)
        print(f"{night} {meta['tt_tag']}: 스탬프 {meta.get('n_stamps', 0):,} → 사건 {meta.get('n_events', 0):,} "
              f"(매칭률 {meta.get('stamp_match_rate', 0):.1%}), 공백 시작 "
              f"{'-' if np.isnan(meta['pos_gap_start_sec']) else pd.to_datetime(meta['pos_gap_start_sec'], unit='s').strftime('%H:%M')}"
              f", 시간표 불일치 노선 {','.join(fit.loc[fit['tt_unknown'], 'line']) or '없음'}")

    if metas:
        new_meta = pd.DataFrame(metas)
        keep = old_meta[~old_meta["night"].isin(new_meta["night"])] if not old_meta.empty else old_meta
        pd.concat([keep, new_meta], ignore_index=True).sort_values("night") \
            .to_csv(meta_path, index=False, encoding="utf-8-sig")
        new_fit = pd.concat(fits, ignore_index=True)
        keepf = old_fit[~old_fit["night"].isin(new_fit["night"])] if not old_fit.empty else old_fit
        pd.concat([keepf, new_fit], ignore_index=True).sort_values(["night", "line"]) \
            .to_csv(fit_path, index=False, encoding="utf-8-sig")

    # 합본은 항상 전체 밤으로 다시 만든다
    files = sorted(EVENTS_DIR.glob("events_*.csv"))
    if files:
        allev = pd.concat([pd.read_csv(f, dtype={"night": str, "line": str, "train_no": str, "key": str,
                                                 "uid": str, "statn_id": str}) for f in files],
                          ignore_index=True)
        allev.to_csv(c.PROCESSED_DIR / "delay_events.csv", index=False, encoding="utf-8-sig")
        print(f"합본 delay_events.csv: {len(files)}밤, {len(allev):,}행")


if __name__ == "__main__":
    main()
