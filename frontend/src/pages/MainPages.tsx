import { Link, useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell, PageHeading } from "../components/AppShell";
import { AdventureScene } from "../components/AdventureScene";
import { DinoRadarCard } from "../components/DinoRadarCard";
import { DinosaurArt } from "../components/DinosaurArt";
import { DinosaurCustomization } from "../components/DinosaurCustomization";
import { RiskChange } from "../components/RiskChange";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { QuestProgress, PixelCheckbox } from "../components/QuestProgress";
import { useNotice } from "../components/NoticeProvider";
import { assets } from "../design/assets";
import { dinosaurs } from "../design/dinosaurs";
import { quests, stageProgress, questProgress, questProgressLabel } from "../domain/game";
import { useGameStore } from "../stores/game-store";
import { dashboardService } from "../services/dashboard-service";
import { weeklyCompletedDays } from "../domain/game";
import { PixelIcon } from "../components/PixelIcon";
import { HealthTrend } from "../components/HealthTrend";
import { healthPeriods } from "../services/health-history";
import type { HealthPeriod } from "../services/health-history";
import { useProfileStore } from "../stores/profile-store";

export function HomePage() {
  const { game, paused, togglePause } = useGameStore();
  const dino = dinosaurs[game.dinosaur];
  const a = assets.home;
  const icons = [
    a.imgQuestItem0PixelIcon,
    a.imgQuestItem1PixelIcon,
    a.imgQuestItem2PixelIcon,
    a.imgQuestItem3PixelIcon,
  ];
  return (
    <AppShell active="home">
      <Link to={game.completed.length ? "/buff" : "/withered"} className="dino-feedback">
        <img className="feedback-background" src={a.imgFeedbackDinoMessage} alt="" />
        <span className="feedback-wash" />
        <DinosaurArt className="feedback-portrait" pose="portrait" />
        <span className="feedback-copy">
          <strong>{dino.name}, 잘하고 있어요!</strong>
          <small>꾸준히 하면 더 강해질 수 있어요!</small>
        </span>
        <b>
          <PixelIcon name="chevron" />
        </b>
        <span className="pixel-grass" />
      </Link>
      <AdventureScene game={game} paused={paused} onTogglePause={togglePause} />
      <div className="home-panels">
        <DinoRadarCard />
        <section className="compact-quests">
          <Link className="compact-quest-title" to="/quests">
            <img src={a.imgPixelIconIcon} alt="" />
            <h3>DAILY QUEST</h3>
            <img src={a.imgOpenChevron} alt="" />
          </Link>
          {quests.slice(0, 4).map((q, i) => {
            const done = game.completed.includes(q.id);
            return (
              <Link className="compact-quest" key={q.id} to={`/quests/${q.id}`}>
                <PixelCheckbox checked={done} />
                <img src={icons[i]} alt="" />
                <div>
                  <div className="compact-quest-heading">
                    <strong>{q.title}</strong>
                    {q.id === "water" && <small>{done ? 8 : 0} / 8잔</small>}
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
  const game = useGameStore((s) => s.game);
  const dino = dinosaurs[game.dinosaur];
  const notice = useNotice();
  return (
    <AppShell active="quests">
      <PageHeading title="DAILY QUEST" subtitle={`${dino.name}의 성장을 위한 오늘의 건강 퀘스트`} />
      <section className="quest-summary">
        <DinosaurArt className="quest-summary-dino" pose="portrait" />
        <div className="quest-summary-copy">
          <h3>
            TODAY QUEST · <AnimatedNumber value={game.completed.length} /> / 5 완료
          </h3>
          <div className="quest-summary-detail">
            <div className="quest-summary-power">
              <p>{dino.name} 전투력 +12</p>
              <div className="summary-track">
                <i className="metric-fill" style={{ width: `${stageProgress(game) * 10}%` }} />
              </div>
            </div>
            <button
              className="quest-summary-reward"
              onClick={() => notice("모든 퀘스트를 완료하면 기본 보상에 50% 추가 보상이 지급돼요.")}
            >
              <img src={assets.quests.imgDecorationRewardSpark} alt="" />
              +50% COIN
            </button>
          </div>
        </div>
      </section>
      <Link className="step-connection-note" to="/me">
        걸음 수 자동 완료는 Android·iPhone 앱의 건강 연결이 필요해요. 연결 관리 ›
      </Link>
      <section className="quest-list" aria-label="오늘의 퀘스트">
        {quests.map((q, index) => {
          const done = game.completed.includes(q.id);
          return (
            <Link className="quest-row" to={`/quests/${q.id}`} key={q.id}>
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
              <span className="quest-exp">+{q.experience} EXP</span>
            </Link>
          );
        })}
      </section>
      <button
        className="weekly-reward"
        onClick={() =>
          notice(
            weeklyCompletedDays(game) === 5
              ? "이번 주 5일 달성! 보스전 입장 조건을 충족했어요. 보스전은 준비 중이에요."
              : `하루 5개 퀘스트를 모두 완료하면 1일 달성으로 기록돼요. 이번 주 ${weeklyCompletedDays(game)}일 달성했어요.`,
          )
        }
      >
        <h3>WEEKLY BOSS REWARD</h3>
        <p>
          {weeklyCompletedDays(game) === 5
            ? "5일 달성! 보스전 입장 조건 완료"
            : "하루 퀘스트 모두 완료 · 주 5일 달성"}
        </p>
        <div>
          <strong>
            <AnimatedNumber value={weeklyCompletedDays(game)} /> / 5 DAYS
          </strong>
          <span
            role="progressbar"
            aria-label="이번 주 퀘스트 달성일"
            aria-valuemin={0}
            aria-valuemax={5}
            aria-valuenow={weeklyCompletedDays(game)}
          >
            <i className="metric-fill" style={{ width: `${weeklyCompletedDays(game) * 20}%` }} />
          </span>
        </div>
      </button>
    </AppShell>
  );
}

export function DashboardPage() {
  const game = useGameStore((s) => s.game);
  const dino = dinosaurs[game.dinosaur];
  const registeredOn = useProfileStore((s) => s.registeredOn);
  const [period, setPeriod] = useState<HealthPeriod>("week");
  const periodInfo = healthPeriods[period];
  const { data, isError } = useQuery({
    queryKey: ["dashboard", "demo"],
    queryFn: ({ signal }) => dashboardService.getSnapshot(signal),
  });
  return (
    <AppShell active="dashboard">
      <PageHeading
        title="HEALTH DASHBOARD"
        subtitle={`${periodInfo.label} 건강 기록과 ${dino.name}의 성장을 확인하세요`}
      />
      <fieldset className="dashboard-period">
        <legend>건강 변화 조회 기간</legend>
        {(Object.keys(healthPeriods) as HealthPeriod[]).map((value) => (
          <label key={value}>
            <input
              type="radio"
              name="health-period"
              value={value}
              checked={period === value}
              onChange={() => setPeriod(value)}
            />
            <span>{healthPeriods[value].label}</span>
          </label>
        ))}
      </fieldset>
      {!data ? (
        <p role="status">
          {isError ? "기록을 불러오지 못했어요." : "건강 기록을 불러오고 있어요."}
        </p>
      ) : (
        <div key={period} className="dashboard-period-content">
          <section className="health-score">
            <h3>{periodInfo.heading} HEALTH SCORE</h3>
            <strong className="score-number">
              <AnimatedNumber value={data.score} />
            </strong>
            <span className="score-total">/ 100</span>
            <b className="score-rank">RANK: A</b>
            <p>
              {periodInfo.previous}보다 <AnimatedNumber value={periodInfo.delta} />점 올랐어요!
            </p>
            <div className="score-track">
              <i className="metric-fill" style={{ width: `${data.score}%` }} />
            </div>
          </section>
          <Link to="/buff" className="growth-insight">
            <DinosaurArt pose="portrait" alt={`성장한 ${dino.name}`} />
            <div>
              <h3>
                <span>{dino.name} 성장</span>
                <span>
                  +<AnimatedNumber value={12} />%
                </span>
              </h3>
              <p>
                건강 점수 {data.score - periodInfo.delta} → {data.score} · 공격력 100 → 112
              </p>
              <p>
                오늘 퀘스트 {game.completed.length}/5 · 이번 주 {weeklyCompletedDays(game)}일 달성
              </p>
              <small>꾸준한 실천이 성장으로 이어져요. 능력치는 데모예요.</small>
            </div>
          </Link>
          {period !== "week" && <HealthTrend period={period} today={game.date} />}
          <Link to="/risk" className="disease-card" aria-label="질환 위험도 상세 보기">
            <header>
              <h3>질환 위험도</h3>
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
      )}
    </AppShell>
  );
}

const products = [
  {
    name: "닭가슴살 세트",
    sub: "주간 특가 15% · 실물 상품",
    price: 450,
    image: assets.shop.imgProductPhoto,
    badge: "WEEKLY -15%",
    wide: true,
  },
  {
    name: "홍삼 선물세트",
    sub: "RRR · 실물 상품",
    price: 620,
    image: assets.shop.imgProductPhoto1,
  },
  { name: "멀티비타민", sub: "RRR · 실물 상품", price: 120, image: assets.shop.imgProductPhoto2 },
  {
    name: "프로틴 음료",
    sub: "BEST · 이번 주 구매 1위",
    price: 300,
    image: assets.shop.imgProductPhoto3,
    badge: "BEST 1",
    wide: true,
  },
];
export function ShopPage() {
  const { game, claimBonus } = useGameStore();
  const dino = dinosaurs[game.dinosaur];
  const notice = useNotice();
  const location = useLocation();
  const navigate = useNavigate();
  const category =
    location.pathname === "/shop/customize"
      ? 2
      : new URLSearchParams(location.search).get("category") === "rewards"
        ? 1
        : 0;
  return (
    <AppShell active="shop">
      <PageHeading title="REX SHOP" subtitle={`건강 퀘스트 보상으로 ${dino.name} 꾸미기`} />
      <section className="shop-wallet" aria-label="헬스 코인 지갑">
        <h3>HEALTH COINS</h3>
        <p>퀘스트 완료로 코인을 모아요</p>
        <div className="wallet-balance">
          <PixelIcon name="coin" />
          <strong>
            <AnimatedNumber value={game.coins} separator />
          </strong>
        </div>
        <button
          className="daily-bonus"
          disabled={game.bonusClaimed}
          aria-label={
            game.bonusClaimed ? "오늘의 무료 코인 받기 완료" : "오늘의 무료 코인 10개 받기"
          }
          onClick={() => {
            claimBonus();
            notice("오늘의 무료 코인 10개를 받았어요!");
          }}
        >
          <span className="bonus-diamond" aria-hidden="true">
            ◆
          </span>
          <span className="daily-bonus-copy">
            <strong>DAILY FREE</strong>
            <small>+10 COIN</small>
          </span>
          <b>{game.bonusClaimed ? "완료" : "받기"}</b>
        </button>
      </section>
      <section className="shop-catalog">
        <div className="shop-tabs" aria-label="상품 분류">
          {["추천", "RRR", "꾸미기"].map((label, i) => (
            <button
              key={label}
              className={`shop-tab shop-tab-${i}`}
              aria-pressed={category === i}
              onClick={() => navigate(["/shop", "/shop?category=rewards", "/shop/customize"][i])}
            >
              <span className="shop-tab-content">
                <img
                  src={
                    [
                      assets.shop.imgDecorationRecommendationStar,
                      assets.shop.imgDecorationRrrCoin,
                      assets.shop.imgDecorationCustomizeSparkle,
                    ][i]
                  }
                  alt=""
                />
                <span className="shop-tab-label">
                  <strong>{label}</strong>
                  {i === 1 && <small>REAL REWARD</small>}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div
          key={category}
          className="product-scroll"
          role="region"
          aria-label={category === 2 ? "꾸미기 목록" : "상품 목록"}
          tabIndex={0}
        >
          {category === 2 ? (
            <DinosaurCustomization />
          ) : (
            <div className="product-grid">
              {products.map((p, i) => (
                <button
                  key={p.name}
                  className={`product product-${i} ${p.wide ? "wide" : ""}`}
                  onClick={() =>
                    notice(
                      `${p.name} · ${p.price} P — 상품 교환은 준비 중이며 코인은 차감되지 않아요.`,
                    )
                  }
                >
                  <span className="product-photo">
                    <img src={p.image} alt={p.name} />
                  </span>
                  <span className="rrr-badge">RRR</span>
                  <span className="product-price">{p.price} P</span>
                  {p.badge && (
                    <span className={`product-badge ${i === 0 ? "sale" : ""}`}>{p.badge}</span>
                  )}
                  <strong>{p.name}</strong>
                  <small>{p.sub}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </AppShell>
  );
}
