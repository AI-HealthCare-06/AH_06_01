import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const version = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
const manifestSchema = z.object({
  schema: z.literal(1),
  appId: z.literal("com.rexrun.demo"),
  platform: z.literal("android"),
  channel: z.literal("galaxy-test"),
  nativeVersion: version,
  version,
  publishedAt: z.iso.datetime(),
  files: z
    .array(
      z.object({
        file_name: z.string().min(1).max(300),
        file_hash: hash,
        download_url: z.url(),
        size: z
          .number()
          .int()
          .nonnegative()
          .max(45 * 1024 * 1024),
      }),
    )
    .min(1)
    .max(2000),
});

export type MobileManifest = z.infer<typeof manifestSchema>;
export type UpdateConfig = {
  projectUrl: string;
  bucket: string;
  channel: string;
  nativeVersion: string;
  publicKey: string;
};

export function isNewerVersion(candidate: string, current: string) {
  if (!version.safeParse(candidate).success || !version.safeParse(current).success) return false;
  const left = candidate.split(".").map(Number);
  const right = current.split(".").map(Number);
  if ([...left, ...right].some((part) => !Number.isSafeInteger(part))) return false;
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i];
  }
  return false;
}

export function updateBaseUrl(config: UpdateConfig) {
  const url = new URL(config.projectUrl);
  if (
    url.protocol !== "https:" ||
    !/^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    config.bucket !== "rexrun-app-updates" ||
    config.channel !== "galaxy-test"
  )
    throw new Error("Invalid update origin");
  return `${url.origin}/storage/v1/object/public/${config.bucket}`;
}

function bytes(base64: string) {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

export async function verifyMobileManifest(
  envelope: unknown,
  config: UpdateConfig,
  nativeVersion: string,
): Promise<MobileManifest> {
  const signed = z
    .object({ payload: z.string().max(1_000_000), signature: z.string().max(2000) })
    .parse(envelope);
  const key = await crypto.subtle.importKey(
    "spki",
    bytes(config.publicKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const payload = bytes(signed.payload);
  if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, bytes(signed.signature), payload)))
    throw new Error("Invalid update signature");
  const manifest = manifestSchema.parse(JSON.parse(new TextDecoder().decode(payload)));
  if (manifest.nativeVersion !== nativeVersion || manifest.channel !== config.channel)
    throw new Error("Incompatible native application");
  const base = updateBaseUrl(config);
  const names = new Set<string>();
  let total = 0;
  for (const file of manifest.files) {
    if (
      file.file_name.startsWith("/") ||
      file.file_name.includes("\\") ||
      [...file.file_name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
      file.file_name.split("/").some((part) => !part || part === "." || part === "..") ||
      file.file_name.endsWith(".br") ||
      /\.(apk|aab|dex|jar|aar|so|dylib|dll|exe|class)$/i.test(file.file_name) ||
      names.has(file.file_name) ||
      file.download_url !== `${base}/files/${file.file_hash}`
    )
      throw new Error("Invalid update file");
    names.add(file.file_name);
    total += file.size;
  }
  if (!names.has("index.html") || total > 500 * 1024 * 1024)
    throw new Error("Invalid update bundle");
  return manifest;
}
