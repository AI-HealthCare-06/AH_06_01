export function bloodPressureEntry(systolic: string, diastolic: string) {
  if (!/^[1-9]\d{1,2}$/.test(systolic) || !/^[1-9]\d{1,2}$/.test(diastolic)) return null;
  if (Number(systolic) <= Number(diastolic)) return null;
  return systolic + " / " + diastolic;
}
