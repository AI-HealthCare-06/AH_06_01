import { compareVersion } from "./source.mjs";

// Only the APK being introduced by this release may start an empty channel.
// Existing installed versions must retain a valid, signed history.
export async function previousChannel(response, options) {
  const { nativeVersion, newNativeVersion, channel, version, sha, decode } =
    options;
  if (response.status === 404 && nativeVersion === newNativeVersion)
    return { envelope: null, previous: null };
  if (!response.ok)
    throw new Error(`Existing native channel unavailable: ${nativeVersion}`);
  const envelope = await response.json();
  const previous = decode(envelope);
  if (
    previous.nativeVersion !== nativeVersion ||
    previous.channel !== channel ||
    previous.appId !== "com.rexrun.demo"
  )
    throw new Error("Existing OTA channel identity mismatch");
  if (
    compareVersion(version, previous.version) < 0 ||
    (version === previous.version && previous.source?.commit !== sha)
  )
    throw new Error("Release cannot replace a newer or unrelated version");
  return { envelope, previous };
}
