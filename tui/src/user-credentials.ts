import fs from "fs";
import os from "os";
import path from "path";

export type StoredCredentials = {
  fireworksApiKey: string;
  alderApiKey: string;
};

function configDir(): string {
  const base = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(base, "research-partner");
}

/** Absolute path to the persisted credentials file (JSON). */
export function credentialsFilePath(): string {
  return path.join(configDir(), "credentials.json");
}

/**
 * Merge stored keys into `process.env` when real env vars are unset.
 * Call once at process startup before reading config.
 */
export function loadUserCredentialsIntoEnv(): void {
  const file = credentialsFilePath();
  try {
    if (!fs.existsSync(file)) return;
    const raw = fs.readFileSync(file, "utf8");
    const j = JSON.parse(raw) as Partial<StoredCredentials>;
    if (!process.env.FIREWORKS_API_KEY?.trim() && typeof j.fireworksApiKey === "string") {
      const v = j.fireworksApiKey.trim();
      if (v) process.env.FIREWORKS_API_KEY = v;
    }
    if (!process.env.ALDER_API_KEY?.trim() && typeof j.alderApiKey === "string") {
      const v = j.alderApiKey.trim();
      if (v) process.env.ALDER_API_KEY = v;
    }
  } catch {
    // corrupt or unreadable file — ignore; user can fix or use env / wizard
  }
}

/** Persist keys and apply them to this process. */
export function saveUserCredentials(creds: StoredCredentials): void {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = credentialsFilePath();
  const payload = JSON.stringify({
    fireworksApiKey: creds.fireworksApiKey.trim(),
    alderApiKey: creds.alderApiKey.trim(),
  });
  fs.writeFileSync(file, payload, { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // ignore platforms / FS that don't support chmod
  }
  process.env.FIREWORKS_API_KEY = creds.fireworksApiKey.trim();
  process.env.ALDER_API_KEY = creds.alderApiKey.trim();
}
