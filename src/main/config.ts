import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export type PlatformId = 'instagram' | 'facebook' | 'x';

export interface HubConfig {
  x: {
    /** Numeric ID of the private X List with friends (from x.com/i/lists/<id>). */
    listId: string;
    /** Handles (without @) whose posts may be shown. Empty = author filter off. */
    friends: string[];
  };
  instagram: {
    /** Open shared posts/reels via /embed (media only, public posts only). */
    viewerUseEmbed: boolean;
  };
  /** Extra URL regexes allowed per platform, on top of the built-in allowlist. */
  extraAllow: Record<PlatformId, string[]>;
}

const DEFAULT_CONFIG: HubConfig = {
  x: { listId: '', friends: [] },
  instagram: { viewerUseEmbed: false },
  extraAllow: { instagram: [], facebook: [], x: [] },
};

export const configPath = () => path.join(app.getPath('userData'), 'config.json');
export const blockedLogPath = () => path.join(app.getPath('userData'), 'blocked.log');

export function loadConfig(): HubConfig {
  const file = configPath();
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n');
    return structuredClone(DEFAULT_CONFIG);
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<HubConfig>;
    return {
      x: { ...DEFAULT_CONFIG.x, ...raw.x },
      instagram: { ...DEFAULT_CONFIG.instagram, ...raw.instagram },
      extraAllow: { ...DEFAULT_CONFIG.extraAllow, ...raw.extraAllow },
    };
  } catch (err) {
    console.error(`Invalid ${file}, using defaults:`, err);
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function logBlocked(platform: string, kind: string, url: string) {
  const line = `${new Date().toISOString()}\t${platform}\t${kind}\t${url}\n`;
  fs.appendFile(blockedLogPath(), line, () => {});
}
