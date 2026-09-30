import { normalizeProfile } from "./profiles";
import { withDefaults } from "./storage";
import type { MonthEntry, Profile, Settings, StoredReview } from "./types";

/** One file with everything ReviewReply keeps in this browser: settings, profiles, reviews and reports. */
export interface Backup {
  app: "ReviewReply";
  format: 1;
  exportedAt: string;
  settings: Settings;
  /** Every archive key (`reviews:*`, `months:*`, `years:*`, `collect:*`) with its saved value. */
  data: Record<string, unknown>;
}

const DATA_PREFIXES = ["reviews:", "months:", "years:", "collect:"];

/** Whether a chrome.storage.local key belongs to the review archive (and so goes into a backup). */
export function isDataKey(key: string): boolean {
  return DATA_PREFIXES.some((p) => key.startsWith(p));
}

/** Builds a backup from everything in chrome.storage.local. The API key is left out unless asked for. */
export function buildBackup(
  stored: Record<string, unknown>,
  { includeApiKey, now = Date.now() }: { includeApiKey: boolean; now?: number },
): Backup {
  const settings = withDefaults(stored.settings as Partial<Settings> | undefined);
  if (!includeApiKey) settings.apiKey = "";
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stored)) {
    if (isDataKey(key)) data[key] = value;
  }
  return { app: "ReviewReply", format: 1, exportedAt: new Date(now).toISOString(), settings, data };
}

/** File name like "reviewreply-backup-2026-09-29.json". */
export function backupFileName(now = Date.now()): string {
  return `reviewreply-backup-${new Date(now).toISOString().slice(0, 10)}.json`;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Validates untrusted JSON (an imported backup file) and returns a clean Backup.
 * Throws an Error with a readable message when the file is not a ReviewReply backup.
 */
export function parseBackup(json: string): Backup {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  if (!isObject(raw) || raw.app !== "ReviewReply") {
    throw new Error("This is not a ReviewReply backup. (A single profile file goes into “Import…” above.)");
  }
  if (raw.format !== 1) throw new Error("This backup was made by a newer version of ReviewReply. Update it first.");

  const s = raw.settings;
  if (!isObject(s) || !Array.isArray(s.profiles)) throw new Error("The backup has no settings.");
  for (const field of ["apiKey", "model", "activeProfileId"]) {
    if (s[field] !== undefined && typeof s[field] !== "string") throw new Error(`"settings.${field}" must be text.`);
  }
  s.profiles.forEach((p, i) => {
    if (!isObject(p) || typeof p.id !== "string" || typeof p.businessName !== "string") {
      throw new Error(`Business profile ${i + 1} is not valid.`);
    }
    if (!Array.isArray(p.situations)) throw new Error(`Business profile ${i + 1} has no situations list.`);
  });
  const settings = withDefaults(s as Partial<Settings>);
  settings.profiles = settings.profiles.map((p: Profile) => normalizeProfile(p));

  if (!isObject(raw.data)) throw new Error("The backup has no review data.");
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw.data)) {
    if (!isDataKey(key)) continue;
    const ok = key.startsWith("reviews:") ? Array.isArray(value) : isObject(value);
    if (!ok) throw new Error(`The saved data "${key}" is not valid.`);
    data[key] = value;
  }

  return {
    app: "ReviewReply",
    format: 1,
    exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : "",
    settings,
    data,
  };
}

/**
 * What importing a backup changes: keys to write, and archive keys to delete because the file doesn't have them.
 * When the file has no API key, the key already saved in this browser is kept.
 */
export function restoreChanges(
  stored: Record<string, unknown>,
  backup: Backup,
): { set: Record<string, unknown>; remove: string[] } {
  const settings = { ...backup.settings };
  if (!settings.apiKey) settings.apiKey = withDefaults(stored.settings as Partial<Settings> | undefined).apiKey;
  const remove = Object.keys(stored).filter((key) => isDataKey(key) && !(key in backup.data));
  return { set: { settings, ...backup.data }, remove };
}

/** Short description for the confirm dialog, like "2 businesses, 102 reviews, 3 monthly reports". */
export function describeBackup(backup: Backup): string {
  let reviews = 0;
  let reports = 0;
  for (const [key, value] of Object.entries(backup.data)) {
    if (key.startsWith("reviews:")) reviews += (value as StoredReview[]).length;
    if (key.startsWith("months:")) {
      reports += Object.values(value as Record<string, MonthEntry>).filter((m) => m.report).length;
    }
  }
  const n = backup.settings.profiles.length;
  return `${n} ${n === 1 ? "business" : "businesses"}, ${reviews} reviews, ${reports} monthly reports`;
}

/* ---------- chrome.storage ---------- */

export async function exportEverything(includeApiKey: boolean): Promise<Backup> {
  return buildBackup(await chrome.storage.local.get(null), { includeApiKey });
}

/** Replaces all ReviewReply data in this browser with the backup's. */
export async function importEverything(backup: Backup): Promise<void> {
  const { set, remove } = restoreChanges(await chrome.storage.local.get(null), backup);
  await chrome.storage.local.set(set);
  if (remove.length) await chrome.storage.local.remove(remove);
}
