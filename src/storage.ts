import type { Profile, Settings } from "./types";

const KEY = "settings";

export const DEFAULT_MODEL = "gpt-4o-mini";

export const MODEL_OPTIONS: { id: string; note: string }[] = [
  { id: "gpt-4o-mini", note: "cheap, fast, good default" },
  { id: "gpt-4.1-nano", note: "cheapest 4.x model" },
  { id: "gpt-4.1-mini", note: "better writing, still cheap" },
  { id: "gpt-5-nano", note: "cheapest 5.x model, slower (reasoning)" },
  { id: "gpt-5-mini", note: "best quality here, slower (reasoning)" },
];

export function defaultSettings(): Settings {
  return { apiKey: "", model: DEFAULT_MODEL, activeProfileId: "", profiles: [] };
}

export async function loadSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get(KEY);
  return { ...defaultSettings(), ...(got[KEY] as Partial<Settings> | undefined) };
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: s });
}

export function activeProfile(s: Settings, id?: string): Profile | undefined {
  return (
    s.profiles.find((p) => p.id === (id || s.activeProfileId)) ?? s.profiles[0]
  );
}

export function onSettingsChanged(cb: (s: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[KEY]) {
      cb({ ...defaultSettings(), ...(changes[KEY].newValue as Partial<Settings>) });
    }
  });
}

/** chrome.storage.session key for review text sent from the right-click menu to the side panel. */
export const PENDING_KEY = "pendingReview";
