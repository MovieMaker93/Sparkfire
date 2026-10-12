import { useEffect, useState } from "react";
import { api } from "./api";

export interface MusicCapabilities {
  model?: string;
  maxStyleChars: number;
  maxLyricsChars: number;
  acceptsScore: boolean;
  license?: string;
  reported: boolean;
}

export const defaultMusicCapabilities: MusicCapabilities = { maxStyleChars: 1000, maxLyricsChars: 20_000, acceptsScore: false, reported: false };

/** What the configured music server takes: how long the style and lyrics may be, and its license line. */
export function useMusicCapabilities() {
  const [capabilities, setCapabilities] = useState(defaultMusicCapabilities);
  useEffect(() => {
    let active = true;
    api.musicCapabilities().then((value) => active && setCapabilities(value)).catch(() => undefined);
    return () => { active = false; };
  }, []);
  return capabilities;
}

/** The style of the song that made an artifact (its score), the natural start for singing it again. */
export function styleBehindArtifact(job: { runs: Array<{ id: string; params: Record<string, unknown> }> }, artifact: { createdByRunId?: string }) {
  const run = artifact.createdByRunId ? job.runs.find((candidate) => candidate.id === artifact.createdByRunId) : undefined;
  return typeof run?.params.style === "string" ? run.params.style.trim() : "";
}
