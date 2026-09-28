// UI sample snapshots on a shared 0–100 scale. These are not collected health data.
// Replace both snapshots together when the historical stats API is connected.
export const dinoRadarDemo = {
  axes: ["복약", "식사", "수면", "회복", "걸음", "체력"],
  dayOne: [42, 45, 38, 30, 35, 40],
  today: [90, 78, 58, 70, 69, 67],
} as const;
