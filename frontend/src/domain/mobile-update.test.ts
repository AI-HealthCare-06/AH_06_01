import { describe, expect, it } from "vitest";
import { isNewerVersion, updateBaseUrl, verifyMobileManifest } from "./mobile-update";

const algorithm = {
  name: "RSASSA-PKCS1-v1_5",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
};
const pair = await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
const base64 = (data: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(data)));
const config = {
  projectUrl: "https://abcdefghijklmnopqrst.supabase.co",
  bucket: "rexrun-app-updates",
  channel: "galaxy-test",
  nativeVersion: "1.1.0",
  publicKey: base64(await crypto.subtle.exportKey("spki", pair.publicKey)),
};
const file = {
  file_name: "index.html",
  file_hash: "a".repeat(64),
  download_url: `${updateBaseUrl(config)}/files/${"a".repeat(64)}`,
  size: 100,
};
const release = {
  schema: 1,
  appId: "com.rexrun.demo",
  platform: "android",
  channel: "galaxy-test",
  nativeVersion: "1.1.0",
  version: "1.1.1",
  publishedAt: "2026-10-15T00:00:00.000Z",
  files: [file],
};
async function envelope(value: unknown) {
  const data = new TextEncoder().encode(JSON.stringify(value));
  return {
    payload: base64(data),
    signature: base64(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, data)),
  };
}

describe("signed mobile updates", () => {
  it("accepts an authentic release for the installed native version", async () => {
    await expect(verifyMobileManifest(await envelope(release), config, "1.1.0")).resolves.toEqual(
      release,
    );
  });
  it("rejects a payload modified after signing", async () => {
    const signed = await envelope(release);
    signed.payload = base64(
      new TextEncoder().encode(JSON.stringify({ ...release, version: "9.0.0" })),
    );
    await expect(verifyMobileManifest(signed, config, "1.1.0")).rejects.toThrow("signature");
  });
  it("rejects a different signing key", async () => {
    const other = await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
    await expect(
      verifyMobileManifest(
        await envelope(release),
        {
          ...config,
          publicKey: base64(await crypto.subtle.exportKey("spki", other.publicKey)),
        },
        "1.1.0",
      ),
    ).rejects.toThrow("signature");
  });
  it("rejects updates requiring a different APK", async () => {
    await expect(verifyMobileManifest(await envelope(release), config, "1.2.0")).rejects.toThrow(
      "Incompatible",
    );
  });
  it.each([
    "../index.html",
    "/index.html",
    "x/../index.html",
    "x\\index.html",
    "x//index.html",
    "index.html.br",
  ])("rejects unsafe or ambiguous filename %s", async (file_name) => {
    await expect(
      verifyMobileManifest(
        await envelope({ ...release, files: [{ ...file, file_name }] }),
        config,
        "1.1.0",
      ),
    ).rejects.toThrow();
  });
  it("rejects external download URLs even when the manifest is signed", async () => {
    await expect(
      verifyMobileManifest(
        await envelope({
          ...release,
          files: [{ ...file, download_url: "https://example.com/payload" }],
        }),
        config,
        "1.1.0",
      ),
    ).rejects.toThrow("Invalid update file");
  });
  it.each(["classes.dex", "native/lib.so", "update.APK", "code.jar", "server.exe"])(
    "rejects native executable code in OTA: %s",
    async (file_name) => {
      await expect(
        verifyMobileManifest(
          await envelope({ ...release, files: [file, { ...file, file_name }] }),
          config,
          "1.1.0",
        ),
      ).rejects.toThrow("Invalid update file");
    },
  );
  it("keeps browser WebAssembly assets supported", async () => {
    const value = { ...release, files: [file, { ...file, file_name: "assets/vision.wasm" }] };
    await expect(verifyMobileManifest(await envelope(value), config, "1.1.0")).resolves.toEqual(
      value,
    );
  });
  it("rejects duplicate paths and bundles without an entry point", async () => {
    await expect(
      verifyMobileManifest(await envelope({ ...release, files: [file, file] }), config, "1.1.0"),
    ).rejects.toThrow();
    await expect(
      verifyMobileManifest(
        await envelope({ ...release, files: [{ ...file, file_name: "assets/a.js" }] }),
        config,
        "1.1.0",
      ),
    ).rejects.toThrow("bundle");
  });
  it("compares versions numerically and refuses downgrades", () => {
    expect(isNewerVersion("1.1.10", "1.1.9")).toBe(true);
    expect(isNewerVersion("1.1.1", "1.1.1")).toBe(false);
    expect(isNewerVersion("1.1.1", "1.2.0")).toBe(false);
    expect(isNewerVersion("1.01.1", "1.1.0")).toBe(false);
    expect(isNewerVersion("1.1.999999999999999999999", "1.1.0")).toBe(false);
  });
  it("rejects insecure and misleading project origins", () => {
    for (const projectUrl of [
      "http://abcdefghijklmnopqrst.supabase.co",
      "https://abcdefghijklmnopqrst.supabase.co.evil.com",
      `${config.projectUrl}/elsewhere`,
      `${config.projectUrl}?key=bad`,
    ])
      expect(() => updateBaseUrl({ ...config, projectUrl })).toThrow();
  });
});
