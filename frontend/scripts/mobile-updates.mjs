import { assertMainSource } from "../../deployment/source.mjs";
import { generateKeyPairSync, createHash, createPublicKey, sign, verify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { nativeIdentity } from "./mobile-update-native.mjs";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(frontend, "mobile-updates.config.json");
const keyPath = resolve(
  process.env.REXRUN_OTA_PRIVATE_KEY_PATH ||
    resolve(frontend, ".cache/mobile-updates/publisher-key.pem"),
);
const config = JSON.parse(readFileSync(configPath, "utf8"));
const args = process.argv.slice(2);
function option(name) {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
}
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function newer(a, b) {
  const aa = a.split(".").map(Number);
  const bb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (aa[i] !== bb[i]) return aa[i] > bb[i];
  }
  return false;
}
function signed(value) {
  const payload = Buffer.from(JSON.stringify(value));
  return {
    payload: payload.toString("base64"),
    signature: sign("sha256", payload, readFileSync(keyPath)).toString("base64"),
  };
}
function publicKeyMatches() {
  if (!existsSync(keyPath))
    throw new Error("배포 서명 키가 없습니다. 기존 키를 복구하거나 최초 ota:init을 실행해 주세요.");
  const publicKey = createPublicKey(readFileSync(keyPath))
    .export({ type: "spki", format: "der" })
    .toString("base64");
  if (config.publicKey && config.publicKey !== publicKey)
    throw new Error("설치된 앱과 배포 서명 키가 다릅니다. 키를 자동 교체하지 않습니다.");
  return publicKey;
}

if (args.includes("--help") || !args[0]) {
  console.log(
    "ota:init [--project-url https://<ref>.supabase.co]\nota:publish -- --version 1.1.1 [--prepare-only]\nPrivate key: REXRUN_OTA_PRIVATE_KEY_PATH or ignored .cache/mobile-updates/publisher-key.pem",
  );
} else if (args[0] === "init") {
  if (!existsSync(keyPath)) {
    if (config.publicKey)
      throw new Error("기존 배포 개인 키가 없습니다. 새 키로 덮어쓰지 않습니다.");
    mkdirSync(dirname(keyPath), { recursive: true });
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 3072,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    writeFileSync(keyPath, privateKey, { flag: "wx", mode: 0o600 });
  }
  config.publicKey = publicKeyMatches();
  const projectUrl = option("--project-url");
  if (projectUrl) {
    if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(projectUrl))
      throw new Error("Supabase HTTPS 프로젝트 URL을 입력해 주세요.");
    config.projectUrl = projectUrl;
  }
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log(
    `서명 공개 키 준비 완료. 프로젝트: ${config.projectUrl || "선택 대기"}. 개인 키는 Git에 포함하지 마세요.`,
  );
} else if (args[0] === "publish") {
  if (!args.includes("--prepare-only")) assertMainSource(resolve(frontend, ".."));
  publicKeyMatches();
  if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(config.projectUrl))
    throw new Error("먼저 ota:init -- --project-url로 테스트 프로젝트를 연결해 주세요.");
  const version = option("--version");
  if (
    !version ||
    !semver.test(version) ||
    !version.split(".").every((part) => Number.isSafeInteger(Number(part)))
  )
    throw new Error("새 버전을 --version 1.1.1 형식으로 지정해 주세요.");
  const identity = nativeIdentity(frontend);
  const compatible = [
    "native-baseline.json",
    "native-play-baseline.json",
    "native-test-baseline.json",
  ]
    .map((name) => resolve(frontend, ".cache/mobile-updates", name))
    .filter(existsSync)
    .map((path) => JSON.parse(readFileSync(path, "utf8")))
    .filter(
      (baseline) =>
        baseline.fingerprint === identity.fingerprint &&
        baseline.nativeVersion === config.nativeVersion,
    );
  if (!compatible.length || identity.nativeVersion !== config.nativeVersion)
    throw new Error(
      "네이티브 구성이 변경되었습니다. native:apk 또는 native:aab로 호환 빌드를 먼저 준비해 주세요.",
    );
  const baseline = compatible.reduce((highest, value) =>
    newer(value.webVersion, highest.webVersion) ? value : highest,
  );
  if (!newer(version, baseline.webVersion))
    throw new Error("APK에 포함된 웹 버전보다 높은 버전을 지정해 주세요.");
  const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], {
    cwd: frontend,
    shell: process.platform === "win32",
    stdio: "inherit",
    env: { ...process.env, VITE_REXRUN_WEB_VERSION: version },
  });
  if (result.error || result.status !== 0)
    throw result.error || new Error("웹 빌드에 실패했습니다.");
  const base = `${config.projectUrl}/storage/v1/object/public/${config.bucket}`;
  const files = [];
  const local = new Map();
  function walk(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = resolve(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error("배포 폴더에 심볼릭 링크가 있습니다.");
      if (entry.isDirectory()) walk(path);
      else {
        const file_name = relative(resolve(frontend, "dist"), path).replaceAll("\\", "/");
        if (
          /(^|\/)\./.test(file_name) ||
          /\.(map|pem|key|p12|pfx|env|jks|keystore|apk|aab|dex|jar|aar|so|dylib|dll|exe|class)$/i.test(
            file_name,
          ) ||
          file_name.endsWith(".br")
        )
          throw new Error(`배포 금지 파일: ${file_name}`);
        const contents = readFileSync(path);
        if (contents.length > 45 * 1024 * 1024)
          throw new Error(`파일 크기 제한 초과: ${file_name}`);
        const file_hash = createHash("sha256").update(contents).digest("hex");
        files.push({
          file_name,
          file_hash,
          download_url: `${base}/files/${file_hash}`,
          size: contents.length,
        });
        local.set(file_hash, path);
      }
    }
  }
  walk(resolve(frontend, "dist"));
  files.sort((a, b) => a.file_name.localeCompare(b.file_name, "en"));
  const release = signed({
    schema: 1,
    appId: "com.rexrun.demo",
    platform: "android",
    channel: config.channel,
    nativeVersion: identity.nativeVersion,
    version,
    publishedAt: new Date().toISOString(),
    files,
  });
  const output = resolve(frontend, `.cache/mobile-updates/releases/${version}.json`);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(release));
  if (args.includes("--prepare-only")) {
    console.log(
      `서명된 배포 파일 준비 완료: ${output} (${files.length} files). 업로드하지 않았습니다.`,
    );
  } else {
    const latestUrl = `${base}/android/${config.channel}/${identity.nativeVersion}/latest.json`;
    const latest = await fetch(`${latestUrl}?t=${Date.now()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (latest.ok) {
      const old = await latest.json();
      if (
        !verify(
          "sha256",
          Buffer.from(old.payload, "base64"),
          createPublicKey(readFileSync(keyPath)),
          Buffer.from(old.signature, "base64"),
        )
      )
        throw new Error("서버의 기존 배포 서명이 올바르지 않습니다.");
      if (!newer(version, JSON.parse(Buffer.from(old.payload, "base64").toString()).version))
        throw new Error("기존 배포보다 높은 새 버전을 사용해 주세요.");
    } else if (latest.status !== 404 && latest.status !== 400)
      throw new Error(`기존 배포 확인 실패: ${latest.status}`);
    async function request(action, hashes = []) {
      const body = signed({
        purpose: "rexrun-ota-publish",
        action,
        issuedAt: Date.now(),
        release,
        hashes,
      });
      const response = await fetch(`${config.projectUrl}/functions/v1/rexrun-ota-publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok)
        throw new Error(`배포 API 실패: ${response.status} ${await response.text()}`);
      return response.json();
    }
    let uploaded = 0;
    const hashes = [...local.keys()];
    for (let i = 0; i < hashes.length; i += 12) {
      const batch = hashes.slice(i, i + 12);
      const plan = await request("prepare", batch);
      if (!Array.isArray(plan.uploads) || plan.uploads.length !== batch.length)
        throw new Error("서버 업로드 계획이 올바르지 않습니다.");
      const planned = new Set();
      for (const item of plan.uploads) {
        if (!batch.includes(item.hash) || planned.has(item.hash))
          throw new Error("서버가 요청하지 않은 파일 업로드를 반환했습니다.");
        planned.add(item.hash);
        if (item.exists) continue;
        const destination = new URL(item.signedUrl);
        if (
          destination.origin !== config.projectUrl ||
          destination.protocol !== "https:" ||
          destination.username ||
          destination.password ||
          destination.pathname !==
            `/storage/v1/object/upload/sign/${config.bucket}/files/${item.hash}`
        )
          throw new Error("서버가 허용되지 않은 업로드 주소를 반환했습니다.");
        const contents = readFileSync(local.get(item.hash));
        let successful = false;
        for (let attempt = 0; attempt < 3 && !successful; attempt++) {
          const response = await fetch(item.signedUrl, {
            method: "PUT",
            headers: {
              "Content-Type": "application/octet-stream",
              "cache-control": "max-age=31536000",
            },
            body: contents,
            signal: AbortSignal.timeout(120_000),
          });
          successful = response.ok;
          if (!successful && attempt === 2) throw new Error(`파일 업로드 실패: ${response.status}`);
        }
        uploaded++;
      }
      console.log(
        `파일 확인 ${Math.min(i + batch.length, hashes.length)}/${hashes.length} · 새 파일 ${uploaded}`,
      );
    }
    await request("activate");
    const published = await fetch(`${latestUrl}?t=${Date.now()}`, { cache: "no-store" });
    const saved = await published.json();
    if (!published.ok || saved.payload !== release.payload || saved.signature !== release.signature)
      throw new Error("서버 배포 검증에 실패했습니다.");
    console.log(`Supabase 테스트 배포 완료: v${version}\n${latestUrl}`);
  }
} else throw new Error("init 또는 publish를 사용해 주세요. --help로 명령을 확인할 수 있습니다.");
