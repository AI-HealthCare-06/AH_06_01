"""
[파일] age_profile.py
[용도] 나이대별 데이터 요약과 변수별 혈압 영향. 학습 데이터(범위·결측 검증 통과 행)를 10세 나이대로 나눠 BMI·허리둘레·음주·운동·휴식(수면 6시간 미만 여부, 안정시 심박수)을
      요약하고, 각 변수가 측정 혈압(sbp/dbp)과 얼마나 함께 움직이는지를 Spearman 상관, 변수 1단위당 혈압 변화(연령·성별 보정 OLS 기울기), 구간별 평균 혈압(연령·성별 보정 포함),
      나이대×구간별 평균 혈압으로 계산한다. 결과는 reports/age_profile_<시각>/ 에 엑셀(시트 6개)·그림 2장·summary.md. 학습은 하지 않고 모델도 쓰지 않는다.
[왜 필요한가] 사용자 요청(2026-10-23, 멘토링 후 데이터 분석): 나이대별로 생활·신체 변수를 정리하고 각 변수가 혈압에 얼마나 영향을 주는지 데이터로 보기 위해.
[주의] 데이터에 수면 시간 원값은 없고 sleep_short_flag(6시간 미만 여부)만 있다. 상관·기울기는 단면 자료의 연관이며 인과가 아니다. 복약 컬럼이 없어 약으로 조절된 혈압이 섞여 있다.
[쓰는 곳] 사용자가 직접 실행: python3 age_profile.py --data train/ --assume-no-med
"""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib import font_manager  # noqa: E402

# 그림 제목이 한글이라 한글 글꼴을 지정한다(없으면 기본 글꼴, 한글이 □ 로 나온다).
_KO_FONTS = [f for f in ("Apple SD Gothic Neo", "AppleGothic", "NanumGothic", "Malgun Gothic") if f in {x.name for x in font_manager.fontManager.ttflist}]
if _KO_FONTS:
    plt.rcParams["font.family"] = _KO_FONTS[0]
plt.rcParams["axes.unicode_minus"] = False
import pandas as pd  # noqa: E402
from openpyxl.styles import Alignment  # noqa: E402

import thresholds as T  # noqa: E402
from analysis_pack import style  # noqa: E402
from m1.contract import Contract  # noqa: E402
from m1.features import VALID_STATUSES, Preprocessor  # noqa: E402
from m1.pipeline import load_labeled  # noqa: E402
from m1.report import md_table  # noqa: E402

AGE_EDGES = [19, 30, 40, 50, 60, 70, 81]
AGE_LABELS = ["19~29", "30~39", "40~49", "50~59", "60~69", "70+"]
INF = np.inf
# 변수별 구간. right=False([a, b)). 0 을 따로 두는 변수는 두 번째 경계를 0.001 로 둔다. unit = '실용 단위'(기울기 환산용).
VARS = {
    "bmi": dict(label="BMI (kg/m²)", edges=[-INF, 18.5, 23, 25, 30, INF], names=["<18.5", "18.5~23", "23~25", "25~30", "30+"], unit=1.0, unit_label="1 kg/m²"),
    "waist_cm": dict(label="허리둘레 (cm)", edges=[-INF, 80, 85, 90, 95, INF], names=["<80", "80~85", "85~90", "90~95", "95+"], unit=5.0, unit_label="5 cm"),
    "alcohol_week": dict(label="음주 (잔/주)", edges=[-INF, 0.001, 7, 15, INF], names=["0", "0~7", "7~15", "15+"], unit=7.0, unit_label="7잔/주"),
    "activity_minutes_week": dict(label="운동 (분/주)", edges=[-INF, 0.001, 150, 300, 600, INF], names=["0", "0~150", "150~300", "300~600", "600+"], unit=100.0, unit_label="100분/주"),
    "resting_hr": dict(label="안정시 심박수 (bpm)", edges=[-INF, 60, 70, 80, 90, INF], names=["<60", "60~70", "70~80", "80~90", "90+"], unit=10.0, unit_label="10 bpm"),
    "sleep_short_flag": dict(label="수면 6시간 미만", edges=[-0.5, 0.5, 1.5], names=["아니오(≥6h)", "예(<6h)"], unit=1.0, unit_label="예 vs 아니오"),
}
BP = {"__sbp": "sbp", "__dbp": "dbp"}
SEX_COLORS = {"female": "#eb6834", "male": "#2a78d6"}
AGE_COLORS = ["#b9d3f3", "#86b6ef", "#5598e7", "#2a78d6", "#1f5fae", "#143f78"]
TEXT, MUTED, GRID, SURFACE = "#0b0b0b", "#52514e", "#e4e3df", "#fcfcfb"


def _style(ax, title: str) -> None:
    ax.set_facecolor(SURFACE)
    ax.set_title(title, color=TEXT, fontsize=9.5)
    ax.grid(color=GRID, linewidth=0.6)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color(GRID)
    ax.tick_params(colors=MUTED, labelsize=8)


def ols(y: np.ndarray, X: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """최소제곱 계수와 표준오차. X 는 절편 열을 포함."""
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    resid = y - X @ beta
    dof = max(len(y) - X.shape[1], 1)
    cov = (resid @ resid / dof) * np.linalg.pinv(X.T @ X)
    return beta, np.sqrt(np.diag(cov))


def covariates(d: pd.DataFrame) -> np.ndarray:
    age, male = d["age"].to_numpy(float), d["male"].to_numpy(float)
    return np.column_stack([np.ones(len(d)), age, male, age * male])


def load(data: str, assume_no_med: bool, max_rows: int | None) -> pd.DataFrame:
    contract = Contract.load()
    spec, y, _, _ = load_labeled(data, contract, max_rows=max_rows, assume_no_med=assume_no_med)
    res = Preprocessor(contract).fit(spec).transform(spec)
    df = spec[res.status.isin(VALID_STATUSES).to_numpy()].reset_index(drop=True).copy()
    df["stage_index"] = y[res.status.isin(VALID_STATUSES).to_numpy()]
    df["male"] = (df["sex"] == "male").astype(float)
    df["age_group"] = pd.cut(df["age"], AGE_EDGES, right=False, labels=AGE_LABELS)
    for c in VARS:
        df[c] = pd.to_numeric(df[c], errors="coerce").astype(float)
    df["sbp"], df["dbp"] = df["__sbp"].astype(float), df["__dbp"].astype(float)
    df["ge_130_80"] = ((df["sbp"] >= T.SBP_PREHTN_MIN) | (df["dbp"] >= T.DBP_PREHTN_MIN)).astype(float)
    df["htn"] = (df["stage_index"] == 3).astype(float)
    df["waist_high"] = np.where(df["male"] == 1, df["waist_cm"] >= T.WAIST_HIGH_CM["male"], df["waist_cm"] >= T.WAIST_HIGH_CM["female"]).astype(float)
    df.loc[df["waist_cm"].isna(), "waist_high"] = np.nan
    return df


def age_summary(df: pd.DataFrame, by: list[str]) -> pd.DataFrame:
    g = df.groupby(by, observed=True)
    out = pd.DataFrame({
        "n": g.size(), "여성 비율": g["male"].apply(lambda s: 1 - s.mean()),
        "BMI 평균": g["bmi"].mean(), "BMI 중앙값": g["bmi"].median(), "BMI≥23 비율": g["bmi"].apply(lambda s: (s >= 23).mean()), "BMI≥25 비율": g["bmi"].apply(lambda s: (s >= 25).mean()),
        "허리둘레 평균": g["waist_cm"].mean(), "허리둘레 높음 비율(남90/여85)": g["waist_high"].mean(),
        "음주 평균(잔/주)": g["alcohol_week"].mean(), "음주자 비율": g["alcohol_week"].apply(lambda s: (s > 0).mean()), "음주자 평균(잔/주)": g["alcohol_week"].apply(lambda s: s[s > 0].mean()), "15잔+ 비율": g["alcohol_week"].apply(lambda s: (s >= 15).mean()),
        "운동 중앙값(분/주)": g["activity_minutes_week"].median(), "운동 평균(분/주)": g["activity_minutes_week"].mean(), "운동 <150분 비율": g["activity_minutes_week"].apply(lambda s: (s < 150).mean()), "운동 0분 비율": g["activity_minutes_week"].apply(lambda s: (s == 0).mean()),
        "심박수 평균(bpm)": g["resting_hr"].mean(), "수면 6h 미만 비율": g["sleep_short_flag"].mean(),
        "sbp 평균": g["sbp"].mean(), "dbp 평균": g["dbp"].mean(), "≥130/80 비율": g["ge_130_80"].mean(), "htn 비율": g["htn"].mean(),
    })
    return out.reset_index()


def with_total(df: pd.DataFrame, by: list[str]) -> pd.DataFrame:
    t = age_summary(df, by)
    tot = age_summary(df.assign(**{by[0]: "전체"}), by)
    return pd.concat([t, tot], ignore_index=True)


def influence(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """변수별 요약(상관·기울기), 구간별 혈압, 나이대×구간별 혈압."""
    rows, bins_rows, age_rows = [], [], []
    for var, spec in VARS.items():
        d = df.dropna(subset=[var, "sbp", "dbp", "age"])
        x = d[var].to_numpy(float)
        rec = {"변수": spec["label"], "n": len(d), "단위": spec["unit_label"]}
        Xc = covariates(d)
        for bp in ("sbp", "dbp"):
            yv = d[bp].to_numpy(float)
            rec[f"Spearman({bp})"] = d[[var, bp]].corr(method="spearman").iat[0, 1]
            b0, se0 = ols(yv, np.column_stack([np.ones(len(d)), x]))
            b1, se1 = ols(yv, np.column_stack([Xc, x]))
            rec[f"{bp} 기울기/단위 (보정 전)"] = b0[1] * spec["unit"]
            rec[f"{bp} 기울기/단위 (연령·성별 보정)"] = b1[-1] * spec["unit"]
            rec[f"{bp} 보정 기울기 95% CI 하한"] = (b1[-1] - 1.96 * se1[-1]) * spec["unit"]
            rec[f"{bp} 보정 기울기 95% CI 상한"] = (b1[-1] + 1.96 * se1[-1]) * spec["unit"]
        # 구간별: 원 평균 + 연령·성별 보정 평균(잔차 평균 + 전체 평균)
        cut = pd.cut(d[var], spec["edges"], right=False, labels=spec["names"])
        adj = {}
        for bp in ("sbp", "dbp", "ge_130_80"):
            yv = d[bp].to_numpy(float)
            b, _ = ols(yv, Xc)
            adj[bp] = yv - Xc @ b + yv.mean()
        dd = d.assign(구간=cut, sbp_adj=adj["sbp"], dbp_adj=adj["dbp"], ge_adj=adj["ge_130_80"])
        g = dd.groupby("구간", observed=False)
        bt = pd.DataFrame({"변수": spec["label"], "n": g.size(), "비율": g.size() / len(dd), "평균 연령": g["age"].mean(), "남성 비율": g["male"].mean(),
                           "sbp 평균": g["sbp"].mean(), "dbp 평균": g["dbp"].mean(), "≥130/80 비율": g["ge_130_80"].mean(), "htn 비율": g["htn"].mean(),
                           "sbp 평균(연령·성별 보정)": g["sbp_adj"].mean(), "dbp 평균(연령·성별 보정)": g["dbp_adj"].mean(), "≥130/80 비율(연령·성별 보정)": g["ge_adj"].mean()}).reset_index()
        bins_rows.append(bt)
        rec["sbp 구간 차(최대−최소, 보정 전)"] = bt["sbp 평균"].max() - bt["sbp 평균"].min()
        rec["sbp 구간 차(최대−최소, 보정)"] = bt["sbp 평균(연령·성별 보정)"].max() - bt["sbp 평균(연령·성별 보정)"].min()
        rec["dbp 구간 차(최대−최소, 보정)"] = bt["dbp 평균(연령·성별 보정)"].max() - bt["dbp 평균(연령·성별 보정)"].min()
        rows.append(rec)
        ga = dd.groupby(["age_group", "구간"], observed=False)
        at = pd.DataFrame({"변수": spec["label"], "n": ga.size(), "sbp 평균": ga["sbp"].mean(), "dbp 평균": ga["dbp"].mean(), "≥130/80 비율": ga["ge_130_80"].mean(), "htn 비율": ga["htn"].mean()}).reset_index()
        age_rows.append(at.rename(columns={"age_group": "나이대"}))
    return pd.DataFrame(rows), pd.concat(bins_rows, ignore_index=True), pd.concat(age_rows, ignore_index=True)


def fig_age_profile(df: pd.DataFrame, path: Path) -> None:
    panels = [("bmi", "BMI 평균", "mean"), ("waist_cm", "허리둘레 평균 (cm)", "mean"), ("alcohol_week", "음주 평균 (잔/주, 0 포함)", "mean"), ("activity_minutes_week", "운동 중앙값 (분/주)", "median"),
              ("resting_hr", "안정시 심박수 평균 (bpm)", "mean"), ("sleep_short_flag", "수면 6h 미만 비율", "mean"), ("sbp", "sbp 평균 (mmHg)", "mean"), ("dbp", "dbp 평균 (mmHg)", "mean")]
    fig, axes = plt.subplots(2, 4, figsize=(15, 6.6), facecolor=SURFACE)
    x = np.arange(len(AGE_LABELS))
    for ax, (col, title, how) in zip(axes.ravel(), panels):
        for sex, color in SEX_COLORS.items():
            g = df[df["sex"] == sex].groupby("age_group", observed=False)[col]
            y = (g.median() if how == "median" else g.mean()).reindex(AGE_LABELS)
            ax.plot(x, y, marker="o", markersize=3.5, color=color, linewidth=1.6, label=sex)
            if how == "mean" and col not in ("sleep_short_flag",):
                q1, q3 = g.quantile(0.25).reindex(AGE_LABELS), g.quantile(0.75).reindex(AGE_LABELS)
                ax.fill_between(x, q1, q3, color=color, alpha=0.10, linewidth=0)
        _style(ax, title)
        ax.set_xticks(x, AGE_LABELS)
    axes.ravel()[0].legend(frameon=False, fontsize=8)
    fig.suptitle("Age-group profile by sex (line = mean/median, band = 25–75%)", color=TEXT, fontsize=11)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


def fig_bp_by_variable(age_tab: pd.DataFrame, path: Path) -> None:
    fig, axes = plt.subplots(2, len(VARS), figsize=(3.3 * len(VARS), 6.6), facecolor=SURFACE)
    for j, (var, spec) in enumerate(VARS.items()):
        sub = age_tab[age_tab["변수"] == spec["label"]]
        for i, bp in enumerate(("sbp 평균", "dbp 평균")):
            ax = axes[i, j]
            for k, ag in enumerate(AGE_LABELS):
                s = sub[sub["나이대"] == ag].set_index("구간").reindex(spec["names"])
                ok = s["n"] >= 30
                ax.plot(np.arange(len(spec["names"]))[ok], s[bp][ok], marker="o", markersize=3, color=AGE_COLORS[k], linewidth=1.4, label=ag)
            _style(ax, f"{spec['label']} → {bp.split()[0]}" if i == 0 else f"{spec['label']} → dbp")
            ax.set_xticks(range(len(spec["names"])), spec["names"], rotation=20)
            if j == 0:
                ax.set_ylabel("mmHg (mean)", color=MUTED, fontsize=8)
    axes[0, 0].legend(frameon=False, fontsize=7, title="age", title_fontsize=7)
    fig.suptitle("Mean blood pressure by variable bin, one line per age group (bins with n<30 omitted)", color=TEXT, fontsize=11)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


def main(argv=None) -> Path:
    ap = argparse.ArgumentParser(description="나이대별 데이터 요약과 변수별 혈압 영향")
    ap.add_argument("--data", required=True)
    ap.add_argument("--max-rows", type=int, default=None)
    ap.add_argument("--assume-no-med", action="store_true")
    ap.add_argument("--out", default="reports")
    a = ap.parse_args(argv)
    df = load(a.data, a.assume_no_med, a.max_rows)
    out = Path(a.out) / f"age_profile_{datetime.now():%Y%m%d_%H%M%S}"
    out.mkdir(parents=True, exist_ok=True)

    by_age = with_total(df, ["age_group"]).rename(columns={"age_group": "나이대"})
    by_age_sex = age_summary(df, ["age_group", "sex"]).rename(columns={"age_group": "나이대", "sex": "성별"})
    infl, bins, age_bins = influence(df)
    fig_age_profile(df, out / "age_profile.png")
    fig_bp_by_variable(age_bins, out / "bp_by_variable.png")

    readme = pd.DataFrame({"시트": ["나이대별_요약", "나이대별_요약_성별", "혈압_영향_요약", "변수구간별_혈압", "나이대x구간_혈압"],
                           "내용": [f"10세 나이대(70+ 는 70~80, 80 은 상한 코딩)별 변수 요약. 행 = 범위·결측 검증 통과 {len(df):,}행(학습과 같은 규칙). 비율은 해당 나이대 안의 비율.",
                                    "같은 요약을 나이대×성별로.",
                                    "변수별 혈압 연관: Spearman 상관(sbp/dbp), 변수 1단위당 혈압 변화(mmHg) = OLS 기울기 × 실용 단위(단위 열). '보정' = 연령·성별·연령×성별을 함께 넣은 회귀. 구간 차 = 구간별 평균의 최대−최소. 단면 자료의 연관이며 인과가 아님.",
                                    "변수 구간별 평균 혈압·≥130/80 비율·htn 비율. '보정' 평균 = 연령·성별 회귀 잔차 평균 + 전체 평균(나이 구성 차이를 뺀 값). 평균 연령 열로 구간 간 나이 차이를 볼 수 있음.",
                                    "나이대×변수 구간별 평균 혈압(그림 bp_by_variable.png 의 수치). n<30 인 칸은 해석 주의."],
                           "비고": ["휴식 = 수면 6시간 미만 여부(sleep_short_flag)와 안정시 심박수. 수면 시간 원값은 데이터에 없음.", "", "복약 컬럼이 없어 약으로 조절된 혈압이 섞여 있음.", "", ""]})
    sheets = {"설명": readme, "나이대별_요약": by_age, "나이대별_요약_성별": by_age_sex, "혈압_영향_요약": infl, "변수구간별_혈압": bins, "나이대x구간_혈압": age_bins}
    xlsx = out / "age_profile.xlsx"
    with pd.ExcelWriter(xlsx, engine="openpyxl") as w:
        for name, t in sheets.items():
            t.to_excel(w, sheet_name=name, index=False)
        for name in sheets:
            style(w.book[name], nd=2, freeze="A2" if name == "설명" else "B2")
        ws = w.book["설명"]
        ws.column_dimensions["B"].width = 100
        ws.column_dimensions["C"].width = 50
        for row in ws.iter_rows(min_row=2):
            for c in row[1:]:
                c.alignment = Alignment(wrap_text=True, vertical="top")

    L = [f"# 나이대별 데이터 요약과 혈압 영향 — {out.name}\n",
         f"- 데이터 `{a.data}` 범위·결측 검증 통과 {len(df):,}행, 나이대 {AGE_LABELS[0]}~{AGE_LABELS[-1]}(10세), 휴식 = 수면 6h 미만 여부·안정시 심박수(수면 시간 원값 없음)",
         "- 파일: `age_profile.xlsx`(시트 6), `age_profile.png`(나이대×성별 프로필), `bp_by_variable.png`(변수 구간별 평균 혈압, 나이대별 선)\n",
         "## 1. 나이대별 요약\n", md_table(by_age[["나이대", "n", "여성 비율", "BMI 평균", "BMI≥25 비율", "허리둘레 평균", "허리둘레 높음 비율(남90/여85)", "음주자 비율", "15잔+ 비율", "운동 중앙값(분/주)", "운동 <150분 비율", "심박수 평균(bpm)", "수면 6h 미만 비율", "sbp 평균", "dbp 평균", "≥130/80 비율", "htn 비율"]], nd=2),
         "\n## 2. 변수별 혈압 영향 (연령·성별 보정 기울기는 '단위'당 mmHg)\n", md_table(infl[["변수", "n", "단위", "Spearman(sbp)", "Spearman(dbp)", "sbp 기울기/단위 (보정 전)", "sbp 기울기/단위 (연령·성별 보정)", "dbp 기울기/단위 (보정 전)", "dbp 기울기/단위 (연령·성별 보정)", "sbp 구간 차(최대−최소, 보정 전)", "sbp 구간 차(최대−최소, 보정)"]], nd=2),
         "\n## 3. 변수 구간별 혈압\n", md_table(bins[["변수", "구간", "n", "평균 연령", "sbp 평균", "dbp 평균", "≥130/80 비율", "sbp 평균(연령·성별 보정)", "dbp 평균(연령·성별 보정)", "≥130/80 비율(연령·성별 보정)"]], nd=2),
         "\n상관·기울기는 단면 자료의 연관이며 인과가 아니다. 복약 컬럼이 없어 약으로 조절된 혈압이 섞여 있다.\n"]
    (out / "summary.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print(f"완료: {out}/ (age_profile.xlsx 시트 {len(sheets)}개, 그림 2장, summary.md)")
    return out


if __name__ == "__main__":
    main()
