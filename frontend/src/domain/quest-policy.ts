// Daily verified actions drive growth. Extra medication never grants a repeat reward.
export const questRewards = {
  survey: { experience: 100, gold: 150, maxActivities: 1 },
  medicine: { experience: 80, gold: 150, maxActivities: 1 },
  meal: { experience: 120, gold: 200, maxActivities: 3 },
  walk: { experience: 180, gold: 300, maxActivities: 1 },
  water: { experience: 100, gold: 150, maxActivities: 2 },
  sleep: { experience: 140, gold: 250, maxActivities: 1 },
} as const;
export const questConditions = {
  survey:
    "오늘의 혈압·맥박·수면 질문에 답하고 제출해요. 미측정·모름도 기록하며 수치의 높고 낮음은 완료 조건이 아니에요.",
  medicine: "오늘 등록된 모든 복약·투약 시간의 사진 인증과 복용 기록을 완료해요.",
  meal: "직접 촬영한 식사 사진 한 장을 확인하고 완료해요. 음식의 종류·영양은 판정하지 않아요.",
  walk: "건강 앱에서 읽은 오늘의 걸음 수가 6,000보에 도달하면 자동 완료돼요.",
  water:
    "실제 카메라에서 물 마시는 동작 한 번을 인식·확인하고 완료해요. 잔 수·섭취량은 측정하지 않아요.",
  sleep:
    "별도 메인 퀘스트가 아니에요. 오늘의 건강 서베이에 취침·기상 시각을 기록하면 수면 보너스 EXP를 받아요.",
} as const;
export const questEffects = {
  survey: "하루 1회 EXP·골드 보상 · 전투 버프 없음 · 수정 시 추가 보상 없음",
  medicine: "모든 복약 일정 완료 시 공격력 +10% · 하루 1회",
  meal: "받는 피해 −20%/인증 · 하루 최대 3회, −60%",
  walk: "8,000보부터 2,000보마다 치명타 +20% · 최대 100%",
  water: "동작 인증 시 공격속도 +40% · 120분 간격, 하루 최대 2회 +80%",
  sleep: "서베이 수면 기록으로 시간당 기본 20 EXP · 하루 최대 기본 160 EXP",
} as const;
export const allQuestsGoldBonus = 200;
