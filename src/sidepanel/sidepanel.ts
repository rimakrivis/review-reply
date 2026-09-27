import { bindProfileFields, fillProfileFields, readProfileFields } from "../profile-form";
import { activeProfile, fullViewUrl, LEFT_TIP_KEY, loadSettings, onSettingsChanged, saveSettings } from "../storage";
import type { Settings } from "../types";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

const profileSel = $<HTMLSelectElement>("#profile");
const setupBox = $("#setup");
const profileForm = $("#profile-form");
const profileSaved = $("#profile-saved");

/** True when opened as a normal browser tab ("Full view") instead of in Chrome's side panel. */
const isFull = new URLSearchParams(location.search).get("view") === "full";
document.body.classList.toggle("full", isFull);

let settings: Settings;
let profileTimer: number | undefined;

function openSettings(e?: Event) {
  e?.preventDefault();
  chrome.runtime.openOptionsPage();
}

function render(s: Settings) {
  settings = s;
  profileSel.replaceChildren(
    ...s.profiles.map((p) => new Option(p.businessName || "(unnamed business)", p.id, false, p.id === s.activeProfileId)),
  );
  profileSel.disabled = s.profiles.length < 2;

  const profile = activeProfile(s);
  $("#profile-empty").hidden = !!profile;
  profileForm.hidden = !profile;
  if (profile) fillProfileFields(profileForm, profile);

  const missing = [!s.apiKey && "an OpenAI API key", !s.profiles.length && "a business profile"].filter(Boolean);
  setupBox.hidden = missing.length === 0;
  if (missing.length) {
    setupBox.textContent = `Add ${missing.join(" and ")} to get started. `;
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = "Open settings";
    a.onclick = openSettings;
    setupBox.append(a);
  }
}

/** Saves the profile shortly after typing stops. Reads the fields at save time so no keystroke is lost. */
function saveProfile(now = false) {
  clearTimeout(profileTimer);
  profileTimer = undefined;
  profileSaved.textContent = "Saving…";
  const run = async () => {
    profileTimer = undefined;
    const p = activeProfile(settings);
    if (!p) return;
    readProfileFields(profileForm, p);
    await saveSettings(settings);
    profileSaved.textContent = "Saved";
  };
  if (now) return run();
  profileTimer = window.setTimeout(run, 400);
}

bindProfileFields(profileForm, (field, value) => {
  if (field === "businessName") {
    const opt = profileSel.selectedOptions[0];
    if (opt) opt.text = value || "(unnamed business)";
  }
  saveProfile();
});

profileSel.addEventListener("change", async () => {
  // Finish saving edits to the previous business before switching.
  if (profileTimer !== undefined) await saveProfile(true);
  await saveSettings({ ...settings, activeProfileId: profileSel.value });
});

document.querySelectorAll("[data-open-settings]").forEach((a) => a.addEventListener("click", openSettings));
$("#open-full").addEventListener("click", () => chrome.tabs.create({ url: fullViewUrl() }));

if (!isFull) {
  chrome.storage.local.get(LEFT_TIP_KEY).then((got) => ($("#left-tip").hidden = !!got[LEFT_TIP_KEY]));
  $("#dismiss-tip").addEventListener("click", () => {
    $("#left-tip").hidden = true;
    chrome.storage.local.set({ [LEFT_TIP_KEY]: true });
  });
}

onSettingsChanged(render);
loadSettings().then(render);
