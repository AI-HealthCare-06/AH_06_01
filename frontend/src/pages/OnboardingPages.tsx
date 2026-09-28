import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ScenarioShell } from "../components/AppShell";
import { DesignCanvas } from "../components/DesignCanvas";
import { useNotice } from "../components/NoticeProvider";
import { assets } from "../design/assets";
import { dinosaurs } from "../design/dinosaurs";
import { bmi, profileSchema } from "../domain/profile";
import { useProfileStore } from "../stores/profile-store";
import { useGameStore } from "../stores/game-store";
import { DinosaurArt } from "../components/DinosaurArt";

export function LoginPage() {
  const [visible, setVisible] = useState(false);
  const navigate = useNavigate();
  const notice = useNotice();
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    notice("데모 모험을 시작해요. 이메일과 비밀번호는 전송·저장하지 않아요.");
    navigate("/profile");
  }
  return (
    <ScenarioShell
      className="login-screen"
      background={assets.login.imgLoginBackgroundCanyonWaterfall}
      camera={assets.login.imgEllipse}
    >
      <div className="login-hero">
        <DesignCanvas width={354} height={440}>
          <span className="hero-mist" />
          <img
            className="rexrun-logo"
            src={assets.login.imgLoginHeroRexRunBlackLogo}
            alt="REXRUN"
          />
          <img
            className="rexrun-egg"
            src={assets.login.imgLoginHeroRefinedEggSprite}
            alt="초록 무늬 공룡 알"
          />
          <span className="egg-heart">♥</span>
          <p>
            EAT
            <br />
            MOVE
            <br />
            SLEEP
            <br />
            TOGETHER
          </p>
        </DesignCanvas>
      </div>
      <form className="login-form" onSubmit={submit}>
        <h1>WELCOME, ADVENTURER</h1>
        <p>로그인하고 오늘의 모험을 이어가세요.</p>
        <label htmlFor="email">이메일</label>
        <div className="login-input">
          <img src={assets.login.imgLoginFormEmailIcon} alt="" />
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            defaultValue="hello@rexrun.com"
            required
            aria-label="이메일"
          />
        </div>
        <label htmlFor="password">비밀번호</label>
        <div className="login-input password-input">
          <img src={assets.login.imgLoginFormLockIcon} alt="" />
          <input
            id="password"
            name="password"
            type={visible ? "text" : "password"}
            autoComplete="current-password"
            defaultValue="rexrun12"
            minLength={8}
            required
          />
          <button
            type="button"
            aria-label={visible ? "비밀번호 숨기기" : "비밀번호 표시"}
            onClick={() => setVisible(!visible)}
          >
            <img src={assets.login.imgLoginFormPasswordVisibility} alt="" />
          </button>
        </div>
        <button className="primary-button login-next" type="submit" aria-label="다음">
          다음<span>›</span>
        </button>
        <Link className="signup-link" to="/profile">
          계정이 없나요? 가입하기 ›
        </Link>
      </form>
    </ScenarioShell>
  );
}

export function ProfilePage() {
  const { profile, setProfile } = useProfileStore();
  const [draft, setDraft] = useState(profile);
  const [unknownMeasurements, setUnknownMeasurements] = useState({
    bloodPressure: profile.bloodPressure === null,
    glucose: profile.glucose === null,
  });
  const notice = useNotice();
  const navigate = useNavigate();
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const result = profileSchema.safeParse({
      ...draft,
      bloodPressure: unknownMeasurements.bloodPressure ? null : (draft.bloodPressure ?? ""),
      glucose: unknownMeasurements.glucose ? null : (draft.glucose ?? ""),
    });
    if (!result.success) {
      notice("입력값을 확인해 주세요. 혈압은 120 / 80 형식으로 입력해 주세요.");
      return;
    }
    setProfile(result.data);
    notice("프로필 입력을 완료했어요. 건강 점수와 위험도는 체험용 예시예요.");
    navigate("/dinosaur");
  }
  return (
    <ScenarioShell
      className="profile-screen"
      background={assets.profile.imgHealthBackgroundPixelOcean}
      camera={assets.profile.imgEllipse}
    >
      <header className="profile-heading">
        <div className="profile-title-row">
          <h1>건강 프로필</h1>
          <span>STEP 01</span>
        </div>
        <h2>
          나를 위한 건강 모험,
          <br />
          여기서 시작해요.
        </h2>
        <p>
          기본 정보와 최근 측정값을 입력하고
          <br />
          함께할 공룡을 만나보세요.
        </p>
      </header>
      <form onSubmit={submit} className="profile-form">
        <fieldset className="profile-section">
          <legend>기본 정보</legend>
          <div className="profile-grid">
            <label>
              나이
              <div className="health-input">
                <input
                  aria-label="나이"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="120"
                  required
                  value={Number.isFinite(draft.age) ? draft.age : ""}
                  onChange={(e) => setDraft({ ...draft, age: e.target.valueAsNumber })}
                />
                <span>세</span>
              </div>
            </label>
            <label>
              성별
              <div className="health-select">
                <select
                  value={draft.sex}
                  onChange={(e) => setDraft({ ...draft, sex: e.target.value as "female" | "male" })}
                >
                  <option value="female">여성</option>
                  <option value="male">남성</option>
                </select>
              </div>
            </label>
            <label>
              키
              <div className="health-input">
                <input
                  aria-label="키"
                  type="number"
                  inputMode="decimal"
                  min="50"
                  max="250"
                  step="0.1"
                  required
                  value={Number.isFinite(draft.height) ? draft.height : ""}
                  onChange={(e) => setDraft({ ...draft, height: e.target.valueAsNumber })}
                />
                <span>cm</span>
              </div>
            </label>
            <label>
              몸무게
              <div className="health-input">
                <input
                  aria-label="몸무게"
                  type="number"
                  inputMode="decimal"
                  min="1"
                  max="500"
                  step="0.1"
                  required
                  value={Number.isFinite(draft.weight) ? draft.weight : ""}
                  onChange={(e) => setDraft({ ...draft, weight: e.target.valueAsNumber })}
                />
                <span>kg</span>
              </div>
            </label>
          </div>
        </fieldset>
        <fieldset className="profile-section">
          <legend>최근 건강 측정값</legend>
          <p className="profile-section-note">
            최근 측정값을 입력해 주세요. 값을 모르면 ‘모름’을 선택해도 괜찮아요.
          </p>
          <div className="profile-grid profile-measurements">
            <div className="measurement-field">
              <div className="measurement-label-row">
                <label htmlFor="blood-pressure">혈압</label>
                <label className="unknown-measurement">
                  <input
                    type="checkbox"
                    aria-label="혈압 모름"
                    checked={unknownMeasurements.bloodPressure}
                    onChange={(e) =>
                      setUnknownMeasurements({
                        ...unknownMeasurements,
                        bloodPressure: e.target.checked,
                      })
                    }
                  />
                  <span>모름</span>
                </label>
              </div>
              <div className="health-input pressure-input">
                <input
                  id="blood-pressure"
                  aria-label="혈압"
                  type="text"
                  placeholder={unknownMeasurements.bloodPressure ? "모름" : "120 / 80"}
                  aria-describedby="blood-pressure-hint"
                  disabled={unknownMeasurements.bloodPressure}
                  required={!unknownMeasurements.bloodPressure}
                  value={unknownMeasurements.bloodPressure ? "" : (draft.bloodPressure ?? "")}
                  onChange={(e) => setDraft({ ...draft, bloodPressure: e.target.value })}
                />
                <span>mmHg</span>
              </div>
              <small id="blood-pressure-hint" className="field-hint">
                수축기 / 이완기 순서 · 예: 120 / 80
              </small>
            </div>
            <div className="measurement-field">
              <div className="measurement-label-row">
                <label htmlFor="fasting-glucose">공복 혈당</label>
                <label className="unknown-measurement">
                  <input
                    type="checkbox"
                    aria-label="공복 혈당 모름"
                    checked={unknownMeasurements.glucose}
                    onChange={(e) =>
                      setUnknownMeasurements({
                        ...unknownMeasurements,
                        glucose: e.target.checked,
                      })
                    }
                  />
                  <span>모름</span>
                </label>
              </div>
              <div className="health-input">
                <input
                  id="fasting-glucose"
                  aria-label="공복 혈당"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="1000"
                  placeholder={unknownMeasurements.glucose ? "모름" : "예: 104"}
                  disabled={unknownMeasurements.glucose}
                  required={!unknownMeasurements.glucose}
                  value={
                    !unknownMeasurements.glucose && Number.isFinite(draft.glucose)
                      ? (draft.glucose ?? "")
                      : ""
                  }
                  onChange={(e) => setDraft({ ...draft, glucose: e.target.valueAsNumber })}
                />
                <span>mg/dL</span>
              </div>
            </div>
          </div>
        </fieldset>
        <fieldset className="profile-section">
          <legend>생활 습관과 가족력</legend>
          <div className="health-toggles">
            {(
              [
                { key: "smoking", label: "흡연 여부" },
                { key: "hypertensionFamily", label: "고혈압 가족력" },
                { key: "diabetesFamily", label: "당뇨 가족력" },
              ] as const
            ).map(({ key, label }) => (
              <div key={key} className="health-option-row">
                <span id={`${key}-label`}>{label}</span>
                <div className="health-options" role="radiogroup" aria-labelledby={`${key}-label`}>
                  {([false, true, null] as const).map((value) => (
                    <label key={String(value)}>
                      <input
                        type="radio"
                        name={key}
                        value={String(value)}
                        checked={draft[key] === value}
                        onChange={() => setDraft({ ...draft, [key]: value })}
                      />
                      <span>
                        {value === null
                          ? "모름"
                          : key === "smoking"
                            ? value
                              ? "예"
                              : "아니요"
                            : value
                              ? "있음"
                              : "없음"}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </fieldset>
        <div className="cream-card bmi-card">
          <div>
            <small>나의 BMI</small>
            <strong aria-live="polite">
              {Number.isFinite(draft.height) && draft.height > 0 && Number.isFinite(draft.weight)
                ? bmi(draft.height, draft.weight)
                : "—"}
            </strong>
          </div>
          <span>
            입력한 키와 몸무게로
            <br />
            자동 계산해요.
          </span>
        </div>
        <button className="primary-button profile-submit" type="submit">
          공룡 깨우기
          <span aria-hidden="true">→</span>
        </button>
        <p className="privacy-note">
          <img src={assets.profile.imgHealthFormPrivacyIcon} alt="" />
          <span>
            지금은 체험 화면이에요.
            <br />
            입력한 건강 정보는 저장되지 않아요.
          </span>
        </p>
      </form>
    </ScenarioShell>
  );
}

export function DinosaurPage() {
  const { game, chooseDinosaur } = useGameStore();
  const dino = dinosaurs[game.dinosaur];
  return (
    <ScenarioShell
      className="dinosaur-screen"
      background={assets.dinosaur.imgDinoSelectBackgroundPixelJungle}
      camera={assets.dinosaur.imgEllipse}
    >
      <header className="scenario-heading">
        <h1>함께할 공룡을 골라주세요</h1>
        <p>공룡마다 다른 건강 능력을 키워요.</p>
      </header>
      <div className="dinosaur-grid" role="group" aria-label="함께할 공룡 선택">
        {dinosaurs.map((d, i) => (
          <button
            className={`dinosaur-card dinosaur-${i} ${game.dinosaur === i ? "selected" : ""}`}
            aria-pressed={game.dinosaur === i}
            key={d.name}
            onClick={() => chooseDinosaur(i)}
          >
            <DinosaurArt dinosaur={i} alt="" />
            <strong>{d.name}</strong>
            <small>{d.trait}</small>
            {game.dinosaur === i && <span>선택</span>}
          </button>
        ))}
      </div>
      <div className="cream-card dinosaur-callout">
        <h2>오늘부터 {dino.name}와 함께해요?</h2>
        <p>매일의 습관이 {dino.name}를 성장시켜요.</p>
      </div>
      <Link className="primary-button dinosaur-start" to="/first-result">
        모험 시작하기
      </Link>
    </ScenarioShell>
  );
}

export function FirstResultPage() {
  const game = useGameStore((s) => s.game);
  const dino = dinosaurs[game.dinosaur];
  const a = assets["first-result"];
  return (
    <ScenarioShell className="first-result-screen" camera={a.imgEllipse}>
      <header className="scenario-heading">
        <h1>첫 건강 위험도</h1>
        <p>건강 모험의 시작 화면을 체험해 보세요.</p>
      </header>
      <div className="dino-scene initial-scene">
        <img className="scene-background" src={a.imgRectangle} alt="초록 숲" />
        <DinosaurArt className="scene-dino" pose="initial" alt={dino.name} />
        <b className="scene-badge">NORMAL STATE</b>
        <strong>Lv.1 {dino.name}</strong>
      </div>
      <div className="cream-card first-risk">
        <h2>고혈압 위험도</h2>
        <strong>약 32%</strong>
        <p>생활습관을 바꾸면 낮아질 수 있어요.</p>
      </div>
      <h2 className="first-quests-title">오늘의 첫 퀘스트</h2>
      <div className="first-quests">
        {[
          { id: "medicine", label: "약 복용 체크", reward: 10 },
          { id: "meal", label: "건강한 한 끼", reward: 20 },
          { id: "walk", label: "6,000걸음 걷기", reward: 30 },
        ].map((q, i) => (
          <Link to={`/quests/${q.id}`} key={q.id} className="cream-card first-quest">
            <span className={`checkbox ${i === 0 ? "checked" : ""}`} />
            <b>{q.label}</b>
            <strong>+{q.reward} COIN</strong>
          </Link>
        ))}
      </div>
      <Link className="primary-button first-start" to="/quests">
        첫 퀘스트 시작하기
      </Link>
      <p className="first-result-note">표시된 위험도는 입력값과 무관한 체험용 예시예요.</p>
    </ScenarioShell>
  );
}
