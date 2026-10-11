export interface ReleaseManifest {
  version: string;
}

// The fork's own releases; upstream's manifest would announce versions this fork does not have.
export const releaseManifestUrl = "https://api.github.com/repos/MovieMaker93/SparklingKit/releases/latest";

function versionParts(value: string) {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1, 4).map(Number) : undefined;
}

export function displayVersion(value?: string) {
  if (!value) return "Checking version";
  const parts = versionParts(value);
  return parts ? `v${parts.join(".")}` : value;
}

export function isNewerVersion(current: string | undefined, candidate: string | undefined) {
  if (!current || !candidate) return false;
  const currentParts = versionParts(current);
  const candidateParts = versionParts(candidate);
  if (!currentParts || !candidateParts) return false;
  for (let index = 0; index < currentParts.length; index += 1) {
    if (candidateParts[index] !== currentParts[index]) return candidateParts[index] > currentParts[index];
  }
  return false;
}

export function releaseFromGitHub(release: unknown): ReleaseManifest {
  const tag = (release as { tag_name?: unknown } | null)?.tag_name;
  if (typeof tag !== "string" || !versionParts(tag)) throw new Error("Release manifest has an invalid version");
  return { version: tag };
}

export async function latestRelease(signal?: AbortSignal) {
  const response = await fetch(releaseManifestUrl, { headers: { Accept: "application/vnd.github+json" }, signal });
  if (!response.ok) throw new Error(`Release manifest returned ${response.status}`);
  return releaseFromGitHub(await response.json());
}
