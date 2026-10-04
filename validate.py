"""작업 6. 불확실성과 검증.

1) 확률 구간: 밤 단위 잭나이프 + t 분포.
   점추정 p = 밤별 분포로 계산한 확률의 밤 균등 평균. 구간 = logit 척도에서 p ± t_{N−1}·SE_jack.
   밤 하나를 뺀 추정치 중 0 또는 1이 있으면 p 척도로 계산해 [0,1]로 자르고, 밤이 3개 미만이면 구간을 내지 않는다.
   백분위 붓스트랩을 쓰지 않는 이유: 밤이 15개여도 구간이 실제보다 좁고, 3~4개면 분위수 자체가 불안정하다.

2) 모형
   1차 p_model = P(A 지연 ≤ B)                         갈아탈 막차는 정시 출발 가정
   2차 p_conv  = P(A 지연 − D 출발 지연 ≤ B)           주 모형(실측 Y와 Y_arr 불일치 10.5% → 사전 규칙)
       D 출발 지연은 "방향별 마지막 3편 출발" 분포. 일반 열차 출발은 막차와 다른 모집단이라 쓰지 않는다.
       두 지연은 독립으로 가정(한계: 연계 대기가 있으면 깨진다).
   비교: p_tt = 1[B ≥ 0](시간표), p_clim = 학습 밤 경합 구간 성공률, p_logit = logistic(B)(주 비교 대상)

3) LONO: 밤 n을 빼고 학습해 밤 n의 실측 Y를 예측. 시간대 분리·셀 병합은 fold마다 학습 밤만으로 다시 판정.
   --mode dry      평가 = 확증 전 밤, 학습에서 확증 밤 제외 (지금 단계의 틀 점검)
   --mode confirm  평가 = 확증 밤(10/2~), 학습 = 그 밤을 뺀 전체. 보고서 검증 절의 주 결과
   --mode final    평가 = 전체 밤. 최종 앱 수치와 보조 결과

출력: output/validation/{mode}_lono_predictions.csv, {mode}_metrics.csv, {mode}_calibration.png,
      {mode}_overdispersion.csv, mde.csv(dry), coverage_sim.csv
사용: python validate.py --mode dry
"""

import argparse

import numpy as np
import pandas as pd

import common as c

MIN_NIGHT_OBS = 20
MIN_NIGHTS_CI = 3
LAST_K = 3                         # D 출발 지연: 방향별 마지막 3편
MIN_DEP_NIGHT_OBS = 5              # D 출발 표본은 밤당 건수가 적다(1호선 평일 밤당 약 16건). 이 이상이면 그 밤을 쓴다
LOGIT_B_RANGE = (-300, 900)        # logistic(B) 학습 범위(완전분리로 기울기가 왜곡되는 것을 막음)
LOGIT_CS = [0.01, 0.1, 1.0, 10.0]
CONTESTED = (-120, 600)
FRI_PRE_HOLIDAY = {"20260918", "20260923", "20261002", "20261008"}
CHUSEOK = {"20260924", "20260925", "20260926"}
VAL_DIR = c.OUTPUT_DIR / "validation"


def _logit(p):
    return np.log(p / (1 - p))


def _expit(x):
    return 1 / (1 + np.exp(-x))


# ── 1) 잭나이프 구간 ────────────────────────────────────────

def night_sorted(cell: pd.DataFrame) -> list[np.ndarray]:
    """셀 사건을 밤별 정렬 배열로. 사건이 MIN_NIGHT_OBS 미만인 밤은 뺀다."""
    out = []
    for _, g in cell.groupby("night"):
        v = np.sort(g["delay_sec"].to_numpy())
        if len(v) >= MIN_NIGHT_OBS:
            out.append(v)
    return out


def night_sorted_dict(cell: pd.DataFrame, min_obs: int = MIN_NIGHT_OBS) -> dict:
    return {n: np.sort(g["delay_sec"].to_numpy()) for n, g in cell.groupby("night")
            if len(g) >= min_obs}


def dep_dists(deps: pd.DataFrame) -> dict:
    """(노선, 요일 유형) → 밤별 D 출발 지연. 밤이 3개 미만인 (노선, 요일)은 같은 노선의 다른 요일 분포로 대체한다.
    주말 2·5·6·7·8호선은 추석 시간표 불일치로 9/19·9/20 두 밤뿐이라 평일 분포를 빌린다(한계로 기록)."""
    out = {k: night_sorted_dict(g, MIN_DEP_NIGHT_OBS) for k, g in deps.groupby(["line", "day_type"])}
    fallback = {}
    for line in sorted({k[0] for k in out}):
        for day, other in (("weekday", "weekend"), ("weekend", "weekday")):
            if len(out.get((line, day), {})) < MIN_NIGHTS_CI and len(out.get((line, other), {})) >= MIN_NIGHTS_CI:
                fallback[(line, day)] = (line, other)
    for k, src in fallback.items():
        out[k] = out[src]
    out["_fallback"] = fallback
    return out


def _jk_interval(p: float, loo: np.ndarray, n: int) -> dict:
    if n < MIN_NIGHTS_CI:
        return {"p": p, "ci_low": None, "ci_high": None, "ci_note": "insufficient_nights", "n_nights": n}
    t = c.t975(n - 1)
    if ((loo > 0) & (loo < 1)).all() and 0 < p < 1:
        th = _logit(loo)
        se = np.sqrt((n - 1) / n * ((th - th.mean()) ** 2).sum())
        return {"p": p, "ci_low": float(_expit(_logit(p) - t * se)), "ci_high": float(_expit(_logit(p) + t * se)),
                "ci_note": "logit", "n_nights": n}
    se = np.sqrt((n - 1) / n * ((loo - loo.mean()) ** 2).sum())
    return {"p": p, "ci_low": float(max(0.0, p - t * se)), "ci_high": float(min(1.0, p + t * se)),
            "ci_note": "p_scale", "n_nights": n}


def jackknife_p(nights: list[np.ndarray], b: float) -> dict:
    """1차: P(지연 ≤ B)의 밤 균등 점추정과 잭나이프 95% 구간."""
    n = len(nights)
    if n == 0 or np.isnan(b):
        return {"p": None, "ci_low": None, "ci_high": None, "ci_note": "no_data", "n_nights": n}
    f = np.array([np.searchsorted(v, b, side="right") / len(v) for v in nights])
    p = float(f.mean())
    return _jk_interval(p, (f.sum() - f) / (n - 1) if n > 1 else f, n)


def conv_matrix(a_nights: dict, d_nights: dict, b: float) -> tuple[np.ndarray, list, list]:
    """C[i, j] = 밤 i의 A 분포와 밤 j의 D 분포로 계산한 P(A − D ≤ B) = mean_{d∈D_j} F_A,i(B + d)."""
    ai, dj = sorted(a_nights), sorted(d_nights)
    C = np.empty((len(ai), len(dj)))
    for x, i in enumerate(ai):
        A = a_nights[i]
        for y, j in enumerate(dj):
            C[x, y] = (np.searchsorted(A, b + d_nights[j], side="right") / len(A)).mean()
    return C, ai, dj


def jackknife_conv(a_nights: dict, d_nights: dict, b: float) -> dict:
    """2차: P(A 지연 − D 출발 지연 ≤ B)의 밤 균등 점추정과 잭나이프 구간. 밤 n을 빼면 A·D 양쪽에서 함께 뺀다."""
    if not a_nights or not d_nights or np.isnan(b):
        return {"p": None, "ci_low": None, "ci_high": None, "ci_note": "no_data", "n_nights": len(a_nights)}
    C, ai, dj = conv_matrix(a_nights, d_nights, b)
    p = float(C.mean())
    nights = sorted(set(ai) | set(dj))
    loo = []
    for n in nights:
        r = [x for x, i in enumerate(ai) if i != n]
        q = [y for y, j in enumerate(dj) if j != n]
        if r and q:
            loo.append(C[np.ix_(r, q)].mean())
    return _jk_interval(p, np.array(loo), len(loo))


# ── 2) 학습 데이터 구성 ─────────────────────────────────────

def load_dep_delays(nights: list[str]) -> pd.DataFrame:
    """D 출발 지연 표본: 시간표 (노선, 역, 방향)별 마지막 LAST_K편 출발 행의 관측 출발 지연."""
    from preprocess import load_timetable
    ev = pd.read_csv(c.PROCESSED_DIR / "delay_events.csv",
                     dtype={"night": str, "line": str, "uid": str})
    ev = ev[(ev["status"] == "dep") & ev["in_window"] & ~ev["tt_unknown"] & ev["night"].isin(nights)]
    last = set()
    for tag in ("DAY", "SAT", "END"):
        tt = load_timetable(tag)
        ok = tt[tt["dep_sec"].notna()].sort_values("dep_sec")
        last |= set(ok.groupby(["line", "nm", "방향"]).tail(LAST_K)["uid"])
    ev = ev[ev["uid"].isin(last)].copy()
    ev["src_rank"] = (ev["src"] != "pos").astype(int)
    ev = ev.sort_values("src_rank").drop_duplicates(["night", "uid"], keep="first")
    return ev[["night", "day_type", "line", "uid", "delay_sec"]]


class FoldModel:
    """학습 밤 집합 하나로 만든 지연 분포들(셀별 A 도착, 노선·요일별 D 출발)과 로지스틱."""

    def __init__(self, train_nights: list[str], delays: pd.DataFrame, deps: pd.DataFrame, labels: pd.DataFrame):
        from fit_delay import assign_keys, decide_bands
        d = delays[delays["night"].isin(train_nights)].copy()
        rules, _ = decide_bands(d)
        d["dist_key"] = assign_keys(d, rules)
        self.cells = {k: night_sorted_dict(g) for k, g in d.groupby("dist_key")}
        self.cell_bands = {}
        for k in self.cells:
            line, day, band = k.split("|")
            self.cell_bands.setdefault((line, day), []).append(band)
        dp = deps[deps["night"].isin(train_nights)]
        self.deps = dep_dists(dp)
        tr = labels[labels["night"].isin(train_nights) & (labels["label_grade"] == "main")]
        self.clim = tr[tr["contested"]].groupby("day_type")["y"].mean().to_dict()
        self.logit = fit_logit(tr)

    def cell_of(self, line: str, day: str, band: str):
        members = {"22": {"22"}, "23": {"23"}, "24": {"24"}, "23-24": {"23", "24"}, "22-23": {"22", "23"},
                   "all": {"22", "23", "24"}}
        for b in self.cell_bands.get((line, day), []):
            if band in members[b]:
                return f"{line}|{day}|{b}"
        return None

    def predict(self, from_line, to_line, day, band, b) -> dict:
        key = self.cell_of(from_line, day, band)
        A = self.cells.get(key, {})
        D = self.deps.get((to_line, day), {})
        p1 = float(np.mean([np.searchsorted(v, b, side="right") / len(v) for v in A.values()])) if A else np.nan
        p2 = float(conv_matrix(A, D, b)[0].mean()) if A and D else np.nan
        pl = self.logit(b) if self.logit else np.nan
        return {"p_model": p1, "p_conv": p2, "p_tt": float(b >= 0), "p_clim": self.clim.get(day, np.nan),
                "p_logit": pl, "dist_key": key}


def fit_logit(tr: pd.DataFrame):
    """logistic(B). B 범위를 제한하고 벌점 C는 학습 밤 안에서 밤 하나씩 빼는 내부 검증으로 고른다."""
    from sklearn.linear_model import LogisticRegression   # scikit-learn: 벌점 로지스틱의 검증된 구현
    t = tr[tr["buffer_sec"].between(*LOGIT_B_RANGE) & tr["y"].notna()]
    if t["y"].nunique() < 2 or len(t) < 20:
        return None
    mu, sd = t["buffer_sec"].mean(), t["buffer_sec"].std()
    X, y, g = ((t["buffer_sec"] - mu) / sd).to_numpy()[:, None], t["y"].to_numpy(), t["night"].to_numpy()
    best, best_c = np.inf, 1.0
    for C in LOGIT_CS:
        err = []
        for n in np.unique(g):
            m = g != n
            if len(np.unique(y[m])) < 2:
                continue
            p = LogisticRegression(C=C).fit(X[m], y[m]).predict_proba(X[~m])[:, 1]
            err.append(((p - y[~m]) ** 2).mean())
        if err and np.mean(err) < best:
            best, best_c = np.mean(err), C
    model = LogisticRegression(C=best_c).fit(X, y)
    return lambda b: float(model.predict_proba(np.array([[(b - mu) / sd]]))[0, 1])


# ── 3) LONO ─────────────────────────────────────────────────

def label_rows(y: pd.DataFrame, pairs: pd.DataFrame) -> pd.DataFrame:
    """평가용 라벨 + 민감도용 변형(도보 0.8·1.2배, a_late_unseen을 실패로)."""
    p = pairs[["combo_id", "tt_tag", "from_line", "to_line", "a_hour_band", "a_arr_sec", "d_dep_sec"]]
    lab = y.merge(p, on=["combo_id", "tt_tag"], how="left")
    rows = []
    base = lab[lab["label_grade"].notna()].copy()
    base["variant"] = "base"
    rows.append(base)
    for f in (0.8, 1.2):
        v = base[base["label_grade"] == "main"].copy()
        v["buffer_sec"] = v["buffer_sec"] + v["walk_sec"] * (1 - f)
        v["y"] = (v["a_obs_sec"] + f * v["walk_sec"] <= v["d_obs_sec"]).astype(float)
        v["contested"] = v["buffer_sec"].between(*CONTESTED)
        v["variant"] = f"walk_{f}"
        rows.append(v)
    late = lab[lab["na_reason"] == "a_late_unseen"].copy()
    late["y"], late["label_grade"], late["variant"] = 0.0, "main", "late_as_fail"
    rows.append(pd.concat([base[base["label_grade"] == "main"].assign(variant="late_as_fail"), late]))
    return pd.concat(rows, ignore_index=True)


def lono(mode: str) -> pd.DataFrame:
    from fit_delay import load_delays
    meta = pd.read_csv(c.PROCESSED_DIR / "night_meta.csv", dtype={"night": str})
    all_nights = meta["night"].tolist()
    pre = [n for n in all_nights if n < c.CONFIRM_START]
    conf = [n for n in all_nights if n >= c.CONFIRM_START]
    if mode == "dry":
        pool, eval_nights = pre, pre
    elif mode == "confirm":
        pool, eval_nights = all_nights, conf
    else:
        pool, eval_nights = all_nights, all_nights

    delays = load_delays(None)
    deps = load_dep_delays(pool)
    y = pd.read_csv(c.PROCESSED_DIR / "y_events.csv", dtype={"night": str})
    pairs = pd.read_csv(c.PROCESSED_DIR / "last_train_pairs.csv",
                        dtype={"from_line": str, "to_line": str, "a_hour_band": str})
    labels = label_rows(y, pairs)
    base_labels = labels[labels["variant"] == "base"]

    preds = []
    for n in eval_nights:
        train = [x for x in pool if x != n]
        fm = FoldModel(train, delays, deps, base_labels)
        for r in labels[labels["night"] == n].itertuples():
            pr = fm.predict(r.from_line, r.to_line, r.day_type, r.a_hour_band, r.buffer_sec)
            preds.append({"night": n, "variant": r.variant, "combo_id": r.combo_id, "tt_tag": r.tt_tag,
                          "day_type": r.day_type, "buffer_sec": r.buffer_sec, "contested": r.contested,
                          "label_grade": r.label_grade, "night_status": r.night_status, "y": r.y,
                          "y_arr": r.y_arr, "confirm_set": n >= c.CONFIRM_START, **pr})
        print(f"  fold {n}: 라벨 {int((labels['night'] == n).sum())}건", flush=True)
    return pd.DataFrame(preds)


# ── 지표 ────────────────────────────────────────────────────

def night_brier(df: pd.DataFrame, col: str) -> pd.Series:
    d = df.dropna(subset=[col, "y"])
    return d.assign(se=(d[col] - d["y"]) ** 2).groupby("night")["se"].mean()


def calib(df: pd.DataFrame, col: str) -> tuple[float, float, float, float]:
    """보정 절편·기울기: logit P(Y=1) = a + b·logit(p) (이항 로지스틱). p는 [0.01, 0.99]로 자름. 밤 잭나이프 반폭."""
    from sklearn.linear_model import LogisticRegression
    d = df.dropna(subset=[col, "y"])
    if d["y"].nunique() < 2:
        return np.nan, np.nan, np.nan, np.nan

    def fit(x):
        X = _logit(x[col].clip(0.01, 0.99)).to_numpy()[:, None]
        m = LogisticRegression(C=1e6).fit(X, x["y"].to_numpy())
        return m.intercept_[0], m.coef_[0, 0]
    a, b = fit(d)
    nights = d["night"].unique()
    if len(nights) < 3:
        return a, b, np.nan, np.nan
    loo = np.array([fit(d[d["night"] != n]) for n in nights if d.loc[d["night"] != n, "y"].nunique() == 2])
    k = len(loo)
    se = np.sqrt((k - 1) / k * ((loo - loo.mean(axis=0)) ** 2).sum(axis=0))
    t = c.t975(k - 1)
    return a, b, t * se[0], t * se[1]


SUBSETS = {
    "primary(평일·경합·주라벨)": lambda d: (d["variant"] == "base") & (d["day_type"] == "weekday") & d["contested"] & (d["label_grade"] == "main"),
    "전체 주라벨": lambda d: (d["variant"] == "base") & (d["label_grade"] == "main"),
    "주말·경합·주라벨": lambda d: (d["variant"] == "base") & (d["day_type"] == "weekend") & d["contested"] & (d["label_grade"] == "main"),
    "주말·경합 추석 제외": lambda d: (d["variant"] == "base") & (d["day_type"] == "weekend") & d["contested"] & (d["label_grade"] == "main") & ~d["night"].isin(CHUSEOK),
    "평일·경합 +단측확정": lambda d: (d["variant"] == "base") & (d["day_type"] == "weekday") & d["contested"] & d["label_grade"].isin(["main", "one_sided"]),
    "평일·경합 +보간": lambda d: (d["variant"] == "base") & (d["day_type"] == "weekday") & d["contested"],
    "평일·경합 정상 밤만": lambda d: (d["variant"] == "base") & (d["day_type"] == "weekday") & d["contested"] & (d["label_grade"] == "main") & (d["night_status"] == "정상"),
    "평일·경합 금·연휴전날 제외": lambda d: (d["variant"] == "base") & (d["day_type"] == "weekday") & d["contested"] & (d["label_grade"] == "main") & ~d["night"].isin(FRI_PRE_HOLIDAY),
    "평일·경합 도보×0.8": lambda d: (d["variant"] == "walk_0.8") & (d["day_type"] == "weekday") & d["contested"],
    "평일·경합 도보×1.2": lambda d: (d["variant"] == "walk_1.2") & (d["day_type"] == "weekday") & d["contested"],
    "평일·경합 늦은미관측=실패": lambda d: (d["variant"] == "late_as_fail") & (d["day_type"] == "weekday") & d["contested"],
}
MODELS = ["p_conv", "p_model", "p_logit", "p_clim", "p_tt"]


def metrics(pred: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for name, f in SUBSETS.items():
        # 모든 모형을 같은 (밤, 조합) 교집합에서 평가한다(plan.md 작업 6)
        s = pred[f(pred)].dropna(subset=MODELS + ["y"])
        if s.empty:
            continue
        ref = night_brier(s, "p_logit")
        for m in MODELS:
            nb = night_brier(s, m)
            row = {"subset": name, "model": m, "n_labels": int(s[m].notna().sum()), "n_combos": s["combo_id"].nunique(),
                   "n_nights": len(nb), "y_rate": s["y"].mean(), "brier": nb.mean()}
            if m != "p_logit":
                dd = (nb - ref).dropna()
                k = len(dd)
                row["dbrier_vs_logit"] = dd.mean() if k else np.nan
                if k >= 2:
                    hw = c.t975(k - 1) * dd.std(ddof=1) / np.sqrt(k)
                    row["dbrier_ci_low"], row["dbrier_ci_high"] = dd.mean() - hw, dd.mean() + hw
            if m != "p_tt":
                a, b, ha, hb = calib(s, m)
                row.update(calib_a=a, calib_a_hw=ha, calib_b=b, calib_b_hw=hb)
            rows.append(row)
    return pd.DataFrame(rows)


def overdispersion(pred: pd.DataFrame, col="p_conv") -> dict:
    """조합 단위 과산포: Σ_c (Σ_n (y−p))² / Σ_n p(1−p). 1보다 훨씬 크면 역(조합) 단위 효과가 남아 있다."""
    s = pred[SUBSETS["primary(평일·경합·주라벨)"](pred)].dropna(subset=[col, "y"])
    g = s.assign(r=s["y"] - s[col], v=s[col] * (1 - s[col])).groupby("combo_id")[["r", "v"]].sum()
    g = g[g["v"] > 0]
    chi2 = float((g["r"] ** 2 / g["v"]).sum())
    return {"model": col, "n_combos": len(g), "chi2": chi2, "df": len(g), "ratio": chi2 / len(g) if len(g) else np.nan}


def reliability_plot(pred: pd.DataFrame, path, col="p_conv") -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams["font.family"] = "Malgun Gothic"
    plt.rcParams["axes.unicode_minus"] = False
    s = pred[SUBSETS["primary(평일·경합·주라벨)"](pred)].dropna(subset=[col, "y"])
    if len(s) < 10:
        return
    s = s.assign(bin=pd.qcut(s[col].rank(method="first"), 5, labels=False))
    t = s.groupby("bin").agg(p=(col, "mean"), y=("y", "mean"), n=("y", "size"),
                             combos=("combo_id", "nunique"), nights=("night", "nunique"))
    fig, ax = plt.subplots(figsize=(5, 5))
    ax.plot([0, 1], [0, 1], color="grey", lw=1, ls="--")
    ax.plot(t["p"], t["y"], marker="o")
    for _, r in t.iterrows():
        ax.annotate(f"n{int(r.n)}·조합{int(r.combos)}·밤{int(r.nights)}", (r.p, r.y), fontsize=7,
                    textcoords="offset points", xytext=(4, -10))
    ax.set_xlabel("예측 성공 확률(2차 모형)")
    ax.set_ylabel("실측 성공 비율")
    ax.set_title("신뢰도 도표: 평일·경합 구간·주 라벨 (등빈도 5구간)")
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def mde(pred: pd.DataFrame) -> pd.DataFrame:
    """검출 가능한 최소 ΔBrier(양측 α=0.05, 검정력 80%): (t_{N−1} + 0.842)·σ̂/√N."""
    s = pred[SUBSETS["primary(평일·경합·주라벨)"](pred)]
    dd = (night_brier(s, "p_conv") - night_brier(s, "p_logit")).dropna()
    sd = dd.std(ddof=1)
    return pd.DataFrame([{"n_nights": n, "sigma_hat": sd, "mde": (c.t975(n - 1) + 0.842) * sd / np.sqrt(n)}
                         for n in (6, 9, 15)])


def simulate_coverage(reps: int = 200) -> pd.DataFrame:
    """밤 효과가 있는 가짜 데이터로 잭나이프-t와 백분위 붓스트랩 구간의 95% 포함률 비교."""
    from math import erf, sqrt
    rng = np.random.default_rng(c.SEED)
    B, mu, sd, tau = 60.0, 30.0, 60.0, 40.0
    u = rng.normal(0, tau, 200000)
    truth = float(np.mean([0.5 * (1 + erf((B - mu - x) / (sd * sqrt(2)))) for x in u[:20000]]))
    rows = []
    for G in (3, 4, 6, 12, 15):
        hit_j = hit_b = 0
        for _ in range(reps):
            nights = [np.sort(rng.normal(mu + rng.normal(0, tau), sd, 300)) for _ in range(G)]
            jk = jackknife_p(nights, B)
            if jk["ci_low"] is not None and jk["ci_low"] <= truth <= jk["ci_high"]:
                hit_j += 1
            f = np.array([np.searchsorted(v, B, side="right") / len(v) for v in nights])
            boot = [f[rng.integers(0, G, G)].mean() for _ in range(400)]
            lo, hi = np.quantile(boot, [0.025, 0.975])
            hit_b += lo <= truth <= hi
        rows.append({"G": G, "coverage_jackknife_t": hit_j / reps, "coverage_bootstrap_pct": hit_b / reps})
    return pd.DataFrame(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="검증 (plan.md 작업 6)")
    parser.add_argument("--mode", choices=["dry", "confirm", "final"], default="dry")
    parser.add_argument("--sim", action="store_true", help="구간 포함률 모의실험도 실행")
    args = parser.parse_args()
    VAL_DIR.mkdir(parents=True, exist_ok=True)

    pred = lono(args.mode)
    pred.to_csv(VAL_DIR / f"{args.mode}_lono_predictions.csv", index=False, encoding="utf-8-sig")
    met = metrics(pred)
    met.to_csv(VAL_DIR / f"{args.mode}_metrics.csv", index=False, encoding="utf-8-sig")
    od = pd.DataFrame([overdispersion(pred, "p_conv"), overdispersion(pred, "p_model")])
    od.to_csv(VAL_DIR / f"{args.mode}_overdispersion.csv", index=False, encoding="utf-8-sig")
    reliability_plot(pred, VAL_DIR / f"{args.mode}_calibration.png")

    show = met[met["subset"].str.startswith("primary")].round(4)
    print("\n주 결과(평일·경합 구간·주 라벨):")
    print(show.drop(columns=["subset"]).to_string(index=False))
    print("\n부분집합별 2차 모형 대 logistic(B):")
    print(met[met["model"] == "p_conv"][["subset", "n_labels", "n_nights", "brier", "dbrier_vs_logit",
                                          "dbrier_ci_low", "dbrier_ci_high", "calib_a", "calib_b"]].round(4).to_string(index=False))
    print("\n과산포:", od.round(3).to_dict("records"))
    if args.mode == "dry":
        m = mde(pred)
        m.to_csv(VAL_DIR / "mde.csv", index=False, encoding="utf-8-sig")
        print("\n검출 가능한 최소 ΔBrier:", m.round(4).to_dict("records"))
    if args.sim:
        sim = simulate_coverage()
        sim.to_csv(VAL_DIR / "coverage_sim.csv", index=False, encoding="utf-8-sig")
        print("\n구간 포함률 모의실험:\n", sim.to_string(index=False))


if __name__ == "__main__":
    main()
