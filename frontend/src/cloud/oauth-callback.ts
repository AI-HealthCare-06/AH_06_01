/** A mobile deep link can arrive both at cold start and through appUrlOpen. */
export function createCallbackHandler(options: {
  origin: () => string;
  exchange: (code: string) => Promise<void>;
  closeBrowser: () => Promise<void>;
}) {
  const exchanges = new Map<string, Promise<void>>();
  return async (url: string) => {
    const parsed = new URL(url);
    const native =
      parsed.protocol === "com.rexrun.demo:" &&
      parsed.host === "auth" &&
      parsed.pathname === "/callback";
    const web = parsed.origin === options.origin() && parsed.pathname === "/auth/callback";
    if (!native && !web) return;
    if (parsed.searchParams.has("error")) {
      if (native) await options.closeBrowser().catch(() => undefined);
      throw new Error("SOCIAL_LOGIN_NOT_COMPLETED");
    }
    const code = parsed.searchParams.get("code");
    if (!code) return;
    let pending = exchanges.get(code);
    if (!pending) {
      pending = options.exchange(code).then(async () => {
        if (native) await options.closeBrowser().catch(() => undefined);
      });
      exchanges.set(code, pending);
      if (exchanges.size > 16) exchanges.delete(exchanges.keys().next().value!);
    }
    await pending;
  };
}
