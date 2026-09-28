import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const referenceDir = resolve(root, "docs/figma-reference");
const manifest = [];
const screens = {};
for (const file of readdirSync(referenceDir).filter((name) => name.endsWith("-reference.tsx.txt"))) {
  const screen = file.replace("-reference.tsx.txt", "");
  const code = readFileSync(resolve(referenceDir, file), "utf8");
  screens[screen] = {};
  for (const match of code.matchAll(/const (img\w+) = "(https:[^"]+)";/g)) {
    const [, name, url] = match;
    const filename = `${screen}-${name.replace(/^img/, "").replace(/[A-Z]/g, (s, i) => `${i ? "-" : ""}${s.toLowerCase()}`)}.${url.split(".").pop()}`;
    manifest.push({ screen, name, url, file: filename });
    screens[screen][name] = `/assets/figma/${filename}`;
  }
}
mkdirSync(resolve(root, "frontend/src/design"), { recursive: true });
writeFileSync(resolve(referenceDir, "download-manifest.json"), JSON.stringify(manifest, null, 2));
writeFileSync(resolve(root, "frontend/src/design/assets.ts"), `// Original Figma assets. Generated from the captured design context.\nexport const assets = ${JSON.stringify(screens, null, 2)} as const;\n`);
console.log(`${manifest.length} assets from ${Object.keys(screens).length} design frames`);
