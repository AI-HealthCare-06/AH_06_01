import { useState } from "react";
import { useGameStore } from "../stores/game-store";
import { effectCatalog, rpAllowance, rpPolicy } from "../domain/economy";
import { InfoDialog } from "./InfoDialog";
import { useNotice } from "./NoticeProvider";

export function GameWallet({
  onClose,
  returnFocusTo,
}: {
  onClose: () => void;
  returnFocusTo: HTMLElement | null;
}) {
  const { game, convertRp } = useGameStore();
  const [amount, setAmount] = useState("1");
  const notice = useNotice();
  const allowance = rpAllowance(game.rpLedger, game.date);
  const maximum = Math.min(Math.floor(game.gold / rpPolicy.goldPerRp), allowance.available);
  const requested = Number(amount);
  const valid = Number.isSafeInteger(requested) && requested > 0 && requested <= maximum;
  return (
    <InfoDialog
      title="GAME WALLET"
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      confirmLabel="닫기"
    >
      <section className="economy-wallet" aria-label="게임 재화 지갑">
        <small>데모 · 실제 지급 없음</small>
        <dl>
          <div>
            <dt>GOLD</dt>
            <dd>{game.gold.toLocaleString()}</dd>
            <small>전투 · 레벨업 보상</small>
          </div>
          <div>
            <dt>RP</dt>
            <dd>{game.rp.toLocaleString()}</dd>
            <small>현실 리워드용</small>
          </div>
        </dl>
        <h4>100 GOLD → 1 RP</h4>
        <p>
          남은 전환 한도 · 오늘 {allowance.daily} / 이번 주 {allowance.weekly.toLocaleString()} /
          이번 달 {allowance.monthly.toLocaleString()} RP
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) {
              convertRp(requested);
              notice(`데모 ${requested} RP로 전환했어요.`);
            }
          }}
        >
          <label>
            전환 RP
            <input
              type="number"
              inputMode="numeric"
              min="1"
              max={maximum || 1}
              step="1"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <button type="submit" disabled={!valid}>
            데모 RP 전환
          </button>
        </form>
        <div className="conversion-presets">
          <button type="button" disabled={maximum === 0} onClick={() => setAmount("1")}>
            최소
          </button>
          <button type="button" disabled={maximum === 0} onClick={() => setAmount(String(maximum))}>
            최대
          </button>
        </div>
        <small>
          현재 최대 {maximum} RP · 일 150 / 주 1,000 / 월 4,000 RP. 실제 상품 교환과 인증 보상은
          서버 연동 후 제공됩니다.
        </small>
      </section>
    </InfoDialog>
  );
}

export function GoldEffects() {
  const { game, buyEffect } = useGameStore();
  return (
    <div className="gold-effects">
      <h4>GOLD 꾸미기 · 타격 이펙트</h4>
      <p>전투 능력치는 바뀌지 않아요.</p>
      {effectCatalog.map((effect) => {
        const owned = game.ownedEffects.includes(effect.id);
        return (
          <button
            key={effect.id}
            data-effect={effect.id}
            aria-pressed={game.battleEffect === effect.id}
            disabled={!owned && game.gold < effect.price}
            onClick={() => buyEffect(effect.id)}
          >
            {effect.name}
            <small>
              {game.battleEffect === effect.id
                ? "적용 중"
                : owned
                  ? "적용하기"
                  : `${effect.price.toLocaleString()} G`}
            </small>
          </button>
        );
      })}
    </div>
  );
}
