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
  return { apiKey: "", model: DEFAULT_MODEL, activeProfileId: "", profiles: [], showLauncher: true };
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

/** chrome.storage.local key for where the owner dragged the ✨ button. */
export const LAUNCHER_POS_KEY = "launcherPos";

/** chrome.storage.local key set once the owner dismisses the "panel on the left" tip. */
export const LEFT_TIP_KEY = "leftTipDismissed";

/** Address of the side panel UI opened as a normal, wide browser tab. */
export function fullViewUrl(): string {
  return chrome.runtime.getURL("sidepanel.html?view=full");
}
