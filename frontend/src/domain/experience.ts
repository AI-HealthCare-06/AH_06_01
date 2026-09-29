// Continue the demo's existing level. Quest EXP remains cumulative across days.
export const startingLevel = 12;
export const experiencePerLevel = 300;

export function experienceProgress(totalExperience: number) {
  return {
    level: startingLevel + Math.floor(totalExperience / experiencePerLevel),
    current: totalExperience % experiencePerLevel,
    required: experiencePerLevel,
  };
}
