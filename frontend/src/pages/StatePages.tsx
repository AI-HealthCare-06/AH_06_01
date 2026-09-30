import { useState } from "react";
import { Link } from "react-router-dom";
import { ScenarioShell } from "../components/AppShell";
import { DesignCanvas } from "../components/DesignCanvas";
import { useNotice } from "../components/NoticeProvider";
import { assets } from "../design/assets";
import { dinosaurs } from "../design/dinosaurs";
import { useGameStore } from "../stores/game-store";
import { DinosaurArt } from "../components/DinosaurArt";

export function RiskPage() {
  const selected = useGameStore((s) => s.game.dinosaur);
  const [period, setPeriod] = useState("일");
  const notice = useNotice();
  return (
    <ScenarioShell className="risk-screen" camera={assets.risk.imgEllipse}>
      <Link to="/dashboard">
        <h1>HEALTH DASHBOARD</h1>
      </Link>
      <h2>위험도 변화</h2>
      <div className="period-tabs" aria-label="위험도 기간">
        {["일", "주", "월"].map((p) => (
          <button
            aria-pressed={period === p}
            onClick={() => {
              setPeriod(p);
              if (p !== "일")
                notice("현재 차트는 Figma의 일별 예시예요. 주·월별 기록은 준비 중이에요.");
            }}
            key={p}
          >
            {p}
          </button>
        ))}
      </div>
      <section className="cream-card risk-history">
        <header>
          <h3>고혈압 위험도</h3>
          <strong>31.4%</strong>
          <b>어제보다 -0.6%p</b>
        </header>
        <DesignCanvas width={310} height={115}>
          <img src={assets.risk.imgFrame} alt="일별 고혈압 위험도 예시 추이" />
        </DesignCanvas>
        <p>월 화 수 목 금 토 일</p>
      </section>
      <div className="risk-summary">
        <div className="cream-card">
          <h3>누적 달성</h3>
          <p>
            <strong>18</strong>
            <span>퀘스트</span>
          </p>
          <b>연속 4일</b>
        </div>
        <div className="cream-card">
          <h3>{dinosaurs[selected].name} 능력치</h3>
          <img src={assets.risk.imgFrame1} alt="공룡 능력치 레이더 차트" />
        </div>
      </div>
      <h2 className="week-summary-title">이번 주 요약</h2>
      <div className="week-summary">
        {[
          ["위험도", "-1.8%p"],
          ["퀘스트", "12 / 15"],
          ["걸음", "평균 6,420"],
        ].map(([label, value], i) => (
          <div key={label} className="cream-card">
            <h3>{label}</h3>
            <strong className={i === 0 ? "green" : ""}>{value}</strong>
          </div>
        ))}
      </div>
    </ScenarioShell>
  );
}

export function WitheredPage() {
  const selected = useGameStore((s) => s.game.dinosaur);
  const dino = dinosaurs[selected];
  return (
    <ScenarioShell className="withered-screen" camera={assets.withered.imgEllipse}>
      <header className="scenario-heading">
        <h1>{dino.name}, 다시 시작해요</h1>
        <p>어제 퀘스트를 완료하지 못했어요.</p>
      </header>
      <div className="withered-scene">
        <span>WITHERED STATE</span>
        <DinosaurArt pose="withered" alt={`힘이 빠진 ${dino.name}`} />
        <strong>힘이 빠져 축 처졌어요…</strong>
      </div>
      <div className="cream-card withered-message">
        <h2>오늘은 GOLD 보너스가 없어요.</h2>
        <p>
          하지만 퀘스트 하나만 완료하면
          <br />
          바로 NORMAL 상태로 회복해요.
        </p>
      </div>
      <Link className="primary-button" to="/quests">
        회복 퀘스트 시작하기
      </Link>
      <div className="cream-card return-reminder">
        <h3>알림</h3>
        <p>오늘의 첫 퀘스트가 기다리고 있어요.</p>
        <span>오후 8:00</span>
      </div>
    </ScenarioShell>
  );
}
