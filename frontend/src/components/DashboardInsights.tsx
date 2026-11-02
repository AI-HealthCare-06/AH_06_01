import { useState } from "react";
import { dashboardInsights, mean } from "../domain/dashboard-insights";
import type { GameState } from "../domain/game";
import type { HealthPeriod } from "../services/health-history";
import { useDietStore } from "../stores/diet-store";
import { SurveyHelp } from "./SurveyControls";

const format = (v: number | null, digits = 0) =>
  v === null
    ? "—"
    : v.toLocaleString("ko-KR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
type Props = { game: GameState; period: HealthPeriod; date: string; from?: string };
export function DashboardMetricGrid({ game, period, date, from }: Props) {
  const meals = useDietStore((s) => s.records),
    data = dashboardInsights(game, meals, period, date, from);
  const pressureRows = data.rows.filter((r) => r.systolic !== null && r.diastolic !== null);
  const list = [
    {
      name: "평균 혈압",
      value: `${format(mean(pressureRows.map((r) => r.systolic)))} / ${format(mean(pressureRows.map((r) => r.diastolic)))}`,
      unit: "mmHg",
      days: pressureRows.length,
    },
    {
      name: "공복 혈당",
      value: format(mean(data.rows.map((r) => r.glucose))),
      unit: "mg/dL",
      days: data.rows.filter((r) => r.glucose !== null).length,
    },
    {
      name: "안정 시 맥박",
      value: format(mean(data.rows.map((r) => r.pulse))),
      unit: "회/분",
      days: data.rows.filter((r) => r.pulse !== null).length,
    },
    {
      name: "평균 수면",
      value: format(mean(data.rows.map((r) => r.sleep)), 1),
      unit: "시간",
      days: data.rows.filter((r) => r.sleep !== null).length,
    },
    {
      name: "평균 걸음",
      value: format(mean(data.rows.map((r) => r.steps))),
      unit: "보",
      days: data.rows.filter((r) => r.steps !== null).length,
    },
    {
      name: "건강 서베이",
      value: String(data.rows.filter((r) => r.survey).length),
      unit: `/ ${data.dayCount}일`,
      days: null,
    },
  ];
  return (
    <section className="dashboard-metric-grid" aria-label="선택 기간 핵심 지표">
      {list.map((item) => (
        <article key={item.name}>
          <h3>{item.name}</h3>
          <strong>
            {item.value}
            <small>{item.unit}</small>
          </strong>
          <span>{item.days === null ? "선택 기간 제출 일수" : `기록 ${item.days}일 평균`}</span>
        </article>
      ))}
    </section>
  );
}
export function DashboardInsightCharts(props: Props) {
  const meals = useDietStore((s) => s.records),
    data = dashboardInsights(props.game, meals, props.period, props.date, props.from);
  const [focused, setFocused] = useState<string | null>(null);
  const activeFocus =
    focused && focused >= data.range.start && focused <= data.range.end ? focused : null;
  const displayDate = activeFocus ?? data.rows.at(-1)?.date;
  const selected = data.rows.find((r) => r.date === displayDate);
  const sleepRows = data.rows.filter((r) => r.bedtime && r.wakeTime && r.sleep !== null).slice(-7);
  const clockPosition = (clock: string) => {
    const minutes = Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
    return ((minutes + 240) % 1440) / 60;
  };
  return (
    <>
      {!!data.comparison.length && (
        <section className="quarter-comparison cream-card" aria-label="초반과 최근 기록 비교">
          <header className="insight-heading">
            <h3>기록이 쌓이며 달라진 수치</h3>
            <SurveyHelp
              label="기간 비교"
              text="선택 기간의 처음 30일과 마지막 30일 기록 평균이에요. 합성 데모의 변화는 치료 효과나 미래 예측이 아니에요."
            />
          </header>
          <div>
            {data.comparison.map((block) => (
              <article key={block.label}>
                <h4>{block.label}</h4>
                <small>
                  {block.start.slice(5)} ~ {block.end.slice(5)}
                </small>
                <dl>
                  <div>
                    <dt>혈압</dt>
                    <dd>
                      {format(block.systolic)} / {format(block.diastolic)}
                      <small>mmHg</small>
                    </dd>
                  </div>
                  <div>
                    <dt>수면</dt>
                    <dd>
                      {format(block.sleep, 1)}
                      <small>시간</small>
                    </dd>
                  </div>
                  <div>
                    <dt>걸음</dt>
                    <dd>
                      {format(block.steps)}
                      <small>보</small>
                    </dd>
                  </div>
                </dl>
                <small>기록 {block.days}일</small>
              </article>
            ))}
          </div>
        </section>
      )}
      <section className="habit-calendar cream-card" aria-label="퀘스트 실천 캘린더">
        <header className="insight-heading">
          <div>
            <h3>매일 쌓은 건강 습관</h3>
            <small>
              {data.heatmap[0]?.date} ~ {props.date}
              {data.dayCount > 90 ? " · 최근 90일" : ""}
            </small>
          </div>
          <span className="pixel-tag">메인 퀘스트</span>
        </header>
        <div className="habit-grid" data-no-swipe>
          {data.heatmap.map(({ date, row }) => (
            <button
              type="button"
              key={date}
              data-level={row?.completed ?? "missing"}
              aria-label={`${date} ${row?.completed === null || !row ? "기록 없음" : `${row.completed} / ${data.mainQuestCount}개 완료`}`}
              aria-pressed={displayDate === date}
              onClick={() => setFocused(date)}
              title={date}
            >
              {Number(date.slice(-2))}
            </button>
          ))}
        </div>
        <div className="habit-legend">
          <span>기록 없음</span>
          {[0, 1, 2, 3, 4].map((n) => (
            <i key={n} data-level={n} aria-label={`${n}개 완료`} />
          ))}
          <span>4개 완료</span>
        </div>
        <p className="habit-day" aria-live="polite">
          {activeFocus && !data.rows.some((r) => r.date === activeFocus)
            ? `${activeFocus} · 기록 없음`
            : selected
              ? `${selected.date} · ${selected.completed ?? "—"}/4개 · 수면 ${format(selected.sleep, 1)}시간 · ${format(selected.steps)}보`
              : "기록을 쌓으면 실천 흐름이 보여요."}
        </p>
        <dl className="activity-records" aria-label="선택 기간 활동과 좌식 기록">
          {[
            {
              label: "활동 시간",
              values: data.rows.map((r) => r.active),
              unit: "분/일",
              digits: 0,
            },
            {
              label: "좌식 시간",
              values: data.rows.map((r) => r.sedentary),
              unit: "시간/일",
              digits: 1,
            },
          ].map(({ label, values, unit, digits }) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                {format(mean(values), digits)} <small>{unit}</small>
              </dd>
              <small>기록 {values.filter((v) => v !== null).length}일 평균</small>
            </div>
          ))}
        </dl>
      </section>
      <section className="sleep-rhythm cream-card" aria-label="수면 리듬">
        <header className="insight-heading">
          <div>
            <h3>나의 취침·기상 리듬</h3>
            <small>선택 기간 중 최근 {sleepRows.length}일</small>
          </div>
          <span className="pixel-tag">시각 기록</span>
        </header>
        {sleepRows.length ? (
          <>
            <div className="sleep-axis">
              <span>20시</span>
              <span>02시</span>
              <span>08시</span>
              <span>14시</span>
              <span>20시</span>
            </div>
            {sleepRows.map((row) => (
              <div className="sleep-rhythm-row" key={row.date}>
                <small>{row.date.slice(5).replace("-", ".")}</small>
                <div
                  role="img"
                  aria-label={`${row.date} ${row.bedtime} 취침 ${row.wakeTime} 기상 ${format(row.sleep, 1)}시간`}
                >
                  <i
                    style={{
                      left: `${(clockPosition(row.bedtime!) / 24) * 100}%`,
                      width: `${(Math.min(row.sleep!, 24 - clockPosition(row.bedtime!)) / 24) * 100}%`,
                    }}
                  />
                  {clockPosition(row.bedtime!) + row.sleep! > 24 && (
                    <i
                      style={{
                        left: 0,
                        width: `${((clockPosition(row.bedtime!) + row.sleep! - 24) / 24) * 100}%`,
                      }}
                    />
                  )}
                </div>
                <b>{format(row.sleep, 1)}h</b>
              </div>
            ))}
            <p>
              평균 수면 {format(mean(sleepRows.map((r) => r.sleep)), 1)}시간 ·{" "}
              {sleepRows.at(-1)?.bedtime} → {sleepRows.at(-1)?.wakeTime}
            </p>
          </>
        ) : (
          <p>취침·기상 시각을 기록하면 리듬을 보여드려요.</p>
        )}
      </section>
      <section className="nutrition-overview cream-card" aria-label="식단 영양 구성">
        <header className="insight-heading">
          <div>
            <h3>기록한 식사의 영양 구성</h3>
            <small>
              {data.nutrition.days}일 · {data.nutrition.meals}끼 기록
            </small>
          </div>
          <SurveyHelp
            label="식단 집계"
            text="저장된 영양 스냅샷만 집계해요. 한 끼 평균이며 하루 전체 섭취량은 아니에요. 비중은 탄수화물·단백질 4kcal/g, 지방 9kcal/g으로 환산하며 세 값이 모두 있는 식사만 사용해요."
          />
        </header>
        <div className="nutrition-values">
          <div>
            <small>한 끼 평균 열량</small>
            <strong>
              {format(data.nutrition.energy)}
              <small>kcal</small>
            </strong>
            <small>{data.nutrition.energyMeals}끼 기준</small>
          </div>
          <div>
            <small>한 끼 평균 나트륨</small>
            <strong>
              {format(data.nutrition.sodium)}
              <small>mg</small>
            </strong>
            <small>{data.nutrition.sodiumMeals}끼 기준</small>
          </div>
        </div>
        {data.nutrition.macroMeals ? (
          <>
            <div
              className="macro-track"
              role="img"
              aria-label={data.nutrition.macroShares
                .map(
                  (v, i) =>
                    `${["탄수화물", "단백질", "지방"][i]} ${format(v === null ? null : v * 100)}%`,
                )
                .join(", ")}
            >
              {data.nutrition.macroShares.map((value, i) => (
                <i key={i} className={`macro-${i}`} style={{ width: `${(value ?? 0) * 100}%` }} />
              ))}
            </div>
            <div className="macro-legend">
              {data.nutrition.macroShares.map((value, i) => (
                <span key={i}>
                  <i className={`macro-${i}`} />
                  {["탄수화물", "단백질", "지방"][i]} {format(value === null ? null : value * 100)}%
                </span>
              ))}
            </div>
            <small>탄·단·지 환산 비중 · {data.nutrition.macroMeals}끼 기준</small>
          </>
        ) : (
          <p>식단 영양 기록이 아직 없어요.</p>
        )}
      </section>
      <details className="dashboard-records cream-card">
        <summary>날짜별 기록 자세히 보기 · {data.rows.length}일</summary>
        <div className="record-table-scroll" data-no-swipe>
          <table>
            <caption>선택 기간의 저장된 기록</caption>
            <thead>
              <tr>
                <th>날짜</th>
                <th>
                  혈압
                  <br />
                  mmHg
                </th>
                <th>
                  혈당
                  <br />
                  mg/dL
                </th>
                <th>
                  수면
                  <br />
                  시간
                </th>
                <th>
                  걸음
                  <br />보
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.date}>
                  <th>{row.date.slice(5)}</th>
                  <td>
                    {format(row.systolic)}/{format(row.diastolic)}
                  </td>
                  <td>{format(row.glucose)}</td>
                  <td>{format(row.sleep, 1)}</td>
                  <td>{format(row.steps)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
