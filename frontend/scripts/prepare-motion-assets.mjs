import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const modelRoot = new URL("public/models/motion-capture/", root);
const manifest = JSON.parse(await readFile(new URL("manifest.json", modelRoot), "utf8"));
const installed = JSON.parse(
  await readFile(new URL("node_modules/@mediapipe/tasks-vision/package.json", root), "utf8"),
);
if (installed.version !== manifest.packageVersion) throw new Error("MediaPipe version mismatch");
await mkdir(modelRoot, { recursive: true });

for (const model of manifest.models) {
  const target = new URL(model.file, modelRoot);
  const valid = (bytes) =>
    bytes.length === model.size &&
    createHash("sha256").update(bytes).digest("hex") === model.sha256;
  const cached = await readFile(target).catch(() => null);
  if (cached && valid(cached)) continue;
  if (process.argv.includes("--offline")) throw new Error(`Missing model: ${model.file}`);
  const response = await fetch(model.url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Model download failed: ${model.file} (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!valid(bytes)) throw new Error(`Model checksum mismatch: ${model.file}`);
  const temporary = new URL(`${model.file}.partial`, modelRoot);
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

const vendorRoot = new URL("public/vendor/mediapipe/", root);
await mkdir(vendorRoot, { recursive: true });
await cp(
  new URL("node_modules/@mediapipe/tasks-vision/wasm/", root),
  new URL("wasm/", vendorRoot),
  { recursive: true },
);
process.stdout.write(`Motion assets ready: ${manifest.version} (${fileURLToPath(modelRoot)})\n`);
