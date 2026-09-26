import { loadSettings, onSettingsChanged, PENDING_KEY, saveSettings } from "../storage";
import type { DraftResponse, Message, Settings, Variant } from "../types";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

const profileSel = $<HTMLSelectElement>("#profile");
const nameInput = $<HTMLInputElement>("#name");
const ratingSel = $<HTMLSelectElement>("#rating");
const reviewInput = $<HTMLTextAreaElement>("#review");
const replyBox = $<HTMLTextAreaElement>("#reply");
const errorBox = $("#error");
const setupBox = $("#setup");
const resultBox = $("#result");
const situationBadge = $("#situation");
const actionButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("#draft, [data-v]"));

let settings: Settings;

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

function showError(msg: string) {
  errorBox.textContent = msg;
  errorBox.hidden = !msg;
}

async function draft(variant: Variant) {
  const text = reviewInput.value.trim();
  const rating = Number(ratingSel.value);
  if (!text && !rating) {
    showError("Paste the review text or pick a star rating first.");
    reviewInput.focus();
    return;
  }
  showError("");
  actionButtons.forEach((b) => (b.disabled = true));
  const draftBtn = $<HTMLButtonElement>("#draft");
  const label = draftBtn.textContent;
  draftBtn.textContent = "Drafting…";
  try {
    const msg: Message = {
      type: "draft",
      profileId: profileSel.value || undefined,
      request: {
        review: { reviewerName: nameInput.value, rating, text },
        variant,
        previous: variant === "default" ? undefined : replyBox.value,
      },
    };
    const res: DraftResponse = await chrome.runtime.sendMessage(msg);
    if (!res.ok) {
      showError(res.error);
      return;
    }
    replyBox.value = res.result.reply;
    situationBadge.textContent =
      res.result.situation === "None" ? "No matching situation" : `${res.result.situation} · ${res.result.confidence}`;
    resultBox.hidden = false;
  } catch (e) {
    showError(e instanceof Error ? e.message : String(e));
  } finally {
    draftBtn.textContent = label;
    actionButtons.forEach((b) => (b.disabled = false));
  }
}

function loadPending(value: unknown) {
  const p = value as { text?: string } | undefined;
  if (!p?.text) return;
  reviewInput.value = p.text.trim();
  nameInput.value = "";
  ratingSel.value = "0";
  resultBox.hidden = true;
  showError("");
  chrome.storage.session.remove(PENDING_KEY);
  ratingSel.focus(); // the star rating is not part of selected text, so prompt for it
}

$("#open-settings").addEventListener("click", openSettings);
$("#draft").addEventListener("click", () => draft("default"));
document.querySelectorAll<HTMLButtonElement>("[data-v]").forEach((b) =>
  b.addEventListener("click", () => draft(b.dataset.v as Variant)),
);
$("#clear").addEventListener("click", () => {
  reviewInput.value = nameInput.value = "";
  ratingSel.value = "0";
  resultBox.hidden = true;
  showError("");
  reviewInput.focus();
});
$("#copy").addEventListener("click", async () => {
  const btn = $<HTMLButtonElement>("#copy");
  await navigator.clipboard.writeText(replyBox.value);
  btn.textContent = "Copied ✓";
  setTimeout(() => (btn.textContent = "Copy"), 1500);
});
profileSel.addEventListener("change", async () => {
  await saveSettings({ ...settings, activeProfileId: profileSel.value });
});
reviewInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) draft("default");
});

onSettingsChanged(render);
chrome.storage.session.onChanged.addListener((changes) => {
  if (changes[PENDING_KEY]?.newValue) loadPending(changes[PENDING_KEY].newValue);
});

loadSettings().then(render);
chrome.storage.session.get(PENDING_KEY).then((got) => loadPending(got[PENDING_KEY]));
