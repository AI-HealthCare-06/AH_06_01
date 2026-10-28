import { getSkin, skins } from "../design/skins";
import type { SkinId } from "../domain/appearance";
import { dinosaurs } from "../design/dinosaurs";
import { DinosaurArt } from "./DinosaurArt";
import { LoopCarousel } from "./LoopCarousel";

export function SkinCarousel({
  dinosaur,
  skin,
  onChange,
}: {
  dinosaur: number;
  skin: SkinId;
  onChange: (index: number) => void;
}) {
  const index = skins.findIndex((item) => item.id === skin);
  return (
    <section
      className="vault-skins"
      aria-label={`${dinosaurs[dinosaur].name} 스킨 선택`}
      data-no-swipe
    >
      <LoopCarousel
        index={index}
        resetKey={dinosaur}
        onChange={onChange}
        label="스킨 목록"
        pickerClass="vault-skin-picker"
        gridClass="vault-skin-grid"
        items={skins.map((item) => ({
          id: item.id,
          label: `${dinosaurs[dinosaur].name} ${item.name} 스킨 선택`,
          surface: item.surface,
          content: <DinosaurArt dinosaur={dinosaur} pose="adventure" skin={item.id} alt="" />,
        }))}
      />
      <output className="vault-skin-name" aria-live="polite" aria-label="현재 스킨">
        <strong>{getSkin(skin).name}</strong>
        <small>
          SKIN {index + 1} / {skins.length} · 적용 중
        </small>
      </output>
    </section>
  );
}
