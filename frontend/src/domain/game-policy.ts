// Supplied game/economy documents. Ranged Elite/Boss proposals use their midpoint.
export const stagePolicies = [
  { level: 1, hp: 70, ad: 20, gold: 30 },
  { level: 5, hp: 120, ad: 30, gold: 34 },
  { level: 10, hp: 180, ad: 42, gold: 38 },
  { level: 15, hp: 240, ad: 54, gold: 43 },
  { level: 20, hp: 300, ad: 66, gold: 48 },
] as const;
export const wavePolicies = [
  { count: 30, hp: 1, ad: 1, gold: 1, extra: null },
  { count: 40, hp: 1.05, ad: 1, gold: 1, extra: null },
  { count: 50, hp: 1.1, ad: 1.05, gold: 1.02, extra: null },
  { count: 60, hp: 1.15, ad: 1.05, gold: 1.02, extra: null },
  { count: 70, hp: 1.2, ad: 1.1, gold: 1.04, extra: "elite" },
  { count: 70, hp: 1.25, ad: 1.1, gold: 1.04, extra: null },
  { count: 80, hp: 1.3, ad: 1.15, gold: 1.06, extra: null },
  { count: 90, hp: 1.35, ad: 1.15, gold: 1.06, extra: null },
  { count: 100, hp: 1.4, ad: 1.2, gold: 1.08, extra: null },
  { count: 100, hp: 1.5, ad: 1.25, gold: 1.1, extra: "boss" },
] as const;
export type MonsterRank = "normal" | "elite" | "boss";
export const rankPolicies = {
  normal: { hp: 1, ad: 1, gold: 1, knockback: 0.2 },
  elite: { hp: 2.5, ad: 1.3, gold: 5, knockback: 0.1 },
  boss: { hp: 6.5, ad: 1.5, gold: 15, knockback: 0.05 },
};
export const spawnInterval = 3000;
export const revivalDelay = 10000;
export function characterStats(level: number) {
  const milestone = Math.floor(level / 5);
  return {
    hp: 50 + (level - 1) * 5 + milestone * 10,
    ad: 20 + (level - 1) * 2 + milestone * 3,
    def: 10 + (level - 1) + milestone * 2,
  };
}
export function monsterStats(stage: number, wave: number, rank: MonsterRank = "normal") {
  const main = stagePolicies[stage - 1];
  const sub = wavePolicies[wave - 1];
  const type = rankPolicies[rank];
  return {
    hp: Math.round(main.hp * sub.hp * type.hp),
    ad: main.ad * sub.ad * type.ad,
    knockback: type.knockback,
  };
}
export function monsterGold(stage: number, wave: number, rank: MonsterRank, sleep = 1) {
  return (
    Math.floor(stagePolicies[stage - 1].gold * wavePolicies[wave - 1].gold * sleep) *
    rankPolicies[rank].gold
  );
}
export function incomingDamage(ad: number, def: number, reduction: number) {
  return Math.max(ad - def, ad * 0.1) * (1 - reduction);
}
export function sleepGoldMultiplier(hours: number | null) {
  return hours === null
    ? 1
    : hours < 4
      ? 0.8
      : hours < 5
        ? 0.9
        : hours < 7
          ? 1
          : hours < 8
            ? 1.1
            : 1.2;
}
export function hydrationPenalty(ratio: number | null) {
  return ratio === null || ratio >= 0.75 ? 0 : ratio >= 0.5 ? 0.1 : ratio >= 0.25 ? 0.2 : 0.3;
}
