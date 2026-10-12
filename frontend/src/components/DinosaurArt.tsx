import { assets } from "../design/assets";
import { dinosaurs } from "../design/dinosaurs";
import { useGameStore } from "../stores/game-store";
import { getSkin } from "../design/skins";
import type { SkinId } from "../domain/appearance";

const tyrannoPoses = {
  default: assets.dinosaur.imgDino,
  initial: assets["first-result"].imgRectangle1,
  portrait: assets.home.imgDinoPortrait,
  adventure: assets.home.imgDinoIdle,
  reward: assets.reward.imgRectangle,
  buff: assets.buff.imgRectangle1,
  withered: assets.withered.imgRectangle,
};

export function DinosaurArt({
  dinosaur,
  pose = "default",
  className = "",
  alt,
  skin,
}: {
  dinosaur?: number;
  pose?: keyof typeof tyrannoPoses;
  className?: string;
  alt?: string;
  skin?: SkinId;
}) {
  const game = useGameStore((state) => state.game);
  const index = dinosaur ?? game.dinosaur;
  const dino = dinosaurs[index];
  const appearance = getSkin(skin ?? game.dinosaurStyles[index]);
  return (
    <img
      className={`dinosaur-art ${className}`}
      src={index === 0 ? tyrannoPoses[pose] : dino.image}
      alt={alt ?? dino.name}
      data-dinosaur={index}
      data-pose={pose}
      data-skin={appearance.id}
      style={{ filter: appearance.filter }}
    />
  );
}
