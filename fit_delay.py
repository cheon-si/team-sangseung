"""작업 4. 지연 분포 적합: 노선 × 요일 유형 × 시간대 셀마다 밤 균등 가중 경험적 CDF.

대상: 도착 지연 = 관측 − 시간표 도착(초). 22시 이후 시간표 행, 관측 창 안, 시간표 불일치 노선 제외.
같은 시간표 행이 두 API에 다 있으면 위치 API 쪽 1건만 쓴다.

밤 균등 가중: 밤마다 ECDF를 구해 평균한다. 사건이 적은 부분 수집 밤이 과소 반영되지 않게 하고,
"임의의 한 밤"이라는 추정 대상과 맞추기 위해서다(plan.md 공통 규약 '가중').

셀 병합은 표본 수로 정한다: 사건 20건 이상인 밤이 4개 미만이면 같은 노선·요일 안에서 굵은 묶음으로 올린다.
경합 구간 F의 밤 잭나이프 95% 반폭이 0.05를 넘으면 병합하지 않고 thin(불확실성 큼)으로 표시만 한다.
계획(plan.md 작업 4)은 반폭으로 병합하게 했지만, 2호선처럼 반폭이 큰 원인이 표본 부족이 아니라 밤 사이 차이
(9/22 이대역 화재로 본선 10분 지연)인 경우 시간대를 합쳐도 구간은 좁아지지 않고 실제 시간대 차이만 지워진다.
시간대 분리는 평일 데이터로 노선마다 판단하고(실질 차이 > 0.05 그리고 부호검정 p < 0.05), 주말은 평일 결정을 따른다.

출력:
    data/processed/delay_cells.csv   셀 요약
    data/processed/delay_grid.csv    셀별 CDF 격자(−120~+1800초, 15초)
    output/fit/band_test.csv          시간대 분리 판정
    output/figures/cdf_line{N}.png    노선별 그림 (--quick이면 생략)

사용:
    python fit_delay.py --quick                       # ECDF만, 병합 없음 (잠정 JSON용)
    python fit_delay.py --train-until 20261002        # 판단은 확증 세트 전 밤으로
"""

import argparse

import numpy as np
import pandas as pd

import common as c

GRID = np.arange(-120, 1801, 15)                 # 격자(초)
CONTESTED_X = GRID[(GRID >= -120) & (GRID <= 600)]  # 경합 구간 평가점
MIN_NIGHT_OBS = 20         # 한 밤의 ECDF를 쓰려면 그 셀에서 최소 이만큼 사건이 있어야 함
MIN_NIGHTS = 4
MAX_HALFWIDTH = 0.05
SEP_SUP = 0.05             # 시간대 분리 실질 기준
SEP_P = 0.05               # 시간대 분리 부호검정 기준
SHIFT_C = 180              # 로그정규 혼합 이동량(초)
FIT_DIR = c.OUTPUT_DIR / "fit"
FIG_DIR = c.OUTPUT_DIR / "figures"


# ── 데이터 ──────────────────────────────────────────────────

def load_delays(train_until: str | None = None) -> pd.DataFrame:
    ev = pd.read_csv(c.PROCESSED_DIR / "delay_events.csv",
                     dtype={"night": str, "line": str, "uid": str, "hour_band": str})
    d = ev[(ev["status"] == "arr") & ev["in_window"] & ~ev["tt_unknown"]
           & ev["hour_band"].isin(["22", "23", "24"])].copy()
    if train_until:
        d = d[d["night"] < train_until]
    # 같은 시간표 행이 두 출처에 다 있으면 위치 API 우선
    d["src_rank"] = (d["src"] != "pos").astype(int)
    d = d.sort_values("src_rank").drop_duplicates(["night", "uid"], keep="first")
    return d[["night", "day_type", "line", "hour_band", "station", "uid", "src", "delay_sec"]]


# ── 밤 균등 ECDF와 잭나이프 ─────────────────────────────────

def night_ecdf(df: pd.DataFrame, xs: np.ndarray) -> tuple[np.ndarray, list[str]]:
    """밤 × 평가점 ECDF 행렬. 사건이 MIN_NIGHT_OBS 미만인 밤은 뺀다."""
    mats, nights = [], []
    for night, g in df.groupby("night"):
        v = np.sort(g["delay_sec"].to_numpy())
        if len(v) < MIN_NIGHT_OBS:
            continue
        mats.append(np.searchsorted(v, xs, side="right") / len(v))
        nights.append(night)
    return (np.vstack(mats) if mats else np.empty((0, len(xs)))), nights


def jackknife(mat: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """밤 균등 평균과 잭나이프 SE. mat: 밤 × 평가점."""
    n = mat.shape[0]
    mean = mat.mean(axis=0)
    if n < 2:
        return mean, np.full_like(mean, np.nan)
    loo = (mat.sum(axis=0) - mat) / (n - 1)            # 밤 하나씩 뺀 평균
    se = np.sqrt((n - 1) / n * ((loo - loo.mean(axis=0)) ** 2).sum(axis=0))
    return mean, se


def cell_stats(df: pd.DataFrame) -> tuple[bool, int, float]:
    """(표본 충분 여부, 쓸 수 있는 밤 수, 경합 구간 잭나이프 95% 반폭 최댓값)."""
    mat, nights = night_ecdf(df, CONTESTED_X)
    n = len(nights)
    if n < 2:
        return n >= MIN_NIGHTS, n, np.nan
    _, se = jackknife(mat)
    return n >= MIN_NIGHTS, n, float(np.nanmax(c.t975(n - 1) * se))


# ── 시간대 분리 판정 ────────────────────────────────────────

def band_compare(a: pd.DataFrame, b: pd.DataFrame) -> dict:
    """두 시간대 집합의 경합 구간 CDF 비교: 밤 균등 평균의 sup 차이, 밤별 평균 차이의 부호검정."""
    ma, na = night_ecdf(a, CONTESTED_X)
    mb, nb = night_ecdf(b, CONTESTED_X)
    common_n = sorted(set(na) & set(nb))
    sup = float(np.abs(ma.mean(axis=0) - mb.mean(axis=0)).max()) if len(na) and len(nb) else np.nan
    if not common_n:
        return {"sup_diff": sup, "n_nights": 0, "n_same_sign": 0, "sign_p": 1.0}
    da = ma[[na.index(x) for x in common_n]]
    db = mb[[nb.index(x) for x in common_n]]
    per_night = (da - db).mean(axis=1)
    pos, neg = int((per_night > 0).sum()), int((per_night < 0).sum())
    k, n = max(pos, neg), pos + neg
    return {"sup_diff": sup, "n_nights": n, "n_same_sign": k, "sign_p": c.sign_test_p(k, n)}


def decide_bands(d: pd.DataFrame) -> tuple[dict, pd.DataFrame]:
    """노선별 시간대 묶음 결정(평일 데이터). 반환: {노선: {'22': 키, '23': 키, '24': 키}}, 판정표."""
    rules, rows = {}, []
    wk = d[d["day_type"] == "weekday"]
    for line in sorted(d["line"].unique()):
        g = wk[wk["line"] == line]
        r1 = band_compare(g[g["hour_band"] == "23"], g[g["hour_band"] == "24"])
        sep_2324 = r1["sup_diff"] > SEP_SUP and r1["sign_p"] < SEP_P
        rows.append({"line": line, "comparison": "23 vs 24", **r1, "separate": sep_2324})
        late = g[g["hour_band"].isin(["23", "24"])] if not sep_2324 else g[g["hour_band"] == "23"]
        r2 = band_compare(g[g["hour_band"] == "22"], late)
        sep_22 = r2["sup_diff"] > SEP_SUP and r2["sign_p"] < SEP_P
        rows.append({"line": line, "comparison": "22 vs 23" + ("" if sep_2324 else "-24"), **r2,
                     "separate": sep_22})
        if sep_22 and sep_2324:
            rules[line] = "P3"
        elif sep_22:
            rules[line] = "PA"
        elif sep_2324:
            rules[line] = "PB"
        else:
            rules[line] = "P1"
    return rules, pd.DataFrame(rows)


# 노선·요일 단위 분할 사다리. 분할 안의 셀이 하나라도 표본 부족이면 다음(더 굵은) 분할로 올린다.
P3 = {"22": "22", "23": "23", "24": "24"}
PA = {"22": "22", "23": "23-24", "24": "23-24"}
PB = {"22": "22-23", "23": "22-23", "24": "24"}
P1 = {"22": "all", "23": "all", "24": "all"}
LADDER = {"P3": [P3, PA, P1], "PA": [PA, P1], "PB": [PB, P1], "P1": [P1]}


# ── 모수 적합 (평활) ────────────────────────────────────────

def fit_lognorm_mix(v: np.ndarray, shift: float = SHIFT_C):
    """log(D + shift)에 2성분 정규 혼합. D ≤ −shift인 사건은 빼고 그 수를 돌려준다."""
    from sklearn.mixture import GaussianMixture   # scikit-learn: EM 초기화·수렴 처리를 검증된 구현에 맡김
    keep = v > -shift
    x = np.log(v[keep] + shift).reshape(-1, 1)
    if len(x) < 50:
        return None, int((~keep).sum())
    gm = GaussianMixture(n_components=2, random_state=0).fit(x)
    return (gm.weights_, gm.means_.ravel(), np.sqrt(gm.covariances_.ravel()), shift), int((~keep).sum())


def mix_cdf(params, xs: np.ndarray) -> np.ndarray:
    from math import erf, sqrt
    w, mu, sd, shift = params
    out = np.zeros(len(xs))
    for i, x in enumerate(xs):
        if x <= -shift:
            continue
        z = np.log(x + shift)
        out[i] = sum(wk * 0.5 * (1 + erf((z - m) / (s * sqrt(2)))) for wk, m, s in zip(w, mu, sd))
    return out


def crps_contested(F: np.ndarray, v: np.ndarray) -> float:
    """경합 구간에 한정한 CRPS(15초 격자 근사). F: CONTESTED_X 위의 CDF, v: 평가 사건 지연."""
    ind = (v[:, None] <= CONTESTED_X[None, :]).astype(float)
    return float(((F[None, :] - ind) ** 2).sum(axis=1).mean() * 15)


def crps_lono(df: pd.DataFrame) -> tuple[float, float]:
    """밤을 하나씩 빼고 적합한 ECDF와 모수 분포의 CRPS 평균(밤 균등)."""
    nights = sorted(df["night"].unique())
    ce, cp = [], []
    for n in nights:
        tr, te = df[df["night"] != n], df[df["night"] == n]["delay_sec"].to_numpy()
        if len(te) < MIN_NIGHT_OBS:
            continue
        mat, _ = night_ecdf(tr, CONTESTED_X)
        if mat.shape[0] == 0:
            continue
        ce.append(crps_contested(mat.mean(axis=0), te))
        params, _ = fit_lognorm_mix(tr["delay_sec"].to_numpy())
        if params is not None:
            cp.append(crps_contested(mix_cdf(params, CONTESTED_X), te))
    return (float(np.mean(ce)) if ce else np.nan), (float(np.mean(cp)) if cp else np.nan)


# ── 셀 적합 ─────────────────────────────────────────────────

def fit_cell(key: str, g: pd.DataFrame, quick: bool) -> tuple[dict, pd.DataFrame]:
    mat, nights = night_ecdf(g, GRID)
    F, _ = jackknife(mat) if len(nights) else (np.full(len(GRID), np.nan), None)
    v = g["delay_sec"].to_numpy()
    line, day_type, band = key.split("|")
    valid, n_nights, hw = cell_stats(g)
    row = {"dist_key": key, "line": line, "day_type": day_type, "hour_band": band,
           "n_obs": len(v), "n_nights": n_nights, "jack_halfwidth_max": hw, "enough_sample": valid,
           "median_sec": float(np.median(v)) if len(v) else np.nan,
           "p90_sec": float(np.quantile(v, 0.9)) if len(v) else np.nan,
           "p99_sec": float(np.quantile(v, 0.99)) if len(v) else np.nan,
           "share_over_grid": float((v > GRID[-1]).mean()) if len(v) else np.nan}
    grid = pd.DataFrame({"dist_key": key, "grid_sec": GRID, "cdf_ecdf": F, "cdf_param": np.nan})
    if not quick and len(v) >= 50:
        params, n_dropped = fit_lognorm_mix(v)
        if params is not None:
            grid["cdf_param"] = mix_cdf(params, GRID)
            w, mu, sd, shift = params
            row.update({"mix_w1": w[0], "mix_mu1": mu[0], "mix_s1": sd[0], "mix_mu2": mu[1],
                        "mix_s2": sd[1], "shift_c": shift, "n_below_shift": n_dropped,
                        "sup_diff_param": float(np.nanmax(np.abs(grid["cdf_param"] - F)))})
        row["crps_ecdf"], row["crps_param"] = crps_lono(g)
    return row, grid


def assign_keys(d: pd.DataFrame, rules: dict | None) -> pd.Series:
    """사건 → 셀 키. 노선·요일마다 판정된 분할에서 시작해, 표본 부족 셀이 없어지는 첫 분할을 쓴다."""
    if rules is None:   # quick: 시간대 그대로
        return d["line"] + "|" + d["day_type"] + "|" + d["hour_band"]
    keys = pd.Series(index=d.index, dtype=object)
    for (line, day), idx in d.groupby(["line", "day_type"]).groups.items():
        sub = d.loc[idx]
        for part in LADDER[rules.get(line, "P1")]:
            bands = sub["hour_band"].map(part)
            if part is P1 or all(cell_stats(sub[bands == b])[0] for b in bands.unique()):
                keys.loc[idx] = f"{line}|{day}|" + bands
                break
    return keys


def main() -> None:
    parser = argparse.ArgumentParser(description="지연 분포 적합 (plan.md 작업 4)")
    parser.add_argument("--quick", action="store_true", help="ECDF만, 병합·모수 적합 없음")
    parser.add_argument("--train-until", default=None,
                        help="이 날짜(YYYYMMDD) 전 밤만 사용. 판단용은 common.CONFIRM_START")
    args = parser.parse_args()

    d = load_delays(args.train_until)
    if args.quick:
        rules, band_tbl = None, pd.DataFrame()
    else:
        rules, band_tbl = decide_bands(d)
        # 주말은 평일 결정을 따른다(rules가 노선 단위라 그대로 적용됨)
    d["dist_key"] = assign_keys(d, rules)

    rows, grids = [], []
    for key, g in d.groupby("dist_key"):
        row, grid = fit_cell(key, g, args.quick)
        row["thin"] = (not row["enough_sample"]) or not (row["jack_halfwidth_max"] <= MAX_HALFWIDTH)
        row["param_used"] = bool(row["thin"] and row.get("crps_param", np.inf) < row.get("crps_ecdf", np.inf))
        rows.append(row)
        grids.append(grid)
    cells = pd.DataFrame(rows).sort_values("dist_key")
    grid = pd.concat(grids, ignore_index=True)
    assert (grid.groupby("dist_key")["cdf_ecdf"].diff().dropna() >= -1e-12).all(), "CDF 단조 위반"

    c.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    cells.to_csv(c.PROCESSED_DIR / "delay_cells.csv", index=False, encoding="utf-8-sig")
    grid.to_csv(c.PROCESSED_DIR / "delay_grid.csv", index=False, encoding="utf-8-sig")
    # 사건 → 셀 대응 (검증·앱 단계에서 같은 셀을 쓰기 위해)
    d[["night", "uid", "line", "day_type", "hour_band", "dist_key"]].to_csv(
        c.PROCESSED_DIR / "delay_cell_map.csv", index=False, encoding="utf-8-sig")
    if not band_tbl.empty:
        FIT_DIR.mkdir(parents=True, exist_ok=True)
        band_tbl.to_csv(FIT_DIR / "band_test.csv", index=False, encoding="utf-8-sig")
        plot_cdfs(cells, grid)

    nights = sorted(d["night"].unique())
    print(f"밤 {len(nights)}개({nights[0]}~{nights[-1]}), 사건 {len(d):,}, 셀 {len(cells)}개, "
          f"표본 충분 {int(cells['enough_sample'].sum())}, thin {int(cells['thin'].sum())}")
    show = cells[["dist_key", "n_obs", "n_nights", "jack_halfwidth_max", "median_sec", "p90_sec", "thin"]].copy()
    show[["median_sec", "p90_sec"]] = (show[["median_sec", "p90_sec"]] / 60).round(2)
    print(show.round(3).to_string(index=False))
    if not band_tbl.empty:
        print("\n시간대 분리 판정(평일):")
        print(band_tbl.round(3).to_string(index=False))


def plot_cdfs(cells: pd.DataFrame, grid: pd.DataFrame) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams["font.family"] = "Malgun Gothic"
    plt.rcParams["axes.unicode_minus"] = False
    FIG_DIR.mkdir(parents=True, exist_ok=True)
    for line, cl in cells.groupby("line"):
        fig, ax = plt.subplots(figsize=(7, 4))
        for key in cl["dist_key"]:
            g = grid[grid["dist_key"] == key]
            ax.plot(g["grid_sec"] / 60, g["cdf_ecdf"], label=key.split("|", 1)[1])
        ax.axvspan(-2, 10, color="grey", alpha=0.08)
        ax.set_xlim(-2, 15)
        ax.set_xlabel("도착 지연(분)")
        ax.set_ylabel("누적 비율")
        ax.set_title(f"{line}호선 도착 지연 ECDF (밤 균등 가중, 회색=경합 구간)")
        ax.legend(fontsize=8)
        fig.tight_layout()
        fig.savefig(FIG_DIR / f"cdf_line{line}.png", dpi=120)
        plt.close(fig)


if __name__ == "__main__":
    main()
