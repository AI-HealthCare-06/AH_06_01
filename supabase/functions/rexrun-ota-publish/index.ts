import { announceAppUpdate } from "./announce.ts";
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import config from "../../../frontend/mobile-updates.config.json" with {
  type: "json",
};
import {
  isNewerVersion,
  type MobileManifest,
  updateBaseUrl,
  type UpdateConfig,
  verifyMobileManifest,
} from "../../../frontend/src/domain/mobile-update.ts";

const envelopeSchema = z.object({
  payload: z.string().max(1_500_000),
  signature: z.string().max(2000),
});
const requestSchema = z.object({
  purpose: z.literal("rexrun-ota-publish"),
  action: z.enum(["prepare", "activate"]),
  issuedAt: z.number().int(),
  release: envelopeSchema,
  hashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(12),
});
const decode = (input: string) =>
  Uint8Array.from(atob(input), (char) => char.charCodeAt(0));
const reply = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export function createPublisherHandler(
  trustedConfig: UpdateConfig = config,
  supportedNativeVersions = [trustedConfig.nativeVersion],
  announce?: (client: SupabaseClient, release: MobileManifest) => Promise<void>,
) {
  const config = trustedConfig;
  return async function handle(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return reply({ error: "Method not allowed" }, 405);
    }
    if (!config.publicKey || !config.projectUrl) {
      return reply({ error: "Publisher not configured" }, 503);
    }
    let authenticated;
    try {
      if (Number(request.headers.get("content-length")) > 2_000_000) {
        return reply({ error: "Request too large" }, 413);
      }
      const text = await request.text();
      if (text.length > 2_000_000) {
        return reply({ error: "Request too large" }, 413);
      }
      const envelope = envelopeSchema.parse(JSON.parse(text));
      const publicKey = await crypto.subtle.importKey(
        "spki",
        decode(config.publicKey),
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
      const payload = decode(envelope.payload);
      if (
        !await crypto.subtle.verify(
          "RSASSA-PKCS1-v1_5",
          publicKey,
          decode(envelope.signature),
          payload,
        )
      ) return reply({ error: "Unauthorized" }, 401);
      authenticated = requestSchema.parse(
        JSON.parse(new TextDecoder().decode(payload)),
      );
      if (Math.abs(Date.now() - authenticated.issuedAt) > 10 * 60_000) {
        return reply({ error: "Expired request" }, 401);
      }
    } catch {
      return reply({ error: "Unauthorized" }, 401);
    }
    try {
      const nativeVersion = JSON.parse(
        new TextDecoder().decode(decode(authenticated.release.payload)),
      ).nativeVersion;
      if (!supportedNativeVersions.includes(nativeVersion)) {
        throw new Error("Unsupported native application");
      }
      const release = await verifyMobileManifest(
        authenticated.release,
        config,
        nativeVersion,
      );
      const projectUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!projectUrl || projectUrl !== config.projectUrl || !serviceKey) {
        return reply({ error: "Server configuration unavailable" }, 503);
      }
      // Privileged credentials stay in the Edge runtime; clients receive file-scoped upload tickets.
      const client = createClient(projectUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const storage = client.storage.from(config.bucket);
      const byHash = new Map(
        release.files.map((file) => [file.file_hash, file]),
      );
      async function exists(hash: string) {
        const file = byHash.get(hash);
        if (!file) throw new Error("Unlisted file");
        const response = await fetch(`${updateBaseUrl(config)}/files/${hash}`, {
          method: "HEAD",
          signal: AbortSignal.timeout(10_000),
        });
        if (response.ok) {
          if (Number(response.headers.get("content-length")) !== file.size) {
            throw new Error("File size mismatch");
          }
          return true;
        }
        if (response.status === 404 || response.status === 400) return false;
        throw new Error("Storage unavailable");
      }
      if (authenticated.action === "prepare") {
        const bucket = await client.storage.getBucket(config.bucket);
        if (bucket.error) {
          const created = await client.storage.createBucket(config.bucket, {
            public: true,
            fileSizeLimit: 45 * 1024 * 1024,
            allowedMimeTypes: ["application/octet-stream", "application/json"],
          });
          if (created.error) throw new Error("Bucket initialization failed");
        } else if (!bucket.data.public) {
          throw new Error("Update bucket is not public");
        }
        const uploads = [];
        for (const hash of new Set(authenticated.hashes)) {
          if (!byHash.has(hash)) {
            return reply({ error: "File not in signed release" }, 400);
          }
          if (await exists(hash)) {
            uploads.push({ hash, exists: true });
            continue;
          }
          const { data, error } = await storage.createSignedUploadUrl(
            `files/${hash}`,
            { upsert: false },
          );
          if (error) throw new Error("Upload ticket failed");
          uploads.push({ hash, exists: false, signedUrl: data.signedUrl });
        }
        return reply({ uploads });
      }
      const hashes = [...byHash.keys()];
      for (let i = 0; i < hashes.length; i += 8) {
        const checked = await Promise.all(hashes.slice(i, i + 8).map(exists));
        if (checked.some((found) => !found)) {
          return reply(
            { error: "Upload incomplete; channel was not changed" },
            409,
          );
        }
      }
      const path = `android/${config.channel}/${release.nativeVersion}`;
      const previousChannel = await storage.download(`${path}/latest.json`);
      if (!previousChannel.error) {
        const previousEnvelope = JSON.parse(await previousChannel.data.text());
        const previousRelease = await verifyMobileManifest(
          previousEnvelope,
          config,
          release.nativeVersion,
        );
        if (
          release.version === previousRelease.version &&
          authenticated.release.payload === previousEnvelope.payload &&
          authenticated.release.signature === previousEnvelope.signature
        ) {
          return reply({
            version: release.version,
            fileCount: release.files.length,
          });
        }
        if (!isNewerVersion(release.version, previousRelease.version)) {
          return reply({
            error: "A newer or different release is already active",
          }, 409);
        }
      }
      const bytes = new TextEncoder().encode(
        JSON.stringify(authenticated.release),
      );
      const archive = await storage.upload(
        `${path}/releases/${release.version}.json`,
        bytes,
        {
          upsert: false,
          contentType: "application/json",
          cacheControl: "31536000",
        },
      );
      if (archive.error) {
        const previous = await storage.download(
          `${path}/releases/${release.version}.json`,
        );
        if (
          previous.error ||
          await previous.data.text() !== new TextDecoder().decode(bytes)
        ) {
          return reply({
            error: "Version already exists with different content",
          }, 409);
        }
      }
      // Promote only after every immutable file exists; incomplete uploads keep the old channel.
      const latest = await storage.upload(`${path}/latest.json`, bytes, {
        upsert: true,
        contentType: "application/json",
        cacheControl: "0",
      });
      if (latest.error) throw new Error("Channel update failed");
      if (announce) {
        const task = announce(client, release).catch(() => undefined);
        if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(task);
        else await task;
      }
      return reply({
        version: release.version,
        fileCount: release.files.length,
      });
    } catch {
      return reply(
        { error: "Release validation or storage operation failed" },
        400,
      );
    }
  };
}

// Preserve the existing APK channel while publishing the new native integration.
if (import.meta.main) {
  Deno.serve(
    createPublisherHandler(config, [
      "1.1.0",
      "1.2.0",
      "1.2.1",
      "1.3.0",
      "1.4.0",
      "1.5.0",
      "1.5.1",
      "1.5.2",
    ], announceAppUpdate),
  );
}
