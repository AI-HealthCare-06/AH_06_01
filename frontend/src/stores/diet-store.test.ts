import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../cloud/client", () => ({ cloudEnabled: true }));
vi.mock("../cloud/sync", async () => {
  const { create } = await import("zustand");
  return { useCloudStore: create(() => ({ userId: "account-a" as string | null })) };
});
import { useCloudStore } from "../cloud/sync";
import { useSessionStore } from "./session-store";
import { useDietStore } from "./diet-store";
import { blankDietItem, catalogVersion, itemNutrition, type MealRecord } from "../domain/diet";
import { localDate } from "../domain/calendar";
function record(): MealRecord {
  const item = { ...blankDietItem(), name: "쌀밥", foodCode: "DEV-0001", grams: "150" };
  return {
    id: crypto.randomUUID(),
    date: localDate(),
    slot: "lunch",
    source: "manual",
    catalogVersion,
    model: null,
    createdAt: new Date().toISOString(),
    items: [{ ...item, nutrients: itemNutrition(item) }],
  };
}
describe("account scoped on-device meal records", () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
    });
    useCloudStore.setState({ userId: "account-a" });
    useSessionStore.setState({ active: true });
    useDietStore.getState().refresh();
  });
  it("saves no photo, ignores duplicate IDs and restores only that account", () => {
    const data = record();
    expect(useDietStore.getState().save(data, "account-a")).toBe(true);
    expect(useDietStore.getState().save(data, "account-a")).toBe(false);
    useCloudStore.setState({ userId: "account-b" });
    expect(useDietStore.getState().records).toEqual([]);
    expect(useDietStore.getState().save({ ...data, id: "late-result" }, "account-a")).toBe(false);
    useCloudStore.setState({ userId: "account-a" });
    expect(useDietStore.getState().records).toHaveLength(1);
    expect(JSON.stringify(localStorage)).not.toContain("base64");
  });
  it("clears visible records on logout and rejects late results", () => {
    const data = record();
    useDietStore.getState().save(data, "account-a");
    useSessionStore.setState({ active: false });
    expect(useDietStore.getState().records).toEqual([]);
    expect(useDietStore.getState().save(record(), "account-a")).toBe(false);
  });
  it("does not save sample, future or invalid dates", () => {
    expect(
      useDietStore
        .getState()
        .save({ ...record(), source: "sample" as MealRecord["source"] }, "account-a"),
    ).toBe(false);
    expect(useDietStore.getState().save({ ...record(), date: "2099-01-01" }, "account-a")).toBe(
      false,
    );
    expect(useDietStore.getState().save({ ...record(), date: "2026-02-30" }, "account-a")).toBe(
      false,
    );
  });
});
