import { useQuery } from "@tanstack/react-query";
import { demoMode } from "../domain/demo-mode";
import { cloudEnabled } from "../cloud/client";
import { useCloudStore } from "../cloud/sync";
import { useProfileStore } from "../stores/profile-store";
import { useMedicationStore } from "../stores/medication-store";
import { useGameStore } from "../stores/game-store";
import { healthSnapshotKey } from "../domain/bp-stage";
import { loadQuestAnalysis } from "./quest-analysis";
import { demoAnalysisInputKey } from "../domain/demo-analysis-input";
import { selectedDemoPersona } from "../domain/demo-personas";
export function useQuestAnalysis() {
  const cloud = useCloudStore();
  const { profile, hasProfileInput } = useProfileStore();
  const medications = useMedicationStore((s) => s.medications);
  const date = useGameStore((s) => s.game.date);
  const dailySurveys = useGameStore((s) => s.game.dailySurveys);
  const key = healthSnapshotKey(hasProfileInput ? profile : undefined, medications, {
    date,
    dailySurveys,
  });
  const ready =
    demoMode ||
    (cloudEnabled &&
      cloud.ready &&
      !!cloud.userId &&
      cloud.consent &&
      key !== null &&
      key === cloud.healthSnapshotKey &&
      !cloud.healthSyncPending);
  const query = useQuery({
    queryKey: [
      "quest-analysis",
      demoMode ? "synthetic-demo" : cloud.userId,
      key,
      date,
      demoMode && selectedDemoPersona().id === "studio-quarter-v1"
        ? demoAnalysisInputKey(profile, medications, { date, dailySurveys })
        : null,
    ],
    queryFn: () => loadQuestAnalysis(demoMode, cloud.userId ?? undefined),
    enabled: ready,
    staleTime: 300_000,
    gcTime: 0,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  return { ...query, ready, data: ready ? query.data : undefined };
}
