import { create } from "zustand";
import { z } from "zod";
import { appStorageKey, demoMode } from "../domain/demo-mode";
import {
  mergePressureHeads,
  pressureDraftBase,
  pressureRevisionSchema,
  surveyPressureMutations,
  type PressureRevision,
  type PressureDraftBase,
} from "../domain/blood-pressure-history";
import type { DailySurvey } from "../domain/daily-survey";

export type PressureSyncStatus =
  | "local"
  | "waiting"
  | "syncing"
  | "synced"
  | "consent"
  | "unsupported"
  | "conflict"
  | "draft-changed"
  | "error";
const schema = z.object({ version: z.literal(1), records: z.array(pressureRevisionSchema) });
const storageKey = (owner: string) => appStorageKey(`rexrun-bp-history-v1:${owner}`);
const initialOwner = demoMode ? "demo" : "local";
function read(owner: string): { records: PressureRevision[]; blocked: boolean } {
  try {
    const raw = localStorage.getItem(storageKey(owner));
    if (raw === null) return { records: [], blocked: false };
    const value = schema.safeParse(JSON.parse(raw));
    return value.success
      ? { records: value.data.records, blocked: false }
      : { records: [], blocked: true };
  } catch {
    return { records: [], blocked: true };
  }
}
function persist(owner: string, records: PressureRevision[]) {
  localStorage.setItem(storageKey(owner), JSON.stringify({ version: 1, records }));
}
export const pressureStatusText: Record<PressureSyncStatus, string> = {
  local: "측정 이력은 이 기기에 저장돼요.",
  waiting: "측정 이력 서버 저장 대기",
  syncing: "측정 이력 저장 중",
  synced: "측정 이력 서버 저장 완료",
  consent: "서버 저장에는 건강 정보 저장 동의가 필요해요.",
  unsupported: "측정 이력은 기기에 보관 중이에요. 서버 기능 연결을 기다리고 있어요.",
  conflict: "다른 기기의 측정 수정과 겹쳐 업로드를 보류했어요. 입력은 기기에 보관돼요.",
  "draft-changed": "측정 기록이 갱신됐어요. 서베이를 다시 열어 최신 기록을 확인해 주세요.",
  error: "측정 이력 서버 저장 재시도 대기 · 입력은 기기에 보관돼요.",
};
export const useBloodPressureStore = create<{
  owner: string;
  records: PressureRevision[];
  blocked: boolean;
  status: PressureSyncStatus;
  activate: (owner: string) => void;
  recordSurvey: (survey: DailySurvey, baseline?: PressureDraftBase) => boolean;
  importLegacySlots: (survey: DailySurvey, slots: Array<"morning" | "evening">) => boolean;
  mergeRemote: (owner: string, remote: PressureRevision[]) => void;
  acknowledge: (
    owner: string,
    acknowledgments: Array<{ mutation_id: string; revision: number; available_at: string }>,
  ) => void;
}>((set, get) => ({
  owner: initialOwner,
  ...read(initialOwner),
  status: "local",
  activate: (owner) => {
    if (owner === get().owner) return;
    const loaded = read(owner);
    set({
      owner,
      ...loaded,
      status: loaded.blocked
        ? "error"
        : owner === "local" || owner === "demo"
          ? "local"
          : "waiting",
    });
  },
  recordSurvey: (survey, baseline) => {
    const state = get();
    if (state.blocked) {
      set({ status: "error" });
      return false;
    }
    const currentBase = pressureDraftBase(state.owner, state.records, survey.date);
    if (
      baseline &&
      (["owner", "date", "morning", "evening"] as const).some(
        (key) => baseline[key] !== currentBase[key],
      )
    ) {
      set({ status: "draft-changed" });
      return false;
    }
    const commands = surveyPressureMutations(state.records, survey);
    if (!commands.length) return true;
    const records = [
      ...state.records,
      ...commands.map((command) => ({ command, revision: null, available_at: null })),
    ];
    try {
      persist(state.owner, records);
    } catch {
      set({ status: "error" });
      return false;
    }
    set({ records, status: ["local", "demo"].includes(state.owner) ? "local" : "waiting" });
    return true;
  },
  importLegacySlots: (survey, slots) => {
    const state = get();
    if (state.blocked) return false;
    const commands = surveyPressureMutations(state.records, {
      ...survey,
      bloodPressureDetails: undefined,
    }).filter((c) => slots.includes(c.value.slot));
    if (!commands.length) return true;
    const records = [
      ...state.records,
      ...commands.map((command) => ({ command, revision: null, available_at: null })),
    ];
    try {
      persist(state.owner, records);
    } catch {
      set({ status: "error" });
      return false;
    }
    set({ records, status: "waiting" });
    return true;
  },
  mergeRemote: (owner, remote) => {
    const state = get();
    if (owner !== state.owner || state.blocked) return;
    const records = mergePressureHeads(state.records, remote);
    persist(owner, records);
    set({ records });
  },
  acknowledge: (owner, acknowledgments) => {
    const state = get();
    if (owner !== state.owner || state.blocked) return;
    const byId = new Map(acknowledgments.map((a) => [a.mutation_id, a]));
    const records = state.records.map((r) => {
      const ack = byId.get(r.command.mutation_id);
      return ack
        ? pressureRevisionSchema.parse({
            ...r,
            revision: ack.revision,
            available_at: ack.available_at,
          })
        : r;
    });
    persist(owner, records);
    set({ records, status: records.some((r) => r.revision === null) ? "waiting" : "synced" });
  },
}));
