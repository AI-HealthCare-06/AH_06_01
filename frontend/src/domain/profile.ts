import { z } from "zod";

export const profileSchema = z.object({
  age: z.coerce.number().int().min(1, "나이를 확인해 주세요.").max(120),
  sex: z.enum(["female", "male"]),
  height: z.coerce.number().min(50, "키를 확인해 주세요.").max(250),
  weight: z.coerce.number().min(1, "몸무게를 확인해 주세요.").max(500),
  bloodPressure: z
    .string()
    .regex(/^\d{2,3}\s*\/\s*\d{2,3}$/, "혈압은 120 / 80 형식으로 입력해 주세요."),
  glucose: z.coerce.number().positive("혈당을 확인해 주세요.").max(1000),
  smoking: z.boolean(),
  hypertensionFamily: z.boolean(),
  diabetesFamily: z.boolean(),
});
export type HealthProfile = z.infer<typeof profileSchema>;
export const initialProfile: HealthProfile = {
  age: 45,
  sex: "female",
  height: 165,
  weight: 68,
  bloodPressure: "120 / 80",
  glucose: 104,
  smoking: false,
  hypertensionFamily: true,
  diabetesFamily: false,
};
export function bmi(height: number, weight: number) {
  return height > 0 && weight > 0 ? (weight / (height / 100) ** 2).toFixed(1) : "—";
}
