import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { useBloodPressureStore } from "../stores/blood-pressure-store";
import { dailySurveySchema } from "../domain/daily-survey";
import { surveyFixture } from "../domain/daily-survey.test-fixture";
import {
  pressureDraftBase,
  surveyPressureMutations,
  type PressureMutation,
} from "../domain/blood-pressure-history";
import { synchronizePressure, type PressureTransport } from "./blood-pressure-sync";

const owner = "account-A",
  date = "2026-11-02";
const survey = () =>
  dailySurveySchema.parse({
    ...surveyFixture(date),
    bloodPressureStatus: "measured",
    morning: { systolic: 148, diastolic: 94 },
  });
let memory: Map<string, string>;
beforeEach(() => {
  memory = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
  });
  useBloodPressureStore.setState({ owner, records: [], blocked: false, status: "waiting" });
});
afterEach(() => vi.unstubAllGlobals());
const transport = (): PressureTransport => ({
  heads: vi.fn(async () => ({ contract: "bp-history-v1", records: [] })),
  append: vi.fn(async (commands: PressureMutation[]) => ({
    contract: "bp-history-v1",
    acknowledgments: commands.map((c, i) => ({
      mutation_id: c.mutation_id,
      revision: i + 1,
      available_at: "2026-11-02T13:00:00Z",
    })),
  })),
});

describe("durable account-scoped pressure synchronization", () => {
  it("persists before upload, survives account switching and acknowledges only exact command IDs", async () => {
    expect(useBloodPressureStore.getState().recordSurvey(survey())).toBe(true);
    const pending = useBloodPressureStore.getState().records;
    expect(memory.get("rexrun-bp-history-v1:account-A")).toContain(pending[0].command.mutation_id);
    useBloodPressureStore.getState().activate("account-B");
    expect(useBloodPressureStore.getState().records).toEqual([]);
    useBloodPressureStore.getState().activate(owner);
    expect(useBloodPressureStore.getState().records).toEqual(pending);
    await synchronizePressure(owner, transport(), () => true);
    expect(useBloodPressureStore.getState().status).toBe("synced");
    expect(useBloodPressureStore.getState().records[0].revision).toBe(1);
  });
  it("retains the whole pending branch on network, unsupported-server, conflict and incomplete-ack failures", async () => {
    for (const message of ["network", "PGRST202", "BP_MUTATION_CONFLICT"]) {
      useBloodPressureStore.setState({ records: [], status: "waiting" });
      useBloodPressureStore.getState().recordSurvey(survey());
      const t = transport();
      t.append = vi.fn(async () => {
        throw new Error(message);
      });
      await synchronizePressure(owner, t, () => true);
      expect(useBloodPressureStore.getState().status).toBe(
        message === "network" ? "error" : message === "PGRST202" ? "unsupported" : "conflict",
      );
      expect(useBloodPressureStore.getState().records[0].revision).toBeNull();
    }
    const t = transport();
    t.append = vi.fn(async () => ({ contract: "bp-history-v1", acknowledgments: [] }));
    await synchronizePressure(owner, t, () => true);
    expect(useBloodPressureStore.getState().status).toBe("error");
    expect(useBloodPressureStore.getState().records[0].revision).toBeNull();
  });
  it("ignores old-account responses after switching owners", async () => {
    useBloodPressureStore.getState().recordSurvey(survey());
    let complete!: (v: unknown) => void;
    const t = transport();
    t.heads = () =>
      new Promise((r) => {
        complete = r;
      });
    const work = synchronizePressure(owner, t, () => true);
    useBloodPressureStore.getState().activate("account-B");
    complete({ contract: "bp-history-v1", records: [] });
    await work;
    expect(t.append).not.toHaveBeenCalled();
    expect(useBloodPressureStore.getState().owner).toBe("account-B");
    expect(useBloodPressureStore.getState().records).toEqual([]);
  });
  it("imports legacy values once with unknown measurement metadata and actual receipt time", async () => {
    const t = transport();
    await synchronizePressure(owner, t, () => true, { [date]: survey() });
    expect(useBloodPressureStore.getState().records).toHaveLength(1);
    expect(
      useBloodPressureStore.getState().records[0].command.value.metadata.measuredAt,
    ).toBeNull();
    const records = useBloodPressureStore.getState().records;
    t.heads = async () => ({ contract: "bp-history-v1", records });
    await synchronizePressure(owner, t, () => true, { [date]: survey() });
    expect(useBloodPressureStore.getState().records).toHaveLength(1);
    expect(t.append).toHaveBeenCalledTimes(1);
  });
  it("never overwrites a corrupted or full local journal", () => {
    memory.set("rexrun-bp-history-v1:broken", "{broken");
    useBloodPressureStore.getState().activate("broken");
    expect(useBloodPressureStore.getState().recordSurvey(survey())).toBe(false);
    expect(memory.get("rexrun-bp-history-v1:broken")).toBe("{broken");
    useBloodPressureStore.getState().activate("empty");
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(useBloodPressureStore.getState().recordSurvey(survey())).toBe(false);
    expect(useBloodPressureStore.getState().records).toEqual([]);
  });
  it("refuses a stale open draft after a remote edit and permits reopening with the new head", () => {
    const store = useBloodPressureStore;
    store.getState().recordSurvey(survey());
    const base = pressureDraftBase(owner, store.getState().records, date);
    const remote = surveyPressureMutations(store.getState().records, {
      ...survey(),
      morning: { systolic: 136, diastolic: 84 },
    });
    store.getState().mergeRemote(
      owner,
      remote.map((command) => ({ command, revision: 2, available_at: "2026-11-02T13:00:00Z" })),
    );
    const before = store.getState().records;
    expect(store.getState().recordSurvey(survey(), base)).toBe(false);
    expect(store.getState().status).toBe("draft-changed");
    expect(store.getState().records).toEqual(before);
    const reopened = pressureDraftBase(owner, before, date);
    expect(store.getState().recordSurvey(survey(), reopened)).toBe(true);
    expect(store.getState().records.at(-1)?.command.parent_mutation_id).toBe(remote[0].mutation_id);
    store.getState().activate("account-B");
    expect(store.getState().recordSurvey(survey(), reopened)).toBe(false);
  });
});
