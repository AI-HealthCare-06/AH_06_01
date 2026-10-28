import { chronicConditions, conditionLabel, type HealthProfile } from "../domain/profile";
import type { Medication } from "../domain/medications";

const comorbidities = new Set([
  "diabetes",
  "ckd",
  "stroke_tia",
  "cad_mi",
  "heart_failure",
  "afib",
  "osa",
  "parkinson",
  "thyroid",
]);
// Export field names; account-scoped cloud sync also preserves the original answers in details.
export function healthProfilePayload(profile: HealthProfile, medications: Medication[]) {
  const active = medications.filter((med) => med.active);
  return {
    name: profile.name,
    age: profile.age,
    sex: profile.sex,
    height_cm: profile.height,
    weight_kg: profile.weight,
    fasting_glucose: profile.glucose,
    condition_status: profile.conditions.length ? "selected" : (profile.conditionStatus ?? "none"),
    waist_cm: profile.waistCm ?? null,
    resting_hr: profile.restingHeartRate ?? null,
    education_years: profile.educationYears ?? null,
    alcohol_week: profile.alcoholDays === 0 ? 0 : (profile.alcoholWeek ?? null),
    binge: profile.alcoholDays === 0 ? false : (profile.bingeMonthly ?? null),
    htn_status: profile.htnStatus === "unknown" ? null : profile.htnStatus,
    pregnancy_status: profile.pregnancyStatus === "unknown" ? null : profile.pregnancyStatus,
    comorbidity_codes: profile.conditions.filter((code) => comorbidities.has(code)),
    other_condition_names: profile.conditions
      .filter((code) => !comorbidities.has(code) && code !== "hypertension")
      .map(conditionLabel),
    rare_condition_names: profile.conditions.filter(
      (code) => !chronicConditions.some(([key]) => key === code),
    ),
    special_history: profile.specialHistory,
    family_history_codes: [
      ...new Set([
        ...profile.familyHistory,
        ...(profile.hypertensionFamily === true ? ["hypertension"] : []),
        ...(profile.diabetesFamily === true ? ["diabetes"] : []),
      ]),
    ],
    smoking_current: profile.smoking,
    alcohol_days_per_week: profile.alcoholDays,
    sleep_hours: profile.sleepHours,
    active_minutes_week: profile.activeMinutesWeek,
    medications: active.flatMap((med) =>
      med.times.map((time) => ({
        medication_id: med.id,
        name: med.name,
        dose: med.dose,
        drug_class: med.drugClass,
        schedule_time: time,
      })),
    ),
    // A raw onboarding measurement must never masquerade as a 7-day average.
    onboarding_bp_text: profile.bloodPressure,
  };
}
