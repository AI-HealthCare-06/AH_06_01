import { beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth }) }));
import { cloudApi, ApiError } from "./client";
describe("authenticated cloud requests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    auth.getSession.mockReset();
  });
  it("does not transmit another account snapshot if the session changes during sync", async () => {
    auth.getSession.mockResolvedValue({
      data: { session: { user: { id: "account-b" }, access_token: "token-b" } },
    });
    const network = vi.spyOn(globalThis, "fetch");
    await expect(
      cloudApi("/v1/sync", { private_record: "account-a" }, "account-a"),
    ).rejects.toMatchObject({ status: 401, message: "ACCOUNT_CHANGED" });
    expect(network).not.toHaveBeenCalled();
  });
  it("requires login before any data request", async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    const network = vi.spyOn(globalThis, "fetch");
    await expect(cloudApi("/v1/me")).rejects.toBeInstanceOf(ApiError);
    expect(network).not.toHaveBeenCalled();
  });
  it("keeps storage failures explicit instead of treating an HTTP response as an acknowledgement", async () => {
    auth.getSession.mockResolvedValue({
      data: { session: { user: { id: "account-a" }, access_token: "token-a" } },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ error: "STORAGE_UNAVAILABLE" }, { status: 503 }),
    );
    await expect(cloudApi("/v1/sync", { batch_id: "sample" }, "account-a")).rejects.toMatchObject({
      status: 503,
      message: "STORAGE_UNAVAILABLE",
    });
  });
});
