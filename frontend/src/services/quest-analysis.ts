import { cloudApi, cloudConfig } from "../cloud/client";
import { questAnalysisSchema } from "../domain/quest-analysis";
import { selectedDemoPersona } from "../domain/demo-personas";
export async function loadQuestAnalysis(demo: boolean, userId?: string) {
  const data = demo
    ? await fetch(
        (import.meta.env.DEV && import.meta.env.VITE_REXRUN_DEMO_MODEL_API_URL
          ? import.meta.env.VITE_REXRUN_DEMO_MODEL_API_URL
          : cloudConfig.apiUrl) + "/predictions/bp-stage",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ demo_persona: selectedDemoPersona().id }),
          signal: AbortSignal.timeout(25_000),
        },
      ).then(async (response) => {
        if (!response.ok) throw new Error("분석 연결을 확인해 주세요.");
        return response.json();
      })
    : await cloudApi("/v1/predictions/bp-stage", { include_m2: true }, userId);
  return questAnalysisSchema.parse(data);
}
