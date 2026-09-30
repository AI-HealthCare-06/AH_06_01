export function experienceProgress(totalExperience: number) {
  let current = Math.max(0, Math.floor(totalExperience));
  let level = 1;
  let required = 100;
  while (current >= required) {
    current -= required;
    level++;
    required = Math.floor(required * 1.22);
  }
  return { level, current, required };
}

export function questExperience(base: number, total: number, repeat = false) {
  const { level } = experienceProgress(total);
  const multiplier = level < 5 ? 1 : level < 10 ? 1.5 : level < 15 ? 2.25 : 3.375;
  return Math.floor(base * multiplier * (repeat ? 0.1 : 1));
}

export function experienceForLevel(level: number) {
  let total = 0;
  let required = 100;
  for (let current = 1; current < Math.max(1, Math.min(100, Math.floor(level))); current++) {
    total += required;
    required = Math.floor(required * 1.22);
  }
  return total;
}

export function levelUpGold(before: number, after: number) {
  const first = experienceProgress(before).level;
  const last = experienceProgress(after).level;
  return ((last * (last + 1) - first * (first + 1)) / 2) * 500;
}
