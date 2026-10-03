"""작업 6. 불확실성과 검증. (지금은 잭나이프 확률 구간만. LONO 검증은 이후 추가)

확률 구간: 밤 단위 잭나이프 + t 분포 (plan.md 작업 6).
  점추정 p = 밤별 ECDF를 버퍼 B에서 읽어 평균(밤 균등 가중)
  구간    = logit 척도에서 p ± t_{N−1}·SE_jack 를 되돌린 값
  경계 처리: 밤 하나를 뺀 추정치 중 0 또는 1이 있으면 logit이 정의되지 않으므로 p 척도로 계산해 [0,1]로 자른다.
            밤이 3개 미만이면 구간을 내지 않는다.
백분위 붓스트랩을 쓰지 않는 이유: 밤이 15개여도 구간이 실제보다 좁고, 3~4개면 분위수 자체가 불안정하다.
"""

import numpy as np
import pandas as pd

import common as c

MIN_NIGHT_OBS = 20
MIN_NIGHTS_CI = 3


def _logit(p):
    return np.log(p / (1 - p))


def _expit(x):
    return 1 / (1 + np.exp(-x))


def night_sorted(cell: pd.DataFrame) -> list[np.ndarray]:
    """셀 사건을 밤별 정렬 배열로. 사건이 MIN_NIGHT_OBS 미만인 밤은 뺀다."""
    out = []
    for _, g in cell.groupby("night"):
        v = np.sort(g["delay_sec"].to_numpy())
        if len(v) >= MIN_NIGHT_OBS:
            out.append(v)
    return out


def jackknife_p(nights: list[np.ndarray], b: float) -> dict:
    """P(지연 ≤ B)의 밤 균등 점추정과 잭나이프 95% 구간."""
    n = len(nights)
    if n == 0 or np.isnan(b):
        return {"p": None, "ci_low": None, "ci_high": None, "ci_note": "no_data", "n_nights": n}
    f = np.array([np.searchsorted(v, b, side="right") / len(v) for v in nights])
    p = float(f.mean())
    if n < MIN_NIGHTS_CI:
        return {"p": p, "ci_low": None, "ci_high": None, "ci_note": "insufficient_nights", "n_nights": n}
    loo = (f.sum() - f) / (n - 1)
    t = c.t975(n - 1)
    if ((loo > 0) & (loo < 1)).all() and 0 < p < 1:
        th = _logit(loo)
        se = np.sqrt((n - 1) / n * ((th - th.mean()) ** 2).sum())
        lo, hi = _expit(_logit(p) - t * se), _expit(_logit(p) + t * se)
        note = "logit"
    else:
        se = np.sqrt((n - 1) / n * ((loo - loo.mean()) ** 2).sum())
        lo, hi = max(0.0, p - t * se), min(1.0, p + t * se)
        note = "p_scale"
    return {"p": p, "ci_low": float(lo), "ci_high": float(hi), "ci_note": note, "n_nights": n}


if __name__ == "__main__":
    # 경계 처리 확인: 밤별 값이 0.2, 0, 0, 0 이면 첫 밤을 뺀 추정치가 0 → p 척도로 계산돼야 한다
    demo = [np.array([0] * 20 + [999] * 80), np.full(100, 999), np.full(100, 999), np.full(100, 999)]
    print(jackknife_p(demo, 0))
    print(jackknife_p(demo[:2], 0))
