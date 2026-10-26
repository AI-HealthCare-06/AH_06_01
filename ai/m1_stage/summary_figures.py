"""
[파일] summary_figures.py
[용도] 진행 경과 문서(docs/M1_진행경과_정리.md)에 붙일 요약 도표 9장을 reports/figures_summary/ 에 만든다. 수치는 보고서 파일(boost_*, boost2_*, boost3_*, maxsearch_*, final_*)과 데이터·최종 모델에서 읽는다.
[쓰는 곳] python3 summary_figures.py
"""

from __future__ import annotations

import glob
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from matplotlib import font_manager  # noqa: E402
from matplotlib.patches import FancyBboxPatch  # noqa: E402

import thresholds as T  # noqa: E402
from m1.chain import ChainPreprocessor, load_frame, stage_from_bp  # noqa: E402
from m1.final_model import FinalStageModel, _base_of  # noqa: E402

_KO = [f for f in ("Apple SD Gothic Neo", "AppleGothic", "NanumGothic", "Malgun Gothic") if f in {x.name for x in font_manager.fontManager.ttflist}]
if _KO:
    plt.rcParams["font.family"] = _KO[0]
plt.rcParams["axes.unicode_minus"] = False
TEXT, MUTED, GRID, SURFACE = "#0b0b0b", "#52514e", "#e4e3df", "#fcfcfb"
BLUE, ORANGE, GREEN, GRAY, RED = "#2a78d6", "#eb6834", "#1baf7a", "#9a9892", "#e34948"
OUT = Path("reports/figures_summary"); OUT.mkdir(parents=True, exist_ok=True)


def style(ax, title=""):
    ax.set_facecolor(SURFACE); ax.set_title(title, color=TEXT, fontsize=11, loc="left", pad=10)
    ax.grid(color=GRID, linewidth=0.6); ax.tick_params(colors=MUTED, labelsize=9)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color(GRID)


def latest(prefix):
    return sorted(glob.glob(f"reports/{prefix}_*"))[-1]


def fig1_pipeline():
    steps = [("입력 15개\n나이·성별·BMI·허리·음주·운동\n가족력·당뇨·공복혈당·심박수", BLUE), ("행 검증\n필수 결측·범위 밖·\n대치 5개 이상 → 예측 불가", GRAY),
             ("결측 채우기\n음주 0, 활동 0분, 가족력 0,\n혈당 93, 심박 68, 허리 회귀", GRAY), ("표준화·추가 데이터\n문헌 기준값 편차,\n나이×·성별× → 42열", GRAY),
             ("LightGBM 다중분류\n4단계 확률", BLUE), ("출력\n단계(최대 확률)\n+ 확률 4개 + 기여 요인 3개", GREEN)]
    fig, ax = plt.subplots(figsize=(15, 3.6), facecolor=SURFACE); ax.set_xlim(0, 15); ax.set_ylim(0, 3.6); ax.axis("off")
    for i, (txt, c) in enumerate(steps):
        x = 0.3 + i * 2.45
        ax.add_patch(FancyBboxPatch((x, 0.8), 2.1, 2.0, boxstyle="round,pad=0.05,rounding_size=0.15", fc="white", ec=c, lw=2))
        ax.text(x + 1.05, 1.8, txt, ha="center", va="center", fontsize=9.5, color=TEXT, linespacing=1.5)
        if i < len(steps) - 1:
            ax.annotate("", xy=(x + 2.45, 1.8), xytext=(x + 2.1, 1.8), arrowprops=dict(arrowstyle="->", color=MUTED, lw=1.5))
    ax.text(0.3, 3.3, "최종 모델 M1-F: 혈압을 재지 않은 사람의 정보 → 혈압 4단계", fontsize=12, color=TEXT, weight="bold")
    ax.text(0.3, 0.35, "혈압은 입력에 쓰지 않음 · 단건 추론 p95 3.1 ms · 단건 경로 = 배치 경로 검증", fontsize=9, color=MUTED)
    fig.savefig(OUT / "01_최종모델_흐름.png", dpi=150, bbox_inches="tight"); plt.close(fig)


def fig2_attempts():
    rows = []
    def add(path, sheet, name_col, acc_col, auroc_col, label_map=None, skip=()):
        t = pd.read_excel(path, sheet_name=sheet)
        for _, r in t.iterrows():
            n = str(r[name_col])
            if n in skip:
                continue
            rows.append({"name": (label_map or {}).get(n, n), "acc": float(r[acc_col]), "auroc": float(r[auroc_col])})
    b1 = latest("boost"); b2 = latest("boost2"); b3 = latest("boost3"); mx = latest("maxsearch")
    add(f"{b1}/results.xlsx", "교차검증", "candidate", "argmax_mean", "AUROC_140_90_mean", {"chain_lgbm": "체인 LightGBM(회귀→분포)", "mc_mid": "다중분류 LightGBM ★최종", "mc_mid_recency": "다중분류+최근연도 가중", "ensemble": "체인+다중분류 앙상블"})
    add(f"{mx}/results.xlsx", "교차검증", "name", "acc_mean", "auroc_140_mean", {"B_전열+연도|cat#33": "CatBoost(전열+연도)", "B_전열+연도|lgbm#14": "LightGBM 탐색 최적(전열+연도)", "B_전열+연도|lgbm#23": "LightGBM 탐색 2위"}, skip=("baseline_mc_mid",))
    add(f"{b2}/results.xlsx", "요약", "candidate", "acc_mean", "auroc_140_mean", {"bag5": "시드 배깅 5", "bag5+stack_reg": "배깅+회귀값 스태킹", "stack_reg": "회귀값 스태킹", "self_train": "테스트 입력 자기학습", "two_axis": "두 축 이진 합성", "per_age": "나이대별 모델"}, skip=("baseline_mc_mid",))
    add(f"{b3}/results.xlsx", "요약", "candidate", "acc_mean", "auroc_140_mean", {"soft_label_5": "소프트 라벨 σ5", "soft_label_3": "소프트 라벨 σ3", "soft_label_8": "소프트 라벨 σ8", "jitter": "입력 잡음 증강", "dart": "dart 부스팅", "extra_trees": "extra_trees", "hier": "계층 분류(normal→3단계)", "id_prefix(진단)": "ID 접두 문자(진단용)"}, skip=("baseline_mc_mid", "train_25%", "train_50%", "train_75%"))
    t = pd.DataFrame(rows).drop_duplicates("name").sort_values("acc")
    fig, axes = plt.subplots(1, 2, figsize=(15, 7.2), facecolor=SURFACE)
    for ax, col, title, base, lo, hi in ((axes[0], "acc", "4단계 정확도 (5겹 교차검증)", 0.51, 0.50, 0.53), (axes[1], "auroc", "AUROC ≥140/90 (5겹 교차검증)", None, 0.70, 0.745)):
        colors = [GREEN if "★" in n else (GRAY if "진단" in n else (RED if any(k in n for k in ("두 축", "나이대별", "계층", "dart")) else BLUE)) for n in t["name"]]
        ax.barh(t["name"], t[col], color=colors, edgecolor=SURFACE)
        for i, v in enumerate(t[col]):
            ax.text(v, i, f" {v:.3f}", va="center", fontsize=8, color=MUTED)
        if base:
            ax.axvline(base, color=GRAY, ls="--", lw=1.2); ax.text(base, -0.9, " 전부 normal 기준선 0.51", color=GRAY, fontsize=8, va="top", bbox=dict(fc="white", ec="none", pad=1))
            ax.axvline(0.52, color=ORANGE, ls=":", lw=1.2); ax.text(0.52, -0.9, " 기대 상한 0.52", color=ORANGE, fontsize=8, va="top", bbox=dict(fc="white", ec="none", pad=1))
            ax.set_ylim(-1.6, len(t) - 0.4)
        ax.set_xlim(lo, hi); style(ax, title)
    fig.suptitle("시도한 방법들이 모두 같은 자리에 수렴 (초록 = 최종 모델, 빨강 = 악화, 회색 = 진단용)", color=TEXT, fontsize=12, x=0.01, ha="left")
    fig.tight_layout(); fig.savefig(OUT / "02_시도별_성능.png", dpi=150, bbox_inches="tight"); plt.close(fig)


def fig3_user_scores():
    names = ["체인 lgbm 기준(10/25)", "편차z lgbm(이전 최고)", "계수배수 ×3", "나이 제외", "LDA", "최종 M1-F(10/26)"]
    acc = [0.5134, 0.5147, 0.5053, 0.5047, 0.5120, 0.520]; auroc = [0.7199, 0.7209, 0.7073, 0.6974, 0.7112, 0.730]
    fig, axes = plt.subplots(1, 2, figsize=(13, 4.2), facecolor=SURFACE)
    for ax, v, title, base, lo, hi in ((axes[0], acc, "정확도 (사용자 테스트 파일 채점)", 0.491, 0.48, 0.53), (axes[1], auroc, "AUROC ≥140/90 (사용자 테스트 파일 채점)", None, 0.68, 0.74)):
        colors = [GREEN if "최종" in n else BLUE for n in names]
        ax.bar(names, v, color=colors, edgecolor=SURFACE)
        for i, x in enumerate(v):
            ax.text(i, x, f"{x:.3f}", ha="center", va="bottom", fontsize=9, color=TEXT)
        if base:
            ax.axhline(base, color=GRAY, ls="--", lw=1.2); ax.text(len(names) - 0.5, base, "전부 normal 0.491 ", color=GRAY, fontsize=8, va="bottom", ha="right")
        ax.set_ylim(lo, hi); ax.tick_params(axis="x", rotation=20); style(ax, title)
    fig.tight_layout(); fig.savefig(OUT / "03_사용자채점_비교.png", dpi=150, bbox_inches="tight"); plt.close(fig)


def fig4_influence(d: pd.DataFrame, y: np.ndarray):
    """순열 중요도: 시간 분할로 학습한 최종 설정 모델에서 기준 변수 하나를 뒤섞었을 때(파생·상호작용 포함 재계산) 테스트 로그손실·정확도 변화."""
    from m1.splits import make_splits
    from sklearn.metrics import log_loss
    splits, _ = make_splits(y, d["exam_year"], seed=42); tr, va, te = splits["train"], splits["val"], splits["test"]
    trva = np.sort(np.concatenate([tr, va])); m = FinalStageModel(42).fit(d.iloc[trva], val_mask=np.isin(trva, va))
    dte = d.iloc[te].reset_index(drop=True); yte = y[te]
    def score(df):
        X, keep, _ = m.pre.transform(df); P = m.model.predict_proba(m.feats.transform(X))
        return log_loss(yte[keep], P, labels=[0, 1, 2, 3]), float((P.argmax(1) == yte[keep]).mean())
    base_ll, base_acc = score(dte); rng = np.random.default_rng(0); rows = []
    for c in m.pre.columns:
        if c == "male":
            c_raw = "sex"
        elif c in ("alcohol_15plus", "activity_600plus"):
            continue
        else:
            c_raw = c
        dp = dte.copy(); dp[c_raw] = rng.permutation(dp[c_raw].to_numpy())
        ll, acc = score(dp); rows.append({"col": c, "Δlogloss": ll - base_ll, "Δacc": base_acc - acc})
    t = pd.DataFrame(rows).sort_values("Δlogloss")
    fig, axes = plt.subplots(1, 2, figsize=(14, 6), facecolor=SURFACE)
    for ax, col, title in ((axes[0], "Δlogloss", "뒤섞었을 때 로그손실 증가 (클수록 모델이 많이 의존)"), (axes[1], "Δacc", "뒤섞었을 때 정확도 감소")):
        ax.barh(t["col"], t[col], color=[GREEN if c == "age" else BLUE for c in t["col"]], edgecolor=SURFACE)
        for i, v in enumerate(t[col]):
            ax.text(max(v, 0), i, f" {v:.3f}", va="center", fontsize=8, color=MUTED)
        style(ax, title)
    fig.suptitle("변수별 영향력 (최종 모델 설정, 시간 분할 테스트, 순열 중요도): 나이가 압도적이고 음주·운동 계열은 거의 0", color=TEXT, fontsize=11, x=0.01, ha="left")
    fig.tight_layout(); fig.savefig(OUT / "04_변수별_영향력.png", dpi=150, bbox_inches="tight"); plt.close(fig)


def fig5_age_groups():
    sub = pd.read_excel(f"{latest('final')}/results.xlsx", sheet_name="하위군")
    sub["label"] = sub["sex"].map({"female": "여", "male": "남"}) + " " + sub["age_group"]
    x = np.arange(len(sub)); w = 0.38
    fig, axes = plt.subplots(1, 2, figsize=(13, 4.4), facecolor=SURFACE)
    ax = axes[0]; ax.bar(x - w / 2, sub["accuracy"], w, color=GREEN, label="최종 모델 정확도"); ax.bar(x + w / 2, sub["baseline_all_normal"], w, color=GRAY, label="전부 normal 기준선")
    ax.set_xticks(x, sub["label"]); ax.legend(frameon=False, fontsize=9); style(ax, "나이대·성별별 정확도 vs 기준선 (시간 분할 테스트)")
    for i, (a, b) in enumerate(zip(sub["accuracy"], sub["baseline_all_normal"])):
        ax.text(i - w / 2, a, f"{a:.2f}", ha="center", va="bottom", fontsize=8); ax.text(i + w / 2, b, f"{b:.2f}", ha="center", va="bottom", fontsize=8, color=MUTED)
    ax = axes[1]; ax.bar(x, sub["auroc_140_90"], color=BLUE); ax.set_xticks(x, sub["label"]); ax.axhline(0.5, color=GRAY, ls="--", lw=1); ax.set_ylim(0.45, 0.85)
    for i, v in enumerate(sub["auroc_140_90"]):
        ax.text(i, v, f"{v:.2f}", ha="center", va="bottom", fontsize=8)
    style(ax, "나이대·성별별 AUROC ≥140/90 (젊을수록 높고 60세 이상은 0.56~0.58)")
    fig.tight_layout(); fig.savefig(OUT / "05_나이대별_정확도.png", dpi=150, bbox_inches="tight"); plt.close(fig)


def fig6_confusion():
    cm = pd.read_excel(f"{latest('final')}/results.xlsx", sheet_name="혼동행렬").set_index("actual")
    M = cm.to_numpy(float); R = M / M.sum(axis=1, keepdims=True)
    fig, ax = plt.subplots(figsize=(7.5, 6), facecolor=SURFACE)
    im = ax.imshow(R, cmap="Blues", vmin=0, vmax=1)
    ax.set_xticks(range(4), [c.replace("pred_", "") for c in cm.columns]); ax.set_yticks(range(4), [i.replace("actual_", "") for i in cm.index])
    for i in range(4):
        for j in range(4):
            ax.text(j, i, f"{int(M[i, j]):,}\n({R[i, j]:.0%})", ha="center", va="center", fontsize=9, color="white" if R[i, j] > 0.5 else TEXT)
    ax.set_xlabel("모델이 찍은 단계", color=MUTED); ax.set_ylabel("실제 단계", color=MUTED)
    ax.set_title("혼동행렬 (시간 분할 테스트 6,854행): elevated는 거의 예측되지 않고, htn은 22%만 잡음", color=TEXT, fontsize=10, loc="left")
    fig.colorbar(im, ax=ax, fraction=0.045, label="행 비율")
    fig.tight_layout(); fig.savefig(OUT / "06_혼동행렬.png", dpi=150, bbox_inches="tight"); plt.close(fig)


def fig7_bp_by_age(d: pd.DataFrame):
    band = pd.cut(d["age"], [19, 30, 40, 50, 60, 70, 200], right=False, labels=["19~29", "30~39", "40~49", "50~59", "60~69", "70+"])
    g = d.groupby([band, "sex"], observed=True)[["sbp", "dbp"]].mean().reset_index()
    fig, axes = plt.subplots(1, 2, figsize=(13, 4.4), facecolor=SURFACE)
    for ax, col, title in ((axes[0], "sbp", "수축기 혈압 평균: 나이와 함께 계속 상승"), (axes[1], "dbp", "이완기 혈압 평균: 50대 정점 뒤 하강 (70대는 20대 수준)")):
        for sex, c in (("female", ORANGE), ("male", BLUE)):
            s = g[g.sex == sex]; ax.plot(s["age"].astype(str), s[col], marker="o", color=c, label={"female": "여", "male": "남"}[sex], lw=2)
        ax.legend(frameon=False); style(ax, title); ax.set_ylabel("mmHg", color=MUTED)
    fig.suptitle("같은 나이에서 sbp와 dbp가 반대로 움직여 단계 경계가 섞이는 이유", color=TEXT, fontsize=12, x=0.01, ha="left")
    fig.tight_layout(); fig.savefig(OUT / "07_나이별_sbp_dbp.png", dpi=150, bbox_inches="tight"); plt.close(fig)


def fig8_past_bp():
    rho = [0, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]; acc = [0.512, 0.542, 0.579, 0.594, 0.628, 0.675, 0.748]; auroc = [0.716, 0.815, 0.850, 0.875, 0.915, 0.945, 0.973]
    fig, ax = plt.subplots(figsize=(9, 5), facecolor=SURFACE)
    ax.plot(rho, acc, marker="o", color=GREEN, lw=2.2, label="4단계 정확도")
    ax2 = ax.twinx(); ax2.plot(rho, auroc, marker="s", color=BLUE, lw=1.6, ls="--", label="AUROC ≥140/90"); ax2.set_ylim(0.6, 1.0); ax2.tick_params(colors=MUTED, labelsize=9); ax2.set_ylabel("AUROC", color=BLUE)
    ax.axhline(0.6, color=RED, ls=":", lw=1.4); ax.text(0.02, 0.603, "목표 0.6", color=RED, fontsize=9)
    ax.axhline(0.51, color=GRAY, ls="--", lw=1); ax.text(0.45, 0.497, "전부 normal 기준선 0.51", color=GRAY, fontsize=9)
    for r, a in zip(rho, acc):
        ax.text(r, a - 0.016, f"{a:.3f}", ha="center", fontsize=8, color=GREEN)
    ax.set_xlabel("추가 입력 '과거 혈압'과 현재 혈압의 상관 (0 = 없음)", color=MUTED); ax.set_ylabel("정확도", color=GREEN); ax.set_ylim(0.48, 0.78)
    style(ax, "0.6에 필요한 정보: 현재 혈압과 상관 0.6 이상인 혈압 정보가 있어야 도달 (가상 실험)")
    h1, l1 = ax.get_legend_handles_labels(); h2, l2 = ax2.get_legend_handles_labels(); ax.legend(h1 + h2, l1 + l2, frameon=False, loc="upper left", bbox_to_anchor=(0, 0.93))
    fig.tight_layout(); fig.savefig(OUT / "08_과거혈압_가상실험.png", dpi=150, bbox_inches="tight"); plt.close(fig)


def fig9_learning_curve():
    t = pd.read_excel(f"{latest('boost3')}/results.xlsx", sheet_name="요약").set_index("candidate")
    pts = [(25, "train_25%"), (50, "train_50%"), (75, "train_75%"), (100, "baseline_mc_mid")]
    x = [p for p, _ in pts]; y = [float(t.loc[n, "acc_mean"]) for _, n in pts]; e = [float(t.loc[n, "acc_std"]) for _, n in pts]
    fig, ax = plt.subplots(figsize=(8, 4.6), facecolor=SURFACE)
    ax.errorbar(x, y, yerr=e, marker="o", color=BLUE, lw=2, capsize=4)
    for a, b in zip(x, y):
        ax.text(a, b + 0.002, f"{b:.3f}", ha="center", fontsize=9)
    ax.axhline(0.6, color=RED, ls=":", lw=1.2); ax.text(26, 0.602, "목표 0.6", color=RED, fontsize=9)
    ax.set_xlabel("학습 행 비율 (%)", color=MUTED); ax.set_ylabel("정확도 (5겹 교차검증)", color=MUTED); ax.set_ylim(0.49, 0.62); ax.set_xticks([25, 50, 75, 100])
    style(ax, "학습 곡선: 데이터를 늘려도 기울기가 완만함 (25%→100%에서 +0.006)")
    fig.tight_layout(); fig.savefig(OUT / "09_학습곡선.png", dpi=150, bbox_inches="tight"); plt.close(fig)


def main():
    raw, _ = load_frame("train/"); d = ChainPreprocessor.coerce(raw)
    keep = (ChainPreprocessor().reasons(d) == "").to_numpy() & d[["sbp", "dbp"]].notna().all(axis=1).to_numpy(); d = d[keep].reset_index(drop=True)
    y = stage_from_bp(d["sbp"].to_numpy(float), d["dbp"].to_numpy(float))
    fig1_pipeline(); fig2_attempts(); fig3_user_scores(); fig4_influence(d, y); fig5_age_groups(); fig6_confusion(); fig7_bp_by_age(d); fig8_past_bp(); fig9_learning_curve()
    print("완료:", sorted(p.name for p in OUT.glob("*.png")))


if __name__ == "__main__":
    main()
