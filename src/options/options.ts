import { bindProfileFields, fillProfileFields } from "../profile-form";
import { emptySituation, emptyUrgentTopic, newId, parseProfileJson, profileFromTemplate, profileToJson } from "../profiles";
import { activeProfile, loadSettings, MODEL_OPTIONS, onSettingsChanged, saveSettings } from "../storage";
import { TEMPLATES } from "../templates";
import type { DraftResponse, Profile, Settings, Situation, UrgentTopic } from "../types";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

const keyInput = $<HTMLInputElement>("#api-key");
const modelSel = $<HTMLSelectElement>("#model");
const customModel = $<HTMLInputElement>("#custom-model");
const profileSel = $<HTMLSelectElement>("#profile");
const templateSel = $<HTMLSelectElement>("#template");
const savedLabel = $("#saved");
const profileMsg = $("#profile-msg");
const situationsBox = $("#situations");
const urgentBox = $("#urgent-topics");
const CUSTOM = "__custom__";

let settings: Settings;
let saveTimer: number | undefined;

function save(now = false) {
  clearTimeout(saveTimer);
  savedLabel.textContent = "Saving…";
  const run = async () => {
    await saveSettings(settings);
    savedLabel.textContent = "All changes saved";
  };
  if (now) return run();
  saveTimer = window.setTimeout(run, 400);
}

function notify(kind: "ok" | "error", text: string) {
  profileMsg.className = `notice ${kind}`;
  profileMsg.textContent = text;
  profileMsg.hidden = false;
  setTimeout(() => (profileMsg.hidden = true), 5000);
}

function current(): Profile | undefined {
  return activeProfile(settings);
}

/* ---------- OpenAI connection ---------- */

function renderModel() {
  const known = MODEL_OPTIONS.some((m) => m.id === settings.model);
  modelSel.replaceChildren(
    ...MODEL_OPTIONS.map((m) => new Option(`${m.id} — ${m.note}`, m.id)),
    new Option("Other model…", CUSTOM),
  );
  modelSel.value = known ? settings.model : CUSTOM;
  customModel.hidden = known;
  customModel.value = known ? "" : settings.model;
}

keyInput.addEventListener("input", () => {
  settings.apiKey = keyInput.value.trim();
  save();
});
$("#toggle-key").addEventListener("click", (e) => {
  const show = keyInput.type === "password";
  keyInput.type = show ? "text" : "password";
  (e.target as HTMLButtonElement).textContent = show ? "Hide" : "Show";
});
modelSel.addEventListener("change", () => {
  const custom = modelSel.value === CUSTOM;
  customModel.hidden = !custom;
  if (custom) {
    customModel.focus();
    if (customModel.value.trim()) settings.model = customModel.value.trim();
  } else {
    settings.model = modelSel.value;
  }
  save();
});
customModel.addEventListener("input", () => {
  if (customModel.value.trim()) {
    settings.model = customModel.value.trim();
    save();
  }
});
$("#test").addEventListener("click", async () => {
  const out = $("#test-result");
  const btn = $<HTMLButtonElement>("#test");
  await save(true);
  if (!current()) {
    out.textContent = "Create a business profile below first.";
    return;
  }
  btn.disabled = true;
  out.textContent = "Testing…";
  const res: DraftResponse = await chrome.runtime.sendMessage({
    type: "draft",
    request: {
      review: { reviewerName: "Sam", rating: 5, text: "Lovely evening, great staff!" },
      variant: "default",
    },
  });
  btn.disabled = false;
  out.textContent = res.ok ? `✓ Works. Sample reply: "${res.result.reply}"` : `✗ ${res.error}`;
});

/* ---------- Profiles ---------- */

function renderProfiles() {
  profileSel.replaceChildren(
    ...settings.profiles.map((p) => new Option(p.businessName || "(unnamed business)", p.id)),
  );
  const p = current();
  if (p) {
    profileSel.value = p.id;
    settings.activeProfileId = p.id;
  }
  const none = !p;
  profileSel.disabled = none;
  for (const id of ["#duplicate", "#export", "#delete"]) $<HTMLButtonElement>(id).disabled = none;
  $("#editor").hidden = none;
  $("#situations-card").hidden = none;
  $("#urgent-card").hidden = none;
  if (p) renderEditor(p);
}

function renderEditor(p: Profile) {
  fillProfileFields(document, p);
  renderSituations(p);
  renderUrgentTopics(p);
}

bindProfileFields(document, (field, value) => {
  const p = current();
  if (!p) return;
  p[field] = value;
  if (field === "businessName") {
    const opt = profileSel.selectedOptions[0];
    if (opt) opt.text = value || "(unnamed business)";
  }
  save();
});

function renderSituations(p: Profile, openId?: string) {
  const tpl = $<HTMLTemplateElement>("#situation-tpl");
  situationsBox.replaceChildren(
    ...p.situations.map((s) => {
      const node = tpl.content.firstElementChild!.cloneNode(true) as HTMLDetailsElement;
      const title = node.querySelector(".s-title")!;
      title.textContent = s.name || "(unnamed)";
      node.open = s.id === openId;
      node.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-s]").forEach((el) => {
        const field = el.dataset.s as keyof Omit<Situation, "id">;
        el.value = s[field];
        el.addEventListener("input", () => {
          s[field] = el.value;
          if (field === "name") title.textContent = el.value || "(unnamed)";
          save();
        });
      });
      node.querySelector("[data-remove]")!.addEventListener("click", () => {
        if (!confirm(`Remove the situation "${s.name}"?`)) return;
        p.situations = p.situations.filter((x) => x !== s);
        renderSituations(p);
        save();
      });
      return node;
    }),
  );
}

$("#add-situation").addEventListener("click", () => {
  const p = current();
  if (!p) return;
  const s = emptySituation();
  p.situations.unshift(s);
  renderSituations(p, s.id);
  situationsBox.querySelector<HTMLInputElement>("[data-s=name]")?.select();
  save();
});

function renderUrgentTopics(p: Profile, openId?: string) {
  const tpl = $<HTMLTemplateElement>("#urgent-tpl");
  urgentBox.replaceChildren(
    ...p.urgentTopics.map((t) => {
      const node = tpl.content.firstElementChild!.cloneNode(true) as HTMLDetailsElement;
      const title = node.querySelector(".s-title")!;
      title.textContent = t.name || "(unnamed)";
      node.open = t.id === openId;
      node.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-u]").forEach((el) => {
        const field = el.dataset.u as keyof Omit<UrgentTopic, "id">;
        el.value = t[field];
        el.addEventListener("input", () => {
          t[field] = el.value;
          if (field === "name") title.textContent = el.value || "(unnamed)";
          save();
        });
      });
      node.querySelector("[data-remove]")!.addEventListener("click", () => {
        if (!confirm(`Remove the urgent topic "${t.name}"?`)) return;
        p.urgentTopics = p.urgentTopics.filter((x) => x !== t);
        renderUrgentTopics(p);
        save();
      });
      return node;
    }),
  );
}

$("#add-urgent").addEventListener("click", () => {
  const p = current();
  if (!p) return;
  const t = emptyUrgentTopic();
  p.urgentTopics.unshift(t);
  renderUrgentTopics(p, t.id);
  urgentBox.querySelector<HTMLInputElement>("[data-u=name]")?.select();
  save();
});

profileSel.addEventListener("change", () => {
  settings.activeProfileId = profileSel.value;
  renderProfiles();
  save();
});

templateSel.replaceChildren(...TEMPLATES.map((t) => new Option(`Start from template: ${t.label}`, t.key)));

$("#add").addEventListener("click", () => {
  const p = profileFromTemplate(templateSel.value);
  settings.profiles.push(p);
  settings.activeProfileId = p.id;
  renderProfiles();
  save();
  $<HTMLInputElement>("#f-businessName").focus();
});

$("#duplicate").addEventListener("click", () => {
  const p = current();
  if (!p) return;
  const copy: Profile = {
    ...structuredClone(p),
    id: newId(),
    businessName: `${p.businessName} (copy)`,
  };
  copy.situations = copy.situations.map((s) => ({ ...s, id: newId() }));
  copy.urgentTopics = copy.urgentTopics.map((t) => ({ ...t, id: newId() }));
  settings.profiles.push(copy);
  settings.activeProfileId = copy.id;
  renderProfiles();
  save();
});

$("#delete").addEventListener("click", () => {
  const p = current();
  if (!p || !confirm(`Delete the profile "${p.businessName || "unnamed"}"? Export it first if you want a backup.`)) return;
  settings.profiles = settings.profiles.filter((x) => x.id !== p.id);
  settings.activeProfileId = settings.profiles[0]?.id ?? "";
  renderProfiles();
  save();
});

$("#export").addEventListener("click", () => {
  const p = current();
  if (!p) return;
  const blob = new Blob([profileToJson(p)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${(p.businessName || "profile").replace(/[^\w-]+/g, "-").toLowerCase()}.reviewreply.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$("#import").addEventListener("click", () => $<HTMLInputElement>("#import-file").click());
$<HTMLInputElement>("#import-file").addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const p = parseProfileJson(await file.text());
    settings.profiles.push(p);
    settings.activeProfileId = p.id;
    renderProfiles();
    save();
    notify("ok", `Imported "${p.businessName}" with ${p.situations.length} situations and ${p.urgentTopics.length} urgent topics.`);
  } catch (err) {
    notify("error", `Could not import: ${err instanceof Error ? err.message : err}`);
  }
});

/* ---------- Google pages ---------- */

const launcherBox = $<HTMLInputElement>("#show-launcher");
launcherBox.addEventListener("change", () => {
  settings.showLauncher = launcherBox.checked;
  save();
});
// The ✨ button's "Hide" item changes this setting from the Google page.
onSettingsChanged((s) => {
  if (settings) settings.showLauncher = launcherBox.checked = s.showLauncher;
});

/* ---------- Start ---------- */

loadSettings().then((s) => {
  settings = s;
  keyInput.value = s.apiKey;
  launcherBox.checked = s.showLauncher;
  renderModel();
  renderProfiles();
  if (!s.apiKey) keyInput.focus();
});
