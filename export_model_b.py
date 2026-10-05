"""B 모형(팀 최종 채택) 내보내기: 다중회귀 + 잔차 경험분포 → web/public/data/model_b.json, model_b_findings.json.

원본은 팀원 폴더 B/(읽기 전용). 주모형 정의는 B/3단계_statsmodels_코드_v3.1.py, numpy 구현은 B/공통테이블_모델_코드_v3.1/model.py.

    Δ = (막차 출발 지연) − (도착열차 도착 지연),   성공 ⟺ S + Δ ≥ 0
    S = 막차 예정출발 − 도착열차 예정도착 − W,     W = 환승거리 ÷ 1.2 m/s
    주모형(행 단위 OLS, 학습 = 지연차이_초 가 있는 행):
        Δ ~ C(F, ref 1호선) + C(L, ref 1호선) + C(daytype, ref 평일) + C(A_status, ref 실측) + el10
        F = 도착노선, L = 환승노선(2호선은 열차코드가 "2"로 시작하지 않으면 "2호선지선"), el10 = 도착열차 경과운행시간(분) / 10
    성공 확률 p = 1 − searchsorted(정렬 잔차, −S − ŷ, side="left") / n   (잔차 경험분포, 노선 공통)
    앱 예측은 A_status = 실측(기준, 0).

이 파일의 예측 함수(predict_delta, prob_of, required_slack, transfer_b)는 export_for_app.py(prob_table p_b)와
check_route.py(엔진 대조)가 같이 쓴다. 엔진(web/src/route/prob.js)과 같은 순서로 더해 부동소수 결과까지 같게 한다.

사용: python export_model_b.py   (export_for_app.py main 끝에서도 불린다)
"""

import json
import sys
from datetime import datetime

import numpy as np
import pandas as pd

import common as c

B_DIR = c.BASE_DIR.parent / "B"
COMMON_CSV = B_DIR / "공통테이블_v3.1.csv"
WEB_DATA = c.BASE_DIR / "web" / "public" / "data"
VERSION = "v3.1"
WALK_SPEED = 1.2          # m/s. B 정의(서울교통공사 환승 소요시간과 같은 보행속도)
RESID_DECIMALS = 1        # model_b.json 잔차 반올림 자리. 앱·Python 모두 반올림한 잔차로 계산한다
REF = {"F": "1호선", "L": "1호선", "daytype": "평일", "A_status": "실측"}
CATS, NUMS = ["F", "L", "daytype", "A_status"], ["el10"]
WEEKEND = "주말·공휴일"

# B 보고서 8장 표(행 단위 계수, 초)·본문 수치. 재현 확인용(반올림 0.1초 일치를 본다)
REPORT_COEF = {"F[8호선]": 80.8, "F[6호선]": 72.0, "F[9호선]": 70.5, "F[2호선지선]": 37.8, "F[2호선]": 33.6,
               "L[8호선]": -112.2, "L[9호선]": -88.3, "L[3호선]": -44.5, "L[5호선]": -42.9, "L[2호선]": -40.2,
               "L[7호선]": -33.2, f"daytype[{WEEKEND}]": -16.3, "A_status[인접역추정]": -18.2, "el10": -3.6}
REPORT_R2, REPORT_SD, REPORT_N = 0.096, 139, 4160

# 「어떻게 계산했나요」 화면 수치. 보고서에서 옮겨 적은 값이고, 모형 적합으로 다시 나오는 값(밤 수·R²·계수)은 build_findings가 덮어쓴다
REPORT_FINDINGS = {
    "source": "막차_환승_B모델링_보고서_서경버전정리.docx (B 방법 1차 결과, v3.1)",
    "data": {"period": "9/16~10/1", "nights": 13, "weekday_nights": 9, "weekend_nights": 4, "combos": 111,
             "rows_common": 35394, "rows_delta": 4160, "excluded": "9/26·27(추석 막차 연장 운행)"},
    "judge": {"basis": "막차 실측 출발", "success_departure_pct": 57.6, "success_arrival_pct": 53.1,
              "arrival_gap_pp": 4.5},
    "model": {"r2": 0.096, "resid_sd_sec": 139},
    "validation": {"brier_baseline": 0.0913, "brier_model": 0.0544, "reduction_pct": 40,
                   "nights_improved": 13, "nights_total": 13},
    "findings": {"l8_coef_sec": -112.2, "l9_coef_sec": -88.3, "s90_l8_sec": 130, "s90_l9_sec": 125,
                 "weekday_last_links": 1299, "below90": 166, "below90_pct": 12.8},
    # 12장 민감도: 마진 60초면 365행이 50% 경계를 넘고 평일 위험 연결이 13% → 23%, 걸음 1.0~1.4m/s 사이에서 73~118행이 경계를 넘나듦
    "sensitivity": {"margin60_risky_from_pct": 13, "margin60_risky_to_pct": 23, "margin60_flip_rows": 365,
                    "walk_flip_rows_min": 73, "walk_flip_rows_max": 118},
}


# ── 적합 ────────────────────────────────────────────────────

def load_common() -> pd.DataFrame:
    """공통테이블 → 모형 열(F, L, daytype, A_status, el10, delta). B 3단계 코드와 같은 변환."""
    if not COMMON_CSV.exists():
        sys.exit(f"B 공통테이블이 없습니다: {COMMON_CSV}\n"
                 f"팀 B 폴더(공통테이블_v3.1.csv)를 저장소 옆 {B_DIR} 에 두고 다시 실행하세요.")
    d = pd.read_csv(COMMON_CSV, encoding="utf-8-sig", dtype={"도착노선": str, "환승노선": str, "밤": str})
    lab = lambda s: np.where(s == "2지선", "2호선지선", s + "호선")   # 2호선 본선 포함, 지선은 따로
    d["F"], d["L"] = lab(d["도착노선"]), lab(d["환승노선"])
    d["el10"] = d["도착열차_경과운행시간_분"] / 10
    return d.rename(columns={"요일유형": "daytype", "도착상태": "A_status", "지연차이_초": "delta"})


def design(df: pd.DataFrame) -> pd.DataFrame:
    """B model.py design()과 같은 더미 행렬: 범주별 기준 수준을 빼고 정렬 순서로, 상수 열은 버리고 절편."""
    parts = [pd.Series(1.0, index=df.index, name="절편")]
    for col in CATS:
        for lv in sorted(l for l in df[col].dropna().unique() if l != REF[col]):
            parts.append((df[col] == lv).astype(float).rename(f"{col}[{lv}]"))
    for col in NUMS:
        parts.append(df[col].astype(float).rename(col))
    X = pd.concat(parts, axis=1)
    X = X.loc[:, X.std() > 0].copy()
    X["절편"] = 1.0
    return X


def fit(d: pd.DataFrame) -> dict:
    """학습 행(지연차이 있음)으로 numpy lstsq OLS."""
    dd = d[d["delta"].notna()]
    X, y = design(dd), dd["delta"].to_numpy(float)
    b, *_ = np.linalg.lstsq(X.to_numpy(), y, rcond=None)
    r = y - X.to_numpy() @ b
    n, k = X.shape
    return {"coef": pd.Series(b, X.columns), "resid": r, "n": n,
            "r2": 1 - r @ r / ((y - y.mean()) @ (y - y.mean())), "sd": float(np.sqrt(r @ r / (n - k))),
            "nights": sorted(dd["밤"].unique()), "X": X, "y": y, "dd": dd}


def check_statsmodels(m: dict) -> None:
    """statsmodels가 설치돼 있으면 같은 식으로 적합해 계수를 대조한다(없으면 건너뜀)."""
    try:
        import statsmodels.formula.api as smf
    except ImportError:
        print("  statsmodels 미설치 — 대조 건너뜀(numpy lstsq 결과만 사용)")
        return
    f = ("delta ~ C(F, Treatment('1호선')) + C(L, Treatment('1호선')) + C(daytype, Treatment('평일'))"
         " + C(A_status, Treatment('실측')) + el10")
    sm = smf.ols(f, data=m["dd"]).fit()
    diff = max(abs(sm.params.to_numpy() - m["coef"].to_numpy()).max(), abs(sm.rsquared - m["r2"]))
    print(f"  statsmodels 대조: 계수·R² 최대 차이 {diff:.2e}")


def check_report(m: dict) -> bool:
    """B 보고서 8장 계수·R²·잔차 SD·학습 행 수와 반올림 일치 확인."""
    ok = True
    print(f"  학습 {m['n']}행 (보고서 {REPORT_N}) · R² {m['r2']:.4f} (보고서 {REPORT_R2}) · 잔차 SD {m['sd']:.1f}초 (보고서 {REPORT_SD})")
    ok &= m["n"] == REPORT_N and round(m["r2"], 3) == REPORT_R2 and round(m["sd"]) == REPORT_SD
    for k, v in REPORT_COEF.items():
        got = round(float(m["coef"][k]), 1)
        same = abs(got - v) < 1e-9
        ok &= same
        print(f"    {k:<22} {m['coef'][k]:+9.3f}  보고서 {v:+.1f}  {'일치' if same else '불일치'}")
    print("  보고서 수치 재현: " + ("모두 일치" if ok else "불일치 있음"))
    return ok


def build_model() -> dict:
    """model_b.json 객체. 계수는 전체 정밀도, 잔차는 소수 1자리로 반올림해 정렬한다."""
    d = load_common()
    m = fit(d)
    print(f"B 모형 적합: {COMMON_CSV.name}")
    check_statsmodels(m)
    m["report_ok"] = check_report(m)
    resid = np.sort(np.round(m["resid"], RESID_DECIMALS))
    return {
        "meta": {"source": f"B/{COMMON_CSV.name} (B/3단계_statsmodels_코드_v3.1.py 주모형)", "version": VERSION,
                 "nights": m["nights"], "n": int(m["n"]), "r2": round(float(m["r2"]), 4),
                 "resid_sd_sec": round(m["sd"], 1), "walk_speed_mps": WALK_SPEED,
                 "formula": "Δ ~ F + L + daytype + A_status + el10 (기준 1호선·1호선·평일·실측), p = P(잔차 ≥ −S − ŷ)",
                 "report_match": bool(m["report_ok"]),
                 "generated_at": datetime.now().isoformat(timespec="seconds")},
        "coef": {k: float(v) for k, v in m["coef"].items()},
        "resid": [round(float(x), RESID_DECIMALS) for x in resid],
    }


def build_findings(model: dict) -> dict:
    """화면용 수치: 보고서 값에 적합 결과(밤 수·학습 행·R²·SD·8·9호선 계수)를 덮어쓴다."""
    out = json.loads(json.dumps(REPORT_FINDINGS))
    mm = model["meta"]
    out["data"]["nights"] = len(mm["nights"])
    out["data"]["rows_delta"] = mm["n"]
    out["model"] = {"r2": mm["r2"], "resid_sd_sec": mm["resid_sd_sec"]}
    out["findings"]["l8_coef_sec"] = round(model["coef"]["L[8호선]"], 1)
    out["findings"]["l9_coef_sec"] = round(model["coef"]["L[9호선]"], 1)
    out["generated_at"] = mm["generated_at"]
    return out


def write(model: dict) -> None:
    WEB_DATA.mkdir(parents=True, exist_ok=True)
    for name, obj in (("model_b", model), ("model_b_findings", build_findings(model))):
        path = WEB_DATA / f"{name}.json"
        path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"{path.relative_to(c.BASE_DIR)}: {path.stat().st_size / 1024:.0f}KB")


# ── 예측(앱 엔진 prob.js 와 같은 계산) ─────────────────────────

def line_label(line: str, code: str) -> str:
    """노선 + 열차코드 → 모형 범주. 2호선 지선 열차는 코드가 1xxx·5xxx(본선은 2xxx)."""
    if line == "2" and not str(code).startswith("2"):
        return "2호선지선"
    return f"{line}호선"


def predict_delta(model: dict, f_label: str, l_label: str, weekend: bool, el10: float) -> float:
    """ŷ = 절편 + F + L + daytype + el10 계수 × el10 (A_status = 실측 → 0). 더하는 순서는 prob.js 와 같다."""
    cf = model["coef"]
    y = cf["절편"]
    y += cf.get(f"F[{f_label}]", 0.0)
    y += cf.get(f"L[{l_label}]", 0.0)
    y += cf.get(f"daytype[{WEEKEND}]", 0.0) if weekend else 0.0
    y += cf["el10"] * el10
    return y


def prob_of(resid: list, slack: float, yhat: float) -> float:
    """p = 1 − #(잔차 < −S − ŷ) / n."""
    import bisect
    return 1 - bisect.bisect_left(resid, -slack - yhat) / len(resid)


def required_slack(resid: list, yhat: float, target: float) -> float:
    """p ≥ target 이 되는 최소 S. p(S) ≥ target ⟺ #(잔차 < −S − ŷ) ≤ k, k = ⌊n(1 − target)⌋ ⟺ S ≥ −잔차[k] − ŷ."""
    k = int(np.floor(len(resid) * (1 - target) + 1e-9))
    return -resid[k] - yhat


def transfer_b(model: dict, a_line: str, a_code: str, a_start, arr_a: float, d_line: str, d_code: str,
               dep_d: float, walk_w: float, weekend: bool, margin: float = 0.0) -> dict:
    """환승 하나의 B 확률. el = (환승역 예정도착 − 그 열차 시발역 출발) 분. 시발 시각이 없으면 el = 0.
    margin = 여유 선호 c(초, 기본 0): 성공 ⟺ S + Δ ≥ c → p = P(잔차 ≥ c − S − ŷ), 필요 여유 s90·s80 도 c 만큼 커진다(prob.js 와 같음)."""
    el10 = (arr_a - a_start) / 600 if a_start is not None else 0.0
    yhat = predict_delta(model, line_label(a_line, a_code), line_label(d_line, d_code), weekend, el10)
    slack = dep_d - arr_a - walk_w
    r = model["resid"]
    return {"p": prob_of(r, slack - margin, yhat), "yhat": yhat, "slack": slack,
            "s90": required_slack(r, yhat, 0.9) + margin, "s80": required_slack(r, yhat, 0.8) + margin, "el10": el10}


def walk_of(distance_m, walk_sec, speed: float = WALK_SPEED) -> float:
    """W = 환승거리 ÷ 걸음 속도(B 정의 1.2m/s). 거리 자료가 없으면 환승 소요시간 × (1.2 ÷ 속도) — 1.2면 소요시간 그대로."""
    if distance_m is not None and not pd.isna(distance_m):
        return distance_m / speed
    return float(walk_sec) * (WALK_SPEED / speed)


def main() -> None:
    model = build_model()
    write(model)


if __name__ == "__main__":
    main()
