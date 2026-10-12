import type { SkinId } from "../domain/appearance";

export const skins: { id: SkinId; name: string; filter: string; surface: string }[] = [
  { id: "original", name: "오리지널", filter: "none", surface: "#e8e1bf" },
  {
    id: "forest",
    name: "숲의 수호자",
    filter: "sepia(.8) saturate(1.6) hue-rotate(40deg)",
    surface: "#d5e2b9",
  },
  {
    id: "ocean",
    name: "바다 탐험가",
    filter: "sepia(1) saturate(2.5) hue-rotate(145deg)",
    surface: "#c6e3e9",
  },
  {
    id: "sunset",
    name: "노을 모험가",
    filter: "sepia(.9) saturate(2.2) hue-rotate(320deg)",
    surface: "#f5cfac",
  },
  {
    id: "violet",
    name: "보랏빛 꿈",
    filter: "sepia(1) saturate(2) hue-rotate(215deg)",
    surface: "#ded1ee",
  },
  { id: "gold", name: "황금빛 용사", filter: "sepia(1) saturate(2.4)", surface: "#f1df9b" },
];

export function getSkin(id: SkinId) {
  return skins.find((skin) => skin.id === id) ?? skins[0];
}
