import { describe, expect, it, vi } from "vitest";
import { createCallbackHandler } from "./oauth-callback";

function setup() {
  const exchange = vi.fn().mockResolvedValue(undefined);
  const closeBrowser = vi.fn().mockResolvedValue(undefined);
  return {
    exchange,
    closeBrowser,
    handle: createCallbackHandler({
      origin: () => "https://demo.example",
      exchange,
      closeBrowser,
    }),
  };
}
describe("OAuth callback delivery", () => {
  it("exchanges a code once when cold start and appUrlOpen deliver the same link", async () => {
    const { handle, exchange, closeBrowser } = setup();
    await Promise.all([
      handle("com.rexrun.demo://auth/callback?code=synthetic"),
      handle("com.rexrun.demo://auth/callback?code=synthetic"),
    ]);
    expect(exchange).toHaveBeenCalledExactlyOnceWith("synthetic");
    expect(closeBrowser).toHaveBeenCalledTimes(1);
  });
  it("ignores callbacks from another origin, path or custom scheme host", async () => {
    const { handle, exchange } = setup();
    for (const url of [
      "https://other.example/auth/callback?code=foreign",
      "https://demo.example/home?code=foreign",
      "com.rexrun.demo://other/callback?code=foreign",
      "com.rexrun.demo://auth/other?code=foreign",
    ])
      await handle(url);
    expect(exchange).not.toHaveBeenCalled();
  });
  it("exchanges a web callback without closing a native browser", async () => {
    const { handle, exchange, closeBrowser } = setup();
    await handle("https://demo.example/auth/callback?code=synthetic");
    expect(exchange).toHaveBeenCalledExactlyOnceWith("synthetic");
    expect(closeBrowser).not.toHaveBeenCalled();
  });
  it("reports cancellation instead of leaving the callback screen waiting forever", async () => {
    const { handle, exchange, closeBrowser } = setup();
    await expect(handle("com.rexrun.demo://auth/callback?error=access_denied")).rejects.toThrow(
      "SOCIAL_LOGIN_NOT_COMPLETED",
    );
    expect(exchange).not.toHaveBeenCalled();
    expect(closeBrowser).toHaveBeenCalledTimes(1);
  });
  it("does not report a successful login when code exchange fails", async () => {
    const { handle, exchange } = setup();
    exchange.mockRejectedValue(new Error("invalid grant"));
    await expect(handle("https://demo.example/auth/callback?code=expired")).rejects.toThrow(
      "invalid grant",
    );
  });
});
