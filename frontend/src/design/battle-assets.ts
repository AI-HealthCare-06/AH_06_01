const art = (node: string) => `/assets/battle/${node}.png`;
export type SpriteFrame = readonly [x: number, y: number, width: number, height: number];
// These sheets are hand laid out, not an equal-width grid. Keep the whole pose and
// a shared scale/baseline so crouches, extended horns and effects do not get clipped.
export const attackFrames: Record<string, readonly SpriteFrame[]> = {
  [art("434-578")]: [
    [15, 47, 308, 181],
    [350, 65, 274, 171],
    [658, 106, 306, 133],
    [993, 123, 293, 116],
    [1296, 90, 309, 122],
    [1634, 94, 286, 119],
    [1958, 42, 307, 177],
    [2275, 34, 307, 185],
  ],
  [art("288-700")]: [
    [17, 294, 242, 163],
    [285, 294, 240, 163],
    [539, 331, 278, 127],
    [837, 321, 274, 138],
    [1142, 315, 247, 143],
    [1395, 313, 252, 145],
    [1660, 321, 233, 138],
    [1911, 294, 240, 164],
  ],
  [art("290-697")]: [
    [7, 299, 244, 194],
    [263, 286, 253, 207],
    [510, 339, 294, 154],
    [797, 326, 289, 168],
    [1081, 302, 286, 189],
    [1368, 289, 285, 202],
    [1658, 315, 242, 178],
    [1909, 289, 241, 202],
  ],
  [art("295-697")]: [
    [0, 232, 254, 269],
    [243, 235, 260, 266],
    [445, 284, 299, 219],
    [729, 296, 283, 208],
    [1023, 295, 384, 205],
    [1358, 270, 315, 228],
    [1640, 239, 257, 263],
    [1899, 232, 257, 268],
  ],
  [art("308-697")]: [
    [15, 298, 248, 182],
    [287, 341, 259, 140],
    [552, 346, 228, 135],
    [793, 321, 283, 160],
    [1087, 302, 279, 178],
    [1359, 350, 271, 135],
    [1644, 345, 258, 140],
    [1913, 298, 246, 183],
  ],
};

// Original image fills exported from REXRUN sections 08–11. Node IDs keep the source traceable.
export const stages = [
  { name: "ALPINE DAY", image: art("258-697") },
  { name: "FOREST RUINS", image: art("258-701") },
  { name: "ISLAND COAST", image: art("258-705") },
  { name: "MEADOW VILLAGE", image: art("258-709") },
  { name: "SUNSET KINGDOM", image: art("258-713") },
  { name: "MOONLIT NIGHT", image: art("258-717") },
];
export const battleDinosaurs = [
  { image: art("276-699"), attack: art("290-697"), movement: "stomp" },
  { image: art("276-702"), attack: art("288-700"), movement: "trot" },
  { image: art("276-712"), attack: art("308-697"), movement: "sprint" },
  { image: art("276-705"), attack: null, movement: "waddle" },
  { image: art("276-709"), attack: art("434-578"), movement: "fly" },
  { image: art("276-715"), attack: art("295-697"), movement: "stride" },
];
export const villains = [
  { name: "다크 콜라", image: art("300-700") },
  { name: "하드 캔디", image: art("300-705") },
  { name: "스모키 마시멜로", image: art("300-710") },
  { name: "로튼 버거", image: art("300-715") },
  { name: "아크메이지 팝", image: art("313-694") },
  { name: "닥터 파이어볼", image: art("313-699") },
];
