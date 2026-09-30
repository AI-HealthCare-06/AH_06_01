export const skinIds = [
  "original",
  "forest",
  "ocean",
  "sunset",
  "violet",
  "gold",
  "desert",
  "snow",
  "volcano",
] as const;
export type SkinId = (typeof skinIds)[number];

export function defaultDinosaurStyles(): SkinId[] {
  return Array.from({ length: 6 }, () => "original");
}
