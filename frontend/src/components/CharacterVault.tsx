import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { dinosaurs } from "../design/dinosaurs";
import { accessories } from "../design/accessories";
import { skins } from "../design/skins";
import { experienceProgress } from "../domain/experience";
import { useGameStore } from "../stores/game-store";
import { DinosaurArt } from "./DinosaurArt";
import { EquippedAccessories } from "./AccessoryCatalog";
import { SkinCarousel } from "./SkinCarousel";
import { LoopCarousel } from "./LoopCarousel";
import { OwnedEquipmentDialog } from "./OwnedEquipmentDialog";

export function CharacterVault() {
  const { game, chooseDinosaur, customizeDinosaur } = useGameStore();
  const [params, setParams] = useSearchParams();
  const [equipment, setEquipment] = useState<{
    kind: "head" | "pet" | "all";
    trigger?: HTMLButtonElement;
  } | null>(() => (params.get("tab") === "accessories" ? { kind: "all" } : null));
  const selected = game.dinosaur;
  const skin = game.dinosaurStyles[selected];
  const dino = dinosaurs[selected];
  const level = experienceProgress(game.experience).level;
  return (
    <section className="character-vault" aria-label="공룡 보관소">
      <header className="vault-heading">
        <div>
          <h2>DINO VAULT</h2>
          <p>나만의 공룡, 나만의 모험</p>
        </div>
      </header>
      <div className="vault-scroll" tabIndex={0} aria-label="공룡과 외형 선택">
        <section className="vault-dinosaurs cream-card" aria-label="공룡 변경">
          <LoopCarousel
            index={selected}
            resetKey="dinosaurs"
            onChange={chooseDinosaur}
            label="공룡 선택"
            pickerClass="vault-dino-picker"
            gridClass="vault-dino-grid vault-roster"
            items={dinosaurs.map((item, i) => ({
              id: String(i),
              label: `${item.name} 선택`,
              content: (
                <>
                  <DinosaurArt dinosaur={i} pose="portrait" skin={game.dinosaurStyles[i]} alt="" />
                  <span>{item.name}</span>
                </>
              ),
            }))}
          />
        </section>
        <section className="vault-hero cream-card" aria-label="선택한 공룡 미리보기">
          <header className="vault-hero-heading">
            <div>
              <span className="vault-level">Lv.{level}</span>
              <h3>{dino.name}</h3>
            </div>
            <small>✓ 함께하는 공룡</small>
          </header>
          <div className="vault-hero-stage">
            {(["head", "pet"] as const).map((kind) => {
              const item = accessories.find((item) => item.id === game.equippedAccessories[kind]);
              return (
                <button
                  type="button"
                  key={kind}
                  className={`vault-equipment-slot vault-slot-${kind}`}
                  aria-haspopup="dialog"
                  aria-label={`${kind === "head" ? "머리 장식" : "동물 동반"} 관리${item ? ` · ${item.name}` : " · 미장착"}`}
                  onClick={(event) => setEquipment({ kind, trigger: event.currentTarget })}
                >
                  <small>{kind === "head" ? "HEAD" : "PET"}</small>
                  {item ? <img src={item.image} alt="" /> : <span aria-hidden="true">+</span>}
                  <b>{item ? "장착 중" : kind === "head" ? "머리 장식" : "동물 동반"}</b>
                </button>
              );
            })}
            <div className="character-equipped-preview">
              <DinosaurArt dinosaur={selected} pose="adventure" skin={skin} />
              <EquippedAccessories />
            </div>
          </div>
          <SkinCarousel
            dinosaur={selected}
            skin={skin}
            onChange={(index) =>
              customizeDinosaur(selected, skins[(index + skins.length) % skins.length].id)
            }
          />
        </section>
      </div>
      {equipment && (
        <OwnedEquipmentDialog
          kind={equipment.kind}
          trigger={equipment.trigger}
          onClose={() => {
            setEquipment(null);
            if (params.has("tab")) {
              const next = new URLSearchParams(params);
              next.delete("tab");
              setParams(next, { replace: true });
            }
          }}
        />
      )}
    </section>
  );
}
