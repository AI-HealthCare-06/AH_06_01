const art = (node: string) => `/assets/battle/${node}.png`;

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
  { image: art("276-699"), attack: art("290-697"), y: 285, height: 215, movement: "stomp" },
  { image: art("276-702"), attack: art("288-700"), y: 280, height: 195, movement: "trot" },
  { image: art("276-712"), attack: art("308-697"), y: 295, height: 195, movement: "sprint" },
  { image: art("276-705"), attack: null, y: 0, height: 0, movement: "waddle" },
  { image: art("276-709"), attack: null, y: 0, height: 0, movement: "fly" },
  { image: art("276-715"), attack: art("295-697"), y: 235, height: 275, movement: "stride" },
];
export const villains = [
  { name: "다크 콜라", image: art("300-700") },
  { name: "하드 캔디", image: art("300-705") },
  { name: "스모키 마시멜로", image: art("300-710") },
  { name: "로튼 버거", image: art("300-715") },
  { name: "아크메이지 팝", image: art("313-694") },
  { name: "닥터 파이어볼", image: art("313-699") },
];
