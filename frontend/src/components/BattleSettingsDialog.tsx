import { useAudioStore } from "../services/game-audio";
import type { GameState } from "../domain/game";
import { useGameStore } from "../stores/game-store";
import { InfoDialog } from "./InfoDialog";

export function BattleSettingsDialog({
  game,
  trigger,
  onClose,
}: {
  game: GameState;
  trigger: HTMLButtonElement;
  onClose: () => void;
}) {
  const audio = useAudioStore();
  const setWaveAutoRestart = useGameStore((state) => state.setWaveAutoRestart);
  const setDisplay = useGameStore((state) => state.setBattleDisplaySetting);
  const settings = [
    {
      title: "배경 음악 BGM",
      enabled: audio.bgm,
      description: "맵별 배경 음악",
      toggle: () => audio.set("bgm", !audio.bgm),
    },
    {
      title: "공격 효과음 SFX",
      enabled: audio.sfx,
      description: "캐릭터·공격 디자인별 효과음",
      toggle: () => audio.set("sfx", !audio.sfx),
    },
    {
      title: "Wave 자동 재시작",
      enabled: game.waveAutoRestart,
      description: game.waveAutoRestart
        ? "실패 후 회복하면 다시 도전해요."
        : "실패 후 직접 재도전해요.",
      toggle: () => setWaveAutoRestart(!game.waveAutoRestart),
    },
    {
      title: "피해 수치 표시",
      enabled: game.showBattleDamage,
      description: "공격 피해와 치명타를 보여줘요.",
      toggle: () => setDisplay("showBattleDamage", !game.showBattleDamage),
    },
    {
      title: "몬스터 체력바 표시",
      enabled: game.showMonsterHealth,
      description: "몬스터의 남은 체력을 표시해요.",
      toggle: () => setDisplay("showMonsterHealth", !game.showMonsterHealth),
    },
  ];
  return (
    <InfoDialog title="게임 설정" onClose={onClose} returnFocusTo={trigger} confirmLabel="닫기">
      <div className="battle-settings">
        {settings.map((setting) => (
          <div className="battle-setting" key={setting.title}>
            <div>
              <h3>{setting.title}</h3>
              <p>
                {setting.enabled ? "ON" : "OFF"} · {setting.description}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-label={setting.title}
              aria-checked={setting.enabled}
              className={setting.enabled ? "enabled" : ""}
              onClick={setting.toggle}
            >
              <span className="pixel-toggle-thumb" aria-hidden="true" />
            </button>
          </div>
        ))}
        <small>설정은 바로 적용되며 이 기기에 저장돼요.</small>
      </div>
    </InfoDialog>
  );
}
