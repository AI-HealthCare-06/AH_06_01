import { z } from "zod";
import {
  pressureDate,
  pressureRevisionSchema,
  type PressureMutation,
} from "../domain/blood-pressure-history";
import type { DailySurvey } from "../domain/daily-survey";
import { useBloodPressureStore, type PressureSyncStatus } from "../stores/blood-pressure-store";

export type PressureTransport = {
  heads: (cursor: string) => Promise<unknown>;
  append: (commands: PressureMutation[]) => Promise<unknown>;
};
const headsSchema = z.object({
  contract: z.literal("bp-history-v1"),
  records: z.array(pressureRevisionSchema),
});
const ackSchema = z.object({
  contract: z.literal("bp-history-v1"),
  acknowledgments: z.array(
    z.object({
      mutation_id: z.uuid(),
      revision: z.number().int().positive(),
      available_at: z.string().refine((v) => Number.isFinite(Date.parse(v))),
    }),
  ),
});
export function pressureFailureStatus(error: unknown): PressureSyncStatus {
  const message = error instanceof Error ? error.message : "";
  if (/BP_MUTATION_CONFLICT|BP_MUTATION_ID_REUSE/.test(message)) return "conflict";
  if (/BP_CONSENT_REQUIRED|BP_PROFILE_REQUIRED/.test(message)) return "consent";
  if (/PGRST202|42883|BP_UNSUPPORTED/.test(message)) return "unsupported";
  return "error";
}

export async function synchronizePressure(
  owner: string,
  transport: PressureTransport,
  current: () => boolean,
  surveys: Record<string, DailySurvey> = {},
) {
  const store = useBloodPressureStore;
  const valid = () => current() && store.getState().owner === owner && !store.getState().blocked;
  if (!valid()) return;
  store.setState({ status: "syncing" });
  try {
    let cursor = "";
    for (let page = 0; ; page++) {
      if (page >= 100) throw new Error("BP_HISTORY_PAGE_LIMIT");
      const response = headsSchema.parse(await transport.heads(cursor));
      if (!valid()) return;
      if (
        response.records.some(
          (r) => r.revision === null || r.available_at === null || r.command.entry_key <= cursor,
        )
      )
        throw new Error("BP_INVALID_HEAD_PAGE");
      store.getState().mergeRemote(owner, response.records);
      if (response.records.length < 200) break;
      const next = response.records.at(-1)!.command.entry_key;
      if (next <= cursor) throw new Error("BP_INVALID_CURSOR");
      cursor = next;
    }
    // Import only legacy slots that have no journal head. Their original date
    // is retained; first server receipt is now, never an invented past time.
    const keys = new Set(store.getState().records.map((r) => r.command.entry_key));
    for (const [date, survey] of Object.entries(surveys)) {
      if (!valid()) return;
      if (survey.date !== date || date > pressureDate(new Date())) continue;
      const missing = (["morning", "evening"] as const).filter(
        (slot) => survey[slot] && !keys.has(`survey:${survey.date}:${slot}`),
      );
      if (!missing.length) continue;
      // Build missing commands without modifying slots already present.
      if (!store.getState().importLegacySlots(survey, missing))
        throw new Error("BP_LOCAL_STORAGE_FAILED");
    }
    while (valid()) {
      const pending = store
        .getState()
        .records.filter((r) => r.revision === null)
        .slice(0, 50);
      if (!pending.length) break;
      const response = ackSchema.parse(await transport.append(pending.map((r) => r.command)));
      if (!valid()) return;
      const requested = new Set(pending.map((r) => r.command.mutation_id));
      const returned = new Set(response.acknowledgments.map((r) => r.mutation_id));
      if (
        returned.size !== pending.length ||
        response.acknowledgments.length !== pending.length ||
        [...returned].some((id) => !requested.has(id))
      )
        throw new Error("BP_INVALID_ACK");
      store.getState().acknowledge(owner, response.acknowledgments);
    }
    if (valid()) store.setState({ status: "synced" });
  } catch (error) {
    if (valid()) store.setState({ status: pressureFailureStatus(error) });
  }
}
