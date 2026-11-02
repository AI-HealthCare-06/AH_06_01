import { ProfileQuests } from "../components/ProfileQuests";
import { InfoDialog } from "../components/InfoDialog";
import { retailReferences, discountedRetailRp, retailPricePolicy } from "../domain/retail-pricing";
import { PixelSelect } from "../components/PixelSelect";
import { SubQuestPanel } from "../components/SubQuestPanel";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell, PageHeading } from "../components/AppShell";
import { AdventureScene } from "../components/AdventureScene";
import { DinoRadarCard } from "../components/DinoRadarCard";
import { DinosaurArt } from "../components/DinosaurArt";
import { AccessoryCatalog } from "../components/AccessoryCatalog";
import { CharacterVault } from "../components/CharacterVault";
import { RiskChange } from "../components/RiskChange";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { QuestProgress, PixelCheckbox } from "../components/QuestProgress";
import { useNotice } from "../components/NoticeProvider";
import { assets } from "../design/assets";
import { dinosaurs } from "../design/dinosaurs";
import {
  quests,
  mainQuests,
  mainQuestCount,
  questProgress,
  questProgressLabel,
} from "../domain/game";
import { useGameStore } from "../stores/game-store";
import { dashboardService } from "../services/dashboard-service";
import { weeklyCompletedDays, questCountOn } from "../domain/game";
import { PixelIcon } from "../components/PixelIcon";
import { HealthTrend } from "../components/HealthTrend";
import { healthPeriods, reportDateRange } from "../services/health-history";
import type { HealthPeriod } from "../services/health-history";
import { useProfileStore } from "../stores/profile-store";
import { GameWallet, GoldEffects } from "../components/GameWallet";
import { dailyCombatExperienceLimit, questExperience } from "../domain/experience";
import { PixelDatePicker } from "../components/PixelDatePicker";
import { BloodPressureReport } from "../components/BloodPressureReport";
import { useMedicationStore } from "../stores/medication-store";
import { dailyDoses } from "../domain/medications";
import { QuestCameraDialog } from "../components/QuestCameraDialog";
import { QuestInfoDialog } from "../components/QuestInfoDialog";
import { QuestCalendar } from "../components/QuestCalendar";
import { DashboardSummary } from "../components/DashboardSummary";
import { DashboardReportShell } from "../components/DashboardReportShell";
import { reportSelection } from "../services/health-history";
import { healthScorePeriod, scoreChangeText } from "../domain/health-score";

export function HomePage() {
  const location = useLocation();
  const { game, paused, togglePause } = useGameStore();
  const dino = dinosaurs[game.dinosaur];
  const a = assets.home;
  const { medications, taken } = useMedicationStore();
  const doses = dailyDoses(medications, game.date, taken);
  const icons = {
    medicine: a.imgQuestItem0PixelIcon,
    meal: a.imgQuestItem1PixelIcon,
    walk: a.imgQuestItem2PixelIcon,
    water: a.imgQuestItem3PixelIcon,
  };
  const homeQuests = [...mainQuests]
    .sort((a, b) => Number(game.completed.includes(a.id)) - Number(game.completed.includes(b.id)))
    .slice(0, 4);
  const doneCount = mainQuestCount(game.completed);
  const nextQuest = mainQuests.find((q) => !game.completed.includes(q.id));
  const feedbackTitle =
    game.combat.recovery > 0
      ? `${dino.name}: 잠깐 쉬어가도 괜찮아요!`
      : doneCount === mainQuests.length
        ? `${dino.name}, 오늘 모두 해냈어요!`
        : doneCount >= 3
          ? `${dino.name}, 오늘 잘하고 있어요!`
          : doneCount > 0
            ? `${dino.name}, 조금씩 성장하고 있어요!`
            : `${dino.name}, 오늘의 실천을 기다려요!`;
  const feedbackDetail =
    game.combat.recovery > 0
      ? `WAVE ${game.combat.wave} 실패 · 퀘스트로 힘을 모아 다시 도전해요.`
      : nextQuest
        ? `오늘 ${doneCount}/${mainQuests.length} 완료 · 다음 실천: ${nextQuest.title}`
        : "오늘의 메인 퀘스트를 모두 완료했어요!";
  return (
    <AppShell active="home">
      <Link to={game.completed.length ? "/buff" : "/withered"} className="dino-feedback">
        <img className="feedback-background" src={a.imgFeedbackDinoMessage} alt="" />
        <span className="feedback-wash" />
        <DinosaurArt className="feedback-portrait" pose="portrait" />
        <span className="feedback-copy">
          <strong>{feedbackTitle}</strong>
          <small>{feedbackDetail}</small>
        </span>
        <b>
          <PixelIcon name="chevron" />
        </b>
        <span className="pixel-grass" />
      </Link>
      <AdventureScene game={game} paused={paused} onTogglePause={togglePause} />
      <div className="home-panels">
        <ProfileQuests compact />
        <DinoRadarCard />
        <section className="compact-quests">
          <Link className="compact-quest-title" to="/quests">
            <img src={a.imgPixelIconIcon} alt="" />
            <h3>DAILY QUEST</h3>
            <img src={a.imgOpenChevron} alt="" />
          </Link>
          {homeQuests.map((q) => {
            const done = game.completed.includes(q.id);
            return (
              <Link
                className="compact-quest"
                data-completed={done}
                key={q.id}
                to={
                  q.id === "survey"
                    ? "/daily-survey"
                    : q.id === "medicine" && doses.length
                      ? "/medications"
                      : `/quests/${q.id}`
                }
                state={q.id === "survey" ? { surveyBackground: location } : undefined}
              >
                <PixelCheckbox checked={done} />
                {q.id === "survey" ? (
                  <PixelIcon name="document" />
                ) : q.id === "sleep" ? (
                  <PixelIcon name="moon" />
                ) : (
                  <img src={icons[q.id]} alt="" />
                )}
                <div>
                  <div className="compact-quest-heading">
                    <strong>{q.title}</strong>
                    {q.id === "medicine" && doses.length > 0 && (
                      <small>
                        {doses.filter((dose) => dose.taken).length} / {doses.length}회
                      </small>
                    )}
                    {q.id === "water" && (
                      <small>{done ? "동작 인증 완료" : "동작 인증 대기"}</small>
                    )}
                    {q.id === "walk" && <small>{Math.round(questProgress(game, q) * 100)}%</small>}
                  </div>
                  {(q.id === "walk" || q.id === "water") && (
                    <div className="compact-walk">
                      <span
                        role="progressbar"
                        aria-label={`${q.title} 진행도`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(questProgress(game, q) * 100)}
                      >
                        <i
                          className="metric-fill"
                          style={{ width: `${questProgress(game, q) * 100}%` }}
                        />
                      </span>
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </section>
      </div>
    </AppShell>
  );
}

export function QuestsPage() {
  const location = useLocation();
  const [questTab, setQuestTab] = useState<"today" | "sub">("today");
  const navigate = useNavigate();
  const [detail, setDetail] = useState<{
    quest: (typeof quests)[number];
    trigger: HTMLButtonElement;
  } | null>(null);
  const [camera, setCamera] = useState<{
    quest: "meal" | "medicine" | "water";
    trigger: HTMLButtonElement;
  } | null>(null);
  const game = useGameStore((s) => s.game);
  return (
    <AppShell active="quests">
      <PageHeading title="DAILY QUEST" subtitle="나의 건강 습관을 쌓는 오늘의 퀘스트" />
      <Link className="cv-test-entry" to="/cv" aria-label="전면 카메라 CV 테스트">
        <PixelIcon name="camera" />
        <span>
          전면 카메라 CV 테스트<small>물 마시기 · 경구 복약 · 주사 동작</small>
        </span>
        <b aria-hidden="true">›</b>
      </Link>
      <Link className="meal-records-entry" to="/meals">
        식단 분석·기록 보기 ›
      </Link>
      <div className="quest-hub-tabs" role="tablist" aria-label="퀘스트 종류" data-no-swipe>
        <button
          role="tab"
          id="today-quest-tab"
          aria-selected={questTab === "today"}
          aria-controls="today-quest-panel"
          onClick={() => setQuestTab("today")}
        >
          Main Quest
        </button>
        <button
          role="tab"
          id="sub-quest-tab"
          aria-selected={questTab === "sub"}
          aria-controls="sub-quest-panel"
          onClick={() => setQuestTab("sub")}
        >
          Sub Quest
        </button>
      </div>
      <div
        role="tabpanel"
        id="today-quest-panel"
        aria-labelledby="today-quest-tab"
        hidden={questTab !== "today"}
      >
        <ProfileQuests />
        <section className="quest-summary">
          <DinosaurArt className="quest-summary-dino" pose="portrait" />
          <div className="quest-summary-copy">
            <h3>
              MAIN QUEST · <AnimatedNumber value={mainQuestCount(game.completed)} /> /{" "}
              {mainQuests.length} 완료
            </h3>
            <div className="quest-summary-detail">
              <div
                className="summary-track"
                role="progressbar"
                aria-label="오늘의 퀘스트 달성률"
                aria-valuemin={0}
                aria-valuemax={mainQuests.length}
                aria-valuenow={mainQuestCount(game.completed)}
              >
                <i
                  className="metric-fill"
                  style={{
                    width: `${(mainQuestCount(game.completed) / mainQuests.length) * 100}%`,
                  }}
                />
              </div>
              <p className="quest-weekly-inline">
                이번 주 달성 <strong>{weeklyCompletedDays(game)} / 5일</strong>
              </p>
              <small className="quest-growth-note">
                전투 EXP {game.combatExperienceToday} /{" "}
                {dailyCombatExperienceLimit(game.experience)} · 모두 완료 +200 G
              </small>
              {game.sleepExperience[game.date] && (
                <small className="quest-growth-note" aria-label="오늘 수면 추가 EXP">
                  수면 {game.sleepHours}시간 기록 · 추가 +
                  {game.sleepExperience[game.date].experience} EXP 지급 완료
                </small>
              )}
            </div>
          </div>
        </section>
        <Link className="step-connection-note" to="/me">
          걸음 수 자동 완료는 Android·iPhone 앱의 건강 연결이 필요해요. 연결 관리 ›
        </Link>
        <section className="quest-list" aria-label="오늘의 퀘스트">
          {mainQuests.map((q, index) => {
            const done = game.completed.includes(q.id);
            return (
              <button
                type="button"
                className="quest-row"
                key={q.id}
                aria-haspopup="dialog"
                onClick={(event) => setDetail({ quest: q, trigger: event.currentTarget })}
              >
                <PixelCheckbox checked={done} />
                <div className="quest-row-copy">
                  <h3>{q.title}</h3>
                  <small className={done ? "green" : ""}>{questProgressLabel(game, q)}</small>
                  <QuestProgress
                    label={q.title}
                    progress={questProgress(game, q)}
                    done={done}
                    delay={index * 45}
                  />
                </div>
                <span className="quest-exp">
                  +{questExperience(q.experience, game.experience)} EXP
                </span>
              </button>
            );
          })}
        </section>
      </div>
      {questTab === "sub" && (
        <div role="tabpanel" id="sub-quest-panel" aria-labelledby="sub-quest-tab">
          <SubQuestPanel onChoose={(quest, trigger) => setDetail({ quest, trigger })} />
        </div>
      )}
      {detail && (
        <QuestInfoDialog
          quest={detail.quest}
          trigger={detail.trigger}
          onClose={() => setDetail(null)}
          onAuthenticate={() => {
            const id = detail.quest.id;
            if (id === "meal" || id === "water" || id === "medicine") {
              setCamera({ quest: id, trigger: detail.trigger });
              setDetail(null);
            } else if (id === "survey") {
              setDetail(null);
              navigate("/daily-survey", { state: { surveyBackground: location } });
            } else navigate(`/quests/${id}`);
          }}
        />
      )}
      {camera && (
        <QuestCameraDialog
          quest={camera.quest}
          trigger={camera.trigger}
          onClose={() => setCamera(null)}
        />
      )}
    </AppShell>
  );
}

export function DashboardPage({ detailed = false }: { detailed?: boolean }) {
  const game = useGameStore((s) => s.game);
  const [params, setParams] = useSearchParams();
  const initial = reportSelection(params, game.date);
  const registeredOn = useProfileStore((s) => s.registeredOn);
  const [period, setPeriod] = useState<HealthPeriod>(initial.period);
  const [dateChoice, setSelectedDate] = useState<string | null>(
    params.has("date") ? initial.date : null,
  );
  const selectedDate = dateChoice ?? game.date;
  const [rangeStart, setRangeStart] = useState(initial.from);
  const range = reportDateRange(period, selectedDate, rangeStart);
  const selectedQuests = questCountOn(game, selectedDate);
  const periodInfo = healthPeriods[period];
  const score = healthScorePeriod(game, period, selectedDate, rangeStart);
  const { data, isError } = useQuery({
    queryKey: ["dashboard", "demo"],
    queryFn: ({ signal }) => dashboardService.getSnapshot(signal),
  });
  const Shell = detailed ? DashboardReportShell : AppShell;
  const reportUrl = `/dashboard/report?${new URLSearchParams({ period, date: selectedDate, from: rangeStart })}`;
  const setReportPeriod = (value: HealthPeriod) => {
    setPeriod(value);
    setParams({ period: value, date: selectedDate, from: rangeStart }, { replace: true });
  };
  const selectReportDates = (date: string, from = rangeStart) => {
    const start = from > date ? date : from;
    setSelectedDate(date);
    setRangeStart(start);
    setParams({ period, date, from: start }, { replace: true });
  };
  return (
    <Shell
      active="dashboard"
      calendarDate={selectedDate}
      onSelectDate={(date) => selectReportDates(date)}
      showCalendar={false}
    >
      <div className="dashboard-heading">
        <PageHeading
          title="HEALTH DASHBOARD"
          subtitle={`${periodInfo.label === "기간" ? "선택한 기간의" : periodInfo.label} 건강 기록과 변화를 확인하세요`}
        />
        <QuestCalendar
          game={game}
          selected={selectedDate}
          rangeLabel={range.start === range.end ? range.end : `${range.start} ~ ${range.end}`}
          onSelect={(date) => selectReportDates(date)}
          controls={
            <div className="dashboard-date-controls" data-no-swipe>
              <label className="dashboard-period-select">
                <span>조회 기간</span>
                <PixelSelect
                  aria-label="건강 변화 조회 기간"
                  value={period}
                  onValueChange={(value) => setReportPeriod(value as HealthPeriod)}
                >
                  {(Object.keys(healthPeriods) as HealthPeriod[]).map((value) => (
                    <option key={value} value={value}>
                      {healthPeriods[value].label}
                    </option>
                  ))}
                </PixelSelect>
              </label>
              <div className="dashboard-date-field">
                <span>{period === "custom" ? "날짜 범위" : "기준 날짜"}</span>
                <PixelDatePicker
                  label={period === "custom" ? "조회 날짜 범위" : "조회 기준 날짜"}
                  value={selectedDate}
                  max={game.date}
                  range={
                    period === "custom"
                      ? {
                          start: rangeStart,
                          onChange: (start, end) => {
                            selectReportDates(end, start);
                          },
                        }
                      : undefined
                  }
                  onChange={(value) => {
                    if (!value || value > game.date) return;
                    selectReportDates(value);
                  }}
                />
              </div>
            </div>
          }
        />
      </div>
      {!data ? (
        <p role="status">
          {isError ? "기록을 불러오지 못했어요." : "건강 기록을 불러오고 있어요."}
        </p>
      ) : !detailed ? (
        <DashboardSummary
          data={data}
          period={period}
          date={selectedDate}
          reportUrl={reportUrl}
          from={rangeStart}
        />
      ) : (
        <div className="dashboard-period-content" tabIndex={0} aria-label="대시보드 리포트 스크롤">
          <section className="health-report cream-card" aria-labelledby="report-title">
            <section className="health-growth-card" aria-label="유저 건강 점수">
              <div className="health-score">
                <h3>{periodInfo.heading} HEALTH SCORE</h3>
                <div className="score-value">
                  <strong className="score-number">
                    {score.score === null ? "—" : <AnimatedNumber value={score.score} />}
                  </strong>
                  <span className="score-total">/ 100</span>
                </div>
                <b className="score-rank">기록 기반 · {score.recordedDays}일</b>
                <p>{scoreChangeText(score, periodInfo.previous)}</p>
                <div className="score-track">
                  <i className="metric-fill" style={{ width: `${score.score ?? 0}%` }} />
                </div>
              </div>
            </section>
            <div className="report-body" key={`${period}-${range.start}-${range.end}`}>
              <header>
                <h3 id="report-title">
                  <PixelIcon name="document" />
                  REPORT
                </h3>
                <span>{periodInfo.label} 리포트 · 저장된 기록</span>
              </header>
              <p className="report-score-change">{scoreChangeText(score, periodInfo.previous)}</p>
              <dl>
                <div>
                  <dt>{selectedDate === game.date ? "오늘 퀘스트" : "선택일 퀘스트"}</dt>
                  <dd>
                    {selectedQuests} / {mainQuests.length}
                  </dd>
                </div>
                <div>
                  <dt>{selectedDate === game.date ? "이번 주 달성" : "선택 주 달성"}</dt>
                  <dd>{weeklyCompletedDays(game, selectedDate)}일</dd>
                </div>
              </dl>

              <small>
                걸음·메인 퀘스트·수면 달성률을 같은 비중으로 평균한 실천 점수예요. 기록이 없는
                항목은 제외해요.
              </small>
              <BloodPressureReport
                bp={data.bpResult}
                model={data.modelResult}
                ranker={data.rankerResult}
              />
              <Link to="/risk" className="disease-card" aria-label="질환 위험도 상세 보기">
                <header>
                  <h3>질환 위험도 · 데모</h3>
                  <small>
                    {registeredOn ? `등록일 ${registeredOn.replaceAll("-", ".")}` : "등록일 미등록"}
                  </small>
                </header>
                <div className="risk-grid">
                  {data.risks.map((r) => (
                    <div className={`risk-tile ${r.tone}`} key={r.name}>
                      <h4>{r.name}</h4>
                      <strong>
                        <AnimatedNumber value={r.current} />%
                      </strong>
                      <div className="risk-track">
                        <i className="metric-fill" style={{ width: `${r.current}%` }} />
                      </div>
                      <small>{r.status}</small>
                    </div>
                  ))}
                </div>
              </Link>
              <HealthTrend period={period} result={score} />
              {period === "week" && (
                <section className="impact-card">
                  <header>
                    <h3>퀘스트 효과 예측</h3>
                  </header>
                  <div className="chart-legend">
                    <span>현재</span>
                    <span>완료 후</span>
                  </div>
                  <div className="impact-rows">
                    {data.risks.map((r) => (
                      <div className="impact-row" key={r.name}>
                        <span>{r.name}</span>
                        <div className="impact-bars">
                          <div>
                            <i className="metric-fill" style={{ width: `${r.current * 2}%` }} />
                          </div>
                          <div>
                            <i className="metric-fill" style={{ width: `${r.projected * 2}%` }} />
                          </div>
                        </div>
                        <RiskChange
                          current={r.current}
                          projected={r.projected}
                          tone={r.tone}
                          projectedTone={r.projectedTone}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="chart-axis">
                    <span>0</span>
                    <span>25</span>
                    <span>50%</span>
                  </div>
                  <p className="prediction-note">데모 예상 수치로, 실제 결과와 다를 수 있어요.</p>
                </section>
              )}
            </div>
          </section>
        </div>
      )}
    </Shell>
  );
}

const products = retailReferences.map((reference, index) => ({
  ...reference,
  name: reference.product,
  sub: reference.pack,
  price: discountedRetailRp(reference.referenceWon),
  image: [
    assets.shop.imgProductPhoto,
    assets.shop.imgProductPhoto1,
    assets.shop.imgProductPhoto2,
    assets.shop.imgProductPhoto3,
    "/assets/shop/oatmeal.jpg",
    "/assets/shop/almonds.jpg",
  ][index],
  badge: "-10%",
}));
export function ShopPage({ customize = false }: { customize?: boolean }) {
  const { game, claimBonus } = useGameStore();
  const dino = dinosaurs[game.dinosaur];
  const notice = useNotice();
  const navigate = useNavigate();
  const [walletTrigger, setWalletTrigger] = useState<HTMLElement | null>(null);
  const [productDetail, setProductDetail] = useState<{
    item: (typeof products)[number];
    trigger: HTMLElement;
  } | null>(null);
  return (
    <AppShell active="shop">
      <PageHeading title="REX SHOP" subtitle={`건강 퀘스트 보상으로 ${dino.name} 꾸미기`} />
      <section className="shop-wallet" aria-label="GOLD 지갑">
        <div className="wallet-heading">
          <div className="wallet-currency wallet-gold">
            <h3>
              <PixelIcon name="coin" /> GOLD
            </h3>
            <div className="wallet-balance">
              <strong>
                <AnimatedNumber value={game.gold} separator />
                <small>G</small>
              </strong>
            </div>
            <small>공룡 꾸미기</small>
          </div>
          <div className="wallet-currency wallet-rp" aria-label={`보유 RP ${game.rp}`}>
            <h3>
              <PixelIcon name="shop" /> RP
            </h3>
            <strong>
              <AnimatedNumber value={game.rp} separator />
            </strong>
            <small>현실 리워드 · 데모</small>
          </div>
        </div>
        <div className="wallet-actions">
          <button
            className="wallet-convert"
            onClick={(event) => setWalletTrigger(event.currentTarget)}
          >
            전환 ⇄
          </button>
          <button
            className="daily-bonus"
            disabled={game.bonusClaimed}
            aria-label={
              game.bonusClaimed ? "오늘의 무료 GOLD 받기 완료" : "오늘의 무료 GOLD 10개 받기"
            }
            onClick={() => {
              claimBonus();
              notice("오늘의 무료 GOLD 10개를 받았어요!");
            }}
          >
            {game.bonusClaimed ? "오늘 보상 완료 ✓" : "일일 보상 +10 G"}
          </button>
        </div>
      </section>
      {walletTrigger && (
        <GameWallet onClose={() => setWalletTrigger(null)} returnFocusTo={walletTrigger} />
      )}
      {productDetail && (
        <InfoDialog
          title={productDetail.item.name}
          returnFocusTo={productDetail.trigger}
          onClose={() => setProductDetail(null)}
          confirmLabel="닫기"
        >
          <div className="retail-price-detail">
            <p>{productDetail.item.pack}</p>
            <p>쿠팡 참고 판매가 {productDetail.item.referenceWon.toLocaleString()}원</p>
            <strong>10% 할인 · {productDetail.item.price.toLocaleString()} RP</strong>
            <small>
              1 RP = 1원 · 확인일 {retailPricePolicy.checkedOn} · {productDetail.item.sourceAge}
            </small>
            <a href={productDetail.item.sourceUrl} target="_blank" rel="noreferrer">
              쿠팡에서 상품·가격 확인 ›
            </a>
            <p>
              실시간 가격·배송비·재고와 다를 수 있어요. 현재는 교환 데모이며 RP를 차감하거나
              주문하지 않아요.
            </p>
          </div>
        </InfoDialog>
      )}

      <section className="shop-catalog">
        <div className="shop-tabs" aria-label="상품 분류">
          {["추천", "꾸미기"].map((label, i) => (
            <button
              key={label}
              className={`shop-tab shop-tab-${i === 0 ? 0 : 2}`}
              aria-pressed={customize ? i === 1 : i === 0}
              onClick={() => navigate(["/shop", "/shop/customize"][i])}
            >
              <span className="shop-tab-content">
                <img
                  src={
                    [
                      assets.shop.imgDecorationRecommendationStar,
                      assets.shop.imgDecorationCustomizeSparkle,
                    ][i]
                  }
                  alt=""
                />
                <span className="shop-tab-label">
                  <strong>{label}</strong>
                </span>
              </span>
            </button>
          ))}
        </div>
        {customize ? (
          <div
            className="customize-scroll"
            tabIndex={0}
            role="region"
            aria-label="꾸미기 상품 목록"
          >
            <div className="shop-companion-banner">
              <DinosaurArt pose="portrait" alt="" />
              <div>
                <strong>{dino.name}의 모험 옷장</strong>
                <small>GOLD로 꾸미고, 캐릭터에서 장착해요.</small>
              </div>
              <Link to="/character?tab=accessories">보유 아이템 ›</Link>
            </div>
            <AccessoryCatalog showHeader={false} />
            <GoldEffects />
          </div>
        ) : (
          <>
            <div className="product-scroll" role="region" aria-label="상품 목록" tabIndex={0}>
              <header className="shop-section-heading">
                <h3>이번 주 추천</h3>
                <small>RP · 교환 데모</small>
              </header>
              <div className="product-grid">
                {products.map((p, i) => (
                  <button
                    key={p.name}
                    className={`product product-${i}${i === 0 ? " product-featured" : ""}`}
                    onClick={(event) => setProductDetail({ item: p, trigger: event.currentTarget })}
                  >
                    <span className="product-topline">
                      <span className={`product-badge ${i === 0 ? "sale" : ""}`}>
                        {p.badge ?? "REWARD"}
                      </span>
                      <small>RP SHOP</small>
                    </span>
                    <span className="product-photo">
                      <img src={p.image} alt={p.name} />
                    </span>
                    <strong>{p.name}</strong>
                    <small>{p.sub}</small>
                    <small className="retail-reference">
                      쿠팡 참고 {p.referenceWon.toLocaleString()}원 · 10% 할인
                    </small>
                    <span className="product-footer">
                      <span className="product-price">{p.price.toLocaleString()} RP</span>
                      <span className="product-action">
                        교환 보기 <span aria-hidden="true">›</span>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <details className="shop-photo-credits">
              <summary>상품 이미지 출처</summary>
              <p>
                쿠팡의 날짜가 있는 참고 가격에서 10%를 내린 RP예요. 1 RP = 1원 기준이며 실시간
                판매가·배송비·재고와 다를 수 있어요. 이미지는 상품 유형 예시예요.
              </p>
              <a
                href="https://commons.wikimedia.org/wiki/File:Oatmeal_(1).jpg"
                target="_blank"
                rel="noreferrer"
              >
                Oatmeal — Renee Comet / NCI · Public domain
              </a>
              <a
                href="https://commons.wikimedia.org/wiki/File:Bowl_of_chopped_almonds.jpg"
                target="_blank"
                rel="noreferrer"
              >
                Almonds — Douglas P Perkins
              </a>
              <a
                href="https://creativecommons.org/licenses/by-sa/3.0/"
                target="_blank"
                rel="noreferrer"
              >
                CC BY-SA 3.0 · 원본 이미지
              </a>
            </details>
          </>
        )}
      </section>
    </AppShell>
  );
}

export function CharacterPage() {
  return (
    <AppShell active="character">
      <CharacterVault />
    </AppShell>
  );
}
