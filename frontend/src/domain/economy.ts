import { calendarWeek } from "./calendar";
import type { QuestId } from "./game";

export const rpPolicy = { goldPerRp: 100, daily: 150, weekly: 1000, monthly: 4000 };
export const effectCatalog = [
  { id: "original", name: "클래식 타격", price: 0 },
  { id: "emerald", name: "에메랄드 타격", price: 1000 },
  { id: "violet", name: "바이올렛 타격", price: 1500 },
] as const;
export type EffectId = (typeof effectCatalog)[number]["id"];
export type RpEntry = { date: string; amount: number };
export function rpAllowance(entries: readonly RpEntry[], date: string) {
  const week = new Set(calendarWeek(date).map((day) => day.date));
  const used = (predicate: (entry: RpEntry) => boolean) =>
    entries.filter(predicate).reduce((sum, entry) => sum + entry.amount, 0);
  const daily = Math.max(0, rpPolicy.daily - used((entry) => entry.date === date));
  const weekly = Math.max(0, rpPolicy.weekly - used((entry) => week.has(entry.date)));
  const monthly = Math.max(
    0,
    rpPolicy.monthly - used((entry) => entry.date.slice(0, 7) === date.slice(0, 7)),
  );
  return { daily, weekly, monthly, available: Math.min(daily, weekly, monthly) };
}

export const directRewardPolicy = {
  medicine: { gold: 500, daily: 2, cooldown: 0 },
  water: { gold: 300, daily: 4, cooldown: 120 * 60_000 },
  meal: { gold: 500, daily: 3, cooldown: 0 },
} as const;
export type DirectRewardKind = keyof typeof directRewardPolicy;
export type VerificationReceipt = {
  id: string;
  kind: DirectRewardKind;
  date: string;
  at: number;
  scheduleId?: string;
};
// Pure policy only. A trusted server must authenticate the receipt and schedule
// before calling this. A manual check/photo in the demo never calls this function.
export function directRewardGold(
  receipt: VerificationReceipt,
  accepted: readonly VerificationReceipt[],
) {
  const rule = directRewardPolicy[receipt.kind];
  if (accepted.some((item) => item.id === receipt.id)) return 0;
  const today = accepted.filter((item) => item.date === receipt.date && item.kind === receipt.kind);
  if (today.length >= rule.daily) return 0;
  if (
    receipt.kind === "medicine" &&
    (!receipt.scheduleId || today.some((item) => item.scheduleId === receipt.scheduleId))
  )
    return 0;
  const previous = accepted.filter((item) => item.kind === receipt.kind);
  if (previous.some((item) => receipt.at - item.at < rule.cooldown)) return 0;
  return rule.gold;
}
export function directRewardPreview(id: QuestId) {
  return id === "medicine" || id === "meal" || id === "water" ? directRewardPolicy[id].gold : 0;
}
