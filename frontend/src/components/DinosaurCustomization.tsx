import { useState } from "react";
import { dinosaurs } from "../design/dinosaurs";
import { getSkin, skins } from "../design/skins";
import type { SkinId } from "../domain/appearance";
import { useGameStore } from "../stores/game-store";
import { DinosaurArt } from "./DinosaurArt";
import { InfoDialog } from "./InfoDialog";
import { useNotice } from "./NoticeProvider";

export function DinosaurCustomization() {
  const { game, customizeDinosaur } = useGameStore();
  const [preview, setPreview] = useState<{
    dinosaur: number;
    skin: SkinId;
    trigger: HTMLButtonElement;
  } | null>(null);
  const notice = useNotice();
  return (
    <div className="customization-catalog">
      <div className="customization-intro">
        <strong>DINO STYLES</strong>
        <span>무료 스타일</span>
        <p>캐릭터별 스타일을 미리 보고 골라보세요.</p>
      </div>
      {dinosaurs.map((dino, index) => (
        <section
          className="character-collection"
          key={dino.name}
          aria-label={`${dino.name} 꾸미기`}
        >
          <header>
            <DinosaurArt dinosaur={index} alt="" />
            <div>
              <h3>{dino.name}</h3>
              <p>{dino.trait}</p>
            </div>
            {game.dinosaur === index && <span>함께하는 공룡</span>}
          </header>
          <div className="style-grid">
            {skins.map((skin) => {
              const equipped = game.dinosaurStyles[index] === skin.id;
              return (
                <button
                  key={skin.id}
                  className="style-card"
                  data-equipped={equipped}
                  aria-haspopup="dialog"
                  aria-label={`${dino.name} ${skin.name} 스타일 미리보기`}
                  onClick={(event) =>
                    setPreview({ dinosaur: index, skin: skin.id, trigger: event.currentTarget })
                  }
                >
                  <span className="style-art" style={{ backgroundColor: skin.surface }}>
                    <DinosaurArt dinosaur={index} skin={skin.id} alt="" />
                  </span>
                  <strong>{skin.name}</strong>
                  <small>{equipped ? "✓ 적용됨" : "미리보기"}</small>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {preview && (
        <InfoDialog
          title={`${dinosaurs[preview.dinosaur].name} · ${getSkin(preview.skin).name}`}
          returnFocusTo={preview.trigger}
          onClose={() => setPreview(null)}
          confirmLabel="이 스타일로 함께하기"
          onConfirm={() => {
            customizeDinosaur(preview.dinosaur, preview.skin);
            notice(
              `${dinosaurs[preview.dinosaur].name}에게 ${getSkin(preview.skin).name} 스타일을 적용했어요.`,
            );
            setPreview(null);
          }}
        >
          <span
            className="style-preview-scene"
            style={{ backgroundColor: getSkin(preview.skin).surface }}
          >
            <DinosaurArt dinosaur={preview.dinosaur} skin={preview.skin} />
          </span>
          <span className="style-preview-copy">
            선택한 공룡과 스타일로 모험을 이어가요.
            <br />
            기본 제공 스타일이라 코인은 사용하지 않아요.
          </span>
        </InfoDialog>
      )}
    </div>
  );
}
