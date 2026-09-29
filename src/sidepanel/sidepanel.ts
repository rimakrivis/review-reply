import {
  clearHistory,
  collectKey,
  completeMonths,
  loadCollectInfo,
  loadMonths,
  loadReviews,
  missingMonths,
  monthsKey,
  previousMonth,
  reportMonths,
  reviewsKey,
} from "../archive";
import { bindProfileFields, fillProfileFields, readProfileFields } from "../profile-form";
import { monthName } from "../report-prompt";
import { renderMonthReport } from "../report-view";
import {
  activeProfile,
  fullViewUrl,
  LEFT_TIP_KEY,
  loadSettings,
  onSettingsChanged,
  PANEL_TAB_KEY,
  saveSettings,
} from "../storage";
import type { Message, MonthEntry, ReportResponse, Settings } from "../types";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

const profileSel = $<HTMLSelectElement>("#profile");
const setupBox = $("#setup");
const profileForm = $("#profile-form");
const profileSaved = $("#profile-saved");

const params = new URLSearchParams(location.search);
/** True when opened as a normal browser tab ("Full view") instead of in Chrome's side panel. */
const isFull = params.get("view") === "full";
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
  renderReports();

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

/* ---------- Tabs ---------- */

type Tab = "profile" | "reports";
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
let currentTab: Tab = "profile";

/** Shows one tab's panel and hides the other. `remember` saves the choice for the next time the panel opens. */
function showTab(name: Tab, { focus = false, remember = true } = {}) {
  currentTab = name;
  for (const t of tabs) {
    const on = t.dataset.tab === name;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    $(`#${t.getAttribute("aria-controls")}`).hidden = !on;
    if (on && focus) t.focus();
  }
  if (remember) chrome.storage.session.set({ [PANEL_TAB_KEY]: name }).catch(() => {});
  if (name === "reports") markShownReportOpened();
}

for (const t of tabs) {
  t.addEventListener("click", () => showTab(t.dataset.tab as Tab));
  // Arrow keys move between tabs, as in any tab list.
  t.addEventListener("keydown", (e) => {
    const i = tabs.indexOf(t);
    const next =
      e.key === "ArrowRight" ? tabs[(i + 1) % tabs.length]
      : e.key === "ArrowLeft" ? tabs[(i - 1 + tabs.length) % tabs.length]
      : e.key === "Home" ? tabs[0]
      : e.key === "End" ? tabs[tabs.length - 1]
      : undefined;
    if (!next) return;
    e.preventDefault();
    showTab(next.dataset.tab as Tab, { focus: true });
  });
}

/** Which tab to open: ?tab= in the address first, then the one used last. */
function initialTab() {
  const fromUrl = params.get("tab");
  if (fromUrl === "profile" || fromUrl === "reports") return showTab(fromUrl, { remember: false });
  showTab("profile", { remember: false });
  chrome.storage.session
    .get(PANEL_TAB_KEY)
    .then((got) => {
      if (got[PANEL_TAB_KEY] === "reports") showTab("reports", { remember: false });
    })
    .catch(() => {});
}

/* ---------- Monthly reports ---------- */

const monthSel = $<HTMLSelectElement>("#report-month");
const makeBtn = $<HTMLButtonElement>("#make-report");
const missingBtn = $<HTMLButtonElement>("#make-missing");
const pdfBtn = $<HTMLButtonElement>("#save-pdf");
const statusBox = $("#report-status");
const reportEl = $("#report");

let months: Record<string, MonthEntry> = {};
/** The business the month list belongs to. */
let reportsFor = "";
let selectedMonth = params.get("month") ?? "";
let missingCount = 0;
let busy = false;
/** Set when the side panel opened this full view to save a PDF. */
let printWhenReady = isFull && params.get("print") === "1";

function setStatus(kind: "busy" | "ok" | "error" | "", text = "") {
  statusBox.hidden = !kind;
  statusBox.className = `notice small ${kind === "busy" ? "" : kind}`;
  statusBox.textContent = text;
}

function monthOptionLabel(m: string): string {
  const e = months[m];
  return `${monthName(m)}${!e ? " · no report yet" : e.opened ? "" : " · new"}`;
}

/** Loads the selected business's reports and fills the month picker. */
async function renderReports() {
  const profile = settings && activeProfile(settings);
  $("#reports-card").hidden = !profile;
  if (!profile) {
    reportEl.hidden = true;
    return;
  }
  if (profile.id !== reportsFor) {
    if (reportsFor) selectedMonth = "";
    reportsFor = profile.id;
    setStatus("");
  }
  const [loaded, info] = await Promise.all([loadMonths(profile.id), loadCollectInfo(profile.id)]);
  if (profile.id !== reportsFor) return; // the owner switched business while loading
  months = loaded;
  const now = Date.now();
  const list = reportMonths(info?.coverage ?? [], months, now);
  missingCount = missingMonths(info?.coverage ?? [], months, now).length;

  $("#reports-empty").hidden = list.length > 0;
  $("#reports-empty").textContent =
    "No complete months yet. Open your Google reviews, sort them by Newest, and scroll back past the start of last month. Then its report can be made.";
  $("#reports-controls").hidden = !list.length;

  if (!list.includes(selectedMonth)) {
    // Newest unopened report first, then the newest report, then the newest month.
    selectedMonth =
      list.find((m) => months[m] && !months[m].opened) ?? list.find((m) => months[m]) ?? list[0] ?? "";
  }
  monthSel.replaceChildren(...list.map((m) => new Option(monthOptionLabel(m), m, false, m === selectedMonth)));
  missingBtn.textContent = missingCount ? `Make missing reports (${missingCount})` : "Make missing reports";
  showSelectedReport();
}

function showSelectedReport() {
  const entry = months[selectedMonth];
  makeBtn.textContent = entry ? "Make again" : "Make report";
  makeBtn.disabled = busy || !selectedMonth;
  missingBtn.disabled = busy || !missingCount;
  pdfBtn.hidden = !entry;
  reportEl.hidden = !entry;
  if (!entry) {
    reportEl.replaceChildren();
    return;
  }
  renderMonthReport(reportEl, entry, months[previousMonth(selectedMonth)]);
  markShownReportOpened();
  if (printWhenReady) {
    printWhenReady = false;
    setTimeout(printReport, 300); // let the page finish drawing first
  }
}

/** A report counts as opened once the owner has it on screen. */
function markShownReportOpened() {
  const entry = months[selectedMonth];
  if (currentTab !== "reports" || !entry || entry.opened || !reportsFor) return;
  entry.opened = true; // locally too, so it is only sent once
  const msg: Message = { type: "markReportOpened", profileId: reportsFor, month: selectedMonth };
  chrome.runtime.sendMessage(msg).catch(() => {});
}

monthSel.addEventListener("change", () => {
  selectedMonth = monthSel.value;
  setStatus("");
  showSelectedReport();
});

/** Asks the background worker to make reports and shows how it went. */
async function runReportJob(msg: Message, waiting: string) {
  busy = true;
  showSelectedReport();
  setStatus("busy", waiting);
  const res: ReportResponse = await chrome.runtime
    .sendMessage(msg)
    .catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }) as ReportResponse);
  busy = false;
  if (!res.ok) setStatus("error", res.error);
  else if (msg.type === "makeMissingReports") setStatus("ok", `Done: ${res.made} report${res.made === 1 ? "" : "s"} made.`);
  else setStatus("");
  await renderReports();
}

makeBtn.addEventListener("click", () => {
  const month = selectedMonth;
  if (!reportsFor || !month) return;
  if (months[month] && !confirm(`Make the ${monthName(month)} report again? The current one will be replaced.`)) return;
  runReportJob(
    { type: "makeMonthReport", profileId: reportsFor, month },
    `Making the ${monthName(month)} report… This can take up to a minute.`,
  );
});

missingBtn.addEventListener("click", () => {
  if (!reportsFor || !missingCount) return;
  const n = missingCount;
  runReportJob(
    { type: "makeMissingReports", profileId: reportsFor },
    `Making ${n} report${n === 1 ? "" : "s"}… This can take about a minute per report.`,
  );
});

/** Opens Chrome's print dialog, where the owner picks "Save as PDF". The title becomes the PDF's file name. */
function printReport() {
  const profile = settings && activeProfile(settings);
  const old = document.title;
  document.title = `ReviewReply – ${profile?.businessName || "Business"} – ${monthName(selectedMonth)}`;
  window.addEventListener("afterprint", () => (document.title = old), { once: true });
  window.print();
}

pdfBtn.addEventListener("click", () => {
  if (isFull) return printReport();
  // Printing from the narrow side panel works badly, so the wide full view opens and prints instead.
  chrome.tabs.create({ url: `${fullViewUrl()}&tab=reports&month=${selectedMonth}&print=1` });
});

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
  if (area !== "local" || !profile) return;
  if (changes[reviewsKey(profile.id)] || changes[collectKey(profile.id)]) renderHistory();
  if (changes[monthsKey(profile.id)] || changes[collectKey(profile.id)]) renderReports();
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
$("#open-full").addEventListener("click", () => chrome.tabs.create({ url: `${fullViewUrl()}&tab=${currentTab}` }));

if (!isFull) {
  chrome.storage.local.get(LEFT_TIP_KEY).then((got) => ($("#left-tip").hidden = !!got[LEFT_TIP_KEY]));
  $("#dismiss-tip").addEventListener("click", () => {
    $("#left-tip").hidden = true;
    chrome.storage.local.set({ [LEFT_TIP_KEY]: true });
  });
}

initialTab();
onSettingsChanged(render);
loadSettings().then(render);
