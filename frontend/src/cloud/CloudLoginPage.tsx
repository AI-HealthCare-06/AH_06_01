import { enterDemo } from "../domain/demo-mode";
import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { ScenarioShell } from "../components/AppShell";
import { assets } from "../design/assets";
import { cloudConfig, supabase } from "./client";
import { exchangeCallback, socialLogin, useCloudStore } from "./sync";
import { useSessionStore } from "../stores/session-store";
import { useProfileStore } from "../stores/profile-store";

export function CloudLoginPage({ signup = false }: { signup?: boolean }) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const active = useSessionStore((s) => s.active),
    ready = useCloudStore((s) => s.ready),
    onboarded = useProfileStore((s) => s.onboardingCompleted);
  if (active && ready) return <Navigate to={onboarded ? "/home" : "/profile"} replace />;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const credentials = {
        email: String(data.get("email")).trim(),
        password: String(data.get("password")),
      };
      const result = signup
        ? await supabase.auth.signUp({
            ...credentials,
            options: { emailRedirectTo: `${location.origin}/auth/callback` },
          })
        : await supabase.auth.signInWithPassword(credentials);
      if (result.error) throw result.error;
      if (signup && !result.data.session)
        setMessage("가입 확인 메일을 보냈어요. 메일 인증 후 로그인해 주세요.");
    } catch {
      setMessage("로그인하지 못했어요. 이메일·비밀번호 또는 가입 확인 메일을 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScenarioShell
      className="cloud-login"
      background={assets.login.imgLoginBackgroundCanyonWaterfall}
    >
      <form className="cloud-auth-card" aria-busy={busy} onSubmit={submit}>
        <header className="cloud-auth-heading">
          <h1>REXRUN</h1>
          <h2>{signup ? "새 모험 시작" : "모험 이어가기"}</h2>
          <p>내 계정으로 기록을 안전하게 이어가요.</p>
        </header>
        <div className="cloud-auth-fields">
          <label className="cloud-auth-field" htmlFor="cloud-email">
            <span>이메일</span>
            <input
              id="cloud-email"
              name="email"
              type="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              autoComplete="email"
              placeholder="이메일 주소"
              required
            />
          </label>
          <label className="cloud-auth-field" htmlFor="cloud-password">
            <span>비밀번호</span>
            <input
              id="cloud-password"
              name="password"
              type="password"
              minLength={8}
              placeholder="8자 이상 입력"
              autoComplete={signup ? "new-password" : "current-password"}
              required
            />
          </label>
        </div>
        {message && (
          <p className="cloud-auth-message" role="status">
            {message}
          </p>
        )}
        <button className="primary-button cloud-auth-submit" disabled={busy}>
          {busy ? "연결 중…" : signup ? "가입하기" : "로그인"}
        </button>
        <Link className="cloud-auth-switch" to={signup ? "/login" : "/signup"}>
          {signup ? "이미 계정이 있어요" : "계정 만들기"}
        </Link>
        <div className="cloud-social" role="group" aria-label="소셜 로그인">
          <p className="cloud-social-divider">다른 계정으로 계속하기</p>
          {(["google", "kakao", "naver"] as const).map((provider) => (
            <button
              key={provider}
              type="button"
              className={`cloud-provider cloud-provider-${provider}`}
              disabled={!cloudConfig.providers[provider] || busy}
              onClick={() => {
                setBusy(true);
                void socialLogin(provider)
                  .catch(() => setMessage("소셜 로그인 연결을 확인해 주세요."))
                  .finally(() => setBusy(false));
              }}
            >
              {provider === "google" ? "Google" : provider === "kakao" ? "Kakao" : "Naver"}{" "}
              {cloudConfig.providers[provider] ? "로그인" : "연결 준비 중"}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={() => enterDemo("office-month-v1")}
        >
          사무직 A · 30일 데모 체험
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => enterDemo("htn-diabetes-v1")}
        >
          고혈압·당뇨 데모 체험
        </button>
      </form>
    </ScenarioShell>
  );
}
export function AuthCallbackPage() {
  const [error, setError] = useState("");
  const active = useSessionStore((s) => s.active);
  const ready = useCloudStore((s) => s.ready);
  const onboarded = useProfileStore((s) => s.onboardingCompleted);
  useEffect(() => {
    void exchangeCallback(location.href).catch(() =>
      setError("로그인 연결에 실패했어요. 다시 로그인해 주세요."),
    );
  }, []);
  if (active && ready) return <Navigate to={onboarded ? "/home" : "/profile"} replace />;
  return (
    <main className="cloud-loading">
      <p>{error || "로그인 결과를 확인하고 있어요…"}</p>
      <Link to="/login">로그인으로</Link>
    </main>
  );
}
