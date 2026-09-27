import { clearHistory, collectKey, completeMonths, loadCollectInfo, loadReviews, reviewsKey } from "../archive";
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
  renderHistory();

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

/* ---------- Review history ---------- */

function monthLabel(ms: number): string {
  return new Date(ms).toLocaleDateString("en", { month: "short", year: "numeric" });
}

/** First moment of a "2026-03" month key. */
function monthStart(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).getTime();
}

function daysAgoLabel(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

/** Shows how many reviews are saved for the selected business and when they were last collected. */
async function renderHistory() {
  const profile = settings && activeProfile(settings);
  $("#history").hidden = !profile;
  if (!profile) return;
  const [reviews, info] = await Promise.all([loadReviews(profile.id), loadCollectInfo(profile.id)]);
  $("#history-business").textContent = profile.businessName || "(unnamed business)";
  // Reviews are saved newest first.
  $("#history-count").textContent = reviews.length
    ? `${reviews.length} review${reviews.length === 1 ? "" : "s"} · ${monthLabel(reviews[reviews.length - 1].date)} – ${monthLabel(reviews[0].date)}`
    : "No reviews collected yet.";
  $("#history-updated").textContent = info ? `Last collected: ${daysAgoLabel(info.lastCollectedAt)}` : "";
  const complete = completeMonths(info?.coverage ?? [], Date.now());
  $("#history-complete").textContent = complete.length
    ? `Complete months: ${monthLabel(monthStart(complete[0]))} – ${monthLabel(monthStart(complete[complete.length - 1]))}`
    : reviews.length
      ? "No complete months yet."
      : "";
  $("#history-sort-warning").hidden = info?.lastSortedByNewest !== false;
  $("#clear-history").hidden = !reviews.length;
}

$("#clear-history").addEventListener("click", async () => {
  const profile = settings && activeProfile(settings);
  if (!profile) return;
  const name = profile.businessName || "this business";
  if (!confirm(`Delete all saved reviews for "${name}"? Your profile and settings stay. You can collect the reviews again from Google.`)) return;
  await clearHistory(profile.id);
});

// Refresh live while the owner scrolls through Google's reviews.
chrome.storage.onChanged.addListener((changes, area) => {
  const profile = settings && activeProfile(settings);
  if (area === "local" && profile && (changes[reviewsKey(profile.id)] || changes[collectKey(profile.id)])) {
    renderHistory();
  }
});

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
