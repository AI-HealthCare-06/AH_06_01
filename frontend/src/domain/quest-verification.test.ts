import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../cloud/client", () => ({ cloudEnabled: false }));
import { selfReportedSleepMinutes, validQuestProof, type QuestProof } from "./quest-verification";
import { useQuestVerificationStore as verification } from "../stores/quest-verification-store";
import { useSessionStore } from "../stores/session-store";
import type { MotionResult } from "../features/motion-capture/types";

const image = "data:image/jpeg;base64," + "A".repeat(200);
describe("quest evidence requirements", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T09:00:00"));
    useSessionStore.setState({ active: true });
    verification.getState().reset();
  });
  afterEach(() => vi.useRealTimers());
  it("requires a fresh photo tied to the exact medication dose", () => {
    const dose = "2026-10-22|a|09:00";
    expect(verification.getState().photo("medicine", image, Date.now(), dose)).toBe(true);
    const proof = verification.getState().proofs.medicine;
    expect(validQuestProof(proof, "medicine", Date.now(), dose)).toBe(true);
    expect(validQuestProof(proof, "medicine", Date.now(), "2026-10-22|a|18:00")).toBe(false);
    expect(verification.getState().consume("medicine", dose)).toBe(true);
    expect(verification.getState().consume("medicine", dose)).toBe(false);
    expect(verification.getState().photo("medicine", image, Date.now(), dose)).toBe(false);
  });
  it("rejects empty photos, expired receipts, future dates and yesterday's evidence", () => {
    expect(verification.getState().photo("meal", "", Date.now())).toBe(false);
    verification.getState().photo("meal", image, Date.now());
    const proof = verification.getState().proofs.meal!;
    expect(validQuestProof(proof, "meal", Date.now() - 1)).toBe(false);
    vi.advanceTimersByTime(31 * 60_000);
    expect(validQuestProof(proof, "meal")).toBe(false);
    expect(validQuestProof({ ...proof, verifiedAt: Date.now(), date: "2026-10-21" }, "meal")).toBe(
      false,
    );
  });
  it("only accepts confirmed real camera motion, never sample or inconclusive results", () => {
    const result = {
      questId: "water",
      inputSource: "sample",
      decision: "detected",
      userConfirmed: true,
      eventId: "event-1",
      endedAt: new Date().toISOString(),
      validObservationRatio: 1,
      detector: "rules_v1",
      verificationLevel: "local_demo",
    } as MotionResult;
    expect(verification.getState().motion(result)).toBe(false);
    expect(
      verification
        .getState()
        .motion({ ...result, inputSource: "camera", decision: "inconclusive" }),
    ).toBe(false);
    expect(
      verification.getState().motion({ ...result, inputSource: "camera", userConfirmed: false }),
    ).toBe(false);
    // A successful experimental camera process is not an approved quest receipt.
    for (const fields of [
      { detector: "process_rules_v2" as const },
      { detector: "injection_rules_v1" as const },
      { verificationLevel: "experimental_process" as const },
    ]) {
      expect(verification.getState().motion({ ...result, inputSource: "camera", ...fields })).toBe(
        false,
      );
      expect(verification.getState().proofs).toEqual({});
    }
    expect(verification.getState().motion({ ...result, inputSource: "camera" })).toBe(true);
    expect(verification.getState().consume("water")).toBe(true);
    expect(verification.getState().motion({ ...result, inputSource: "camera" })).toBe(false);
  });
  it("requires seven measured hours from the health store", () => {
    verification.getState().sleep(419, "health-connect", "2026-10-22");
    expect(validQuestProof(verification.getState().proofs.sleep, "sleep")).toBe(false);
    verification.getState().sleep(420, "health-connect", "2026-10-22");
    expect(validQuestProof(verification.getState().proofs.sleep, "sleep")).toBe(true);
    const proof = { ...verification.getState().proofs.sleep, source: "camera-photo" } as QuestProof;
    expect(validQuestProof(proof, "sleep")).toBe(false);
  });
  it.each([
    ["", "0"],
    ["7.5", "0"],
    ["-1", "0"],
    ["7", "60"],
    ["25", "0"],
    ["24", "1"],
    ["0", "0"],
    ["7", ""],
    ["7", "0.5"],
    ["Infinity", "0"],
  ])("rejects invalid self-reported sleep: %s hours %s minutes", (hours, minutes) => {
    expect(selfReportedSleepMinutes(hours, minutes)).toBeNull();
    expect(verification.getState().selfReportSleep(hours, minutes, true, "2026-10-22")).toBe(false);
  });
  it("requires explicit confirmation and today's active session for self reports", () => {
    expect(verification.getState().selfReportSleep("7", "0", false, "2026-10-22")).toBe(false);
    expect(verification.getState().selfReportSleep("7", "0", true, "2026-10-21")).toBe(false);
    expect(verification.getState().selfReportSleep("7", "0", true, "2026-10-23")).toBe(false);
    useSessionStore.setState({ active: false });
    expect(verification.getState().selfReportSleep("7", "0", true, "2026-10-22")).toBe(false);
    expect(verification.getState().proofs.sleep).toBeUndefined();
  });
  it("keeps the seven-hour boundary, self-report source, expiry and one-time consumption", () => {
    expect(verification.getState().selfReportSleep("6", "59", true, "2026-10-22")).toBe(true);
    expect(validQuestProof(verification.getState().proofs.sleep, "sleep")).toBe(false);
    expect(verification.getState().selfReportSleep("7", "15", true, "2026-10-22")).toBe(true);
    expect(verification.getState().proofs.sleep).toMatchObject({
      source: "self-report",
      minutes: 435,
    });
    expect(validQuestProof(verification.getState().proofs.sleep, "sleep")).toBe(true);
    expect(verification.getState().consume("sleep")).toBe(true);
    expect(verification.getState().consume("sleep")).toBe(false);
    verification.getState().selfReportSleep("24", "0", true, "2026-10-22");
    expect(validQuestProof(verification.getState().proofs.sleep, "sleep")).toBe(true);
    vi.advanceTimersByTime(31 * 60_000);
    expect(validQuestProof(verification.getState().proofs.sleep, "sleep")).toBe(false);
  });
  it("invalidates edited self reports without discarding a health-store receipt", () => {
    verification.getState().selfReportSleep("7", "0", true, "2026-10-22");
    verification.getState().clearSleepReport();
    expect(verification.getState().proofs.sleep).toBeUndefined();
    verification.getState().sleep(480, "health-connect", "2026-10-22");
    verification.getState().clearSleepReport();
    expect(validQuestProof(verification.getState().proofs.sleep, "sleep")).toBe(true);
    verification.getState().sleep(500, "self-report" as "health-connect", "2026-10-22");
    expect(verification.getState().proofs.sleep?.source).toBe("health-connect");
  });
  it("discards pending receipts on logout and refuses proof while signed out", () => {
    verification.getState().photo("meal", image, Date.now());
    useSessionStore.setState({ active: false });
    expect(verification.getState().proofs).toEqual({});
    expect(verification.getState().photo("meal", image, Date.now())).toBe(false);
  });
  it("discards pending receipts when another sign-in replaces an active session", () => {
    verification.getState().photo("meal", image, Date.now());
    useSessionStore.getState().signIn();
    expect(verification.getState().proofs).toEqual({});
  });
});
