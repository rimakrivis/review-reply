import {
  clearHistory,
  collectedSources,
  collectKey,
  completeMonths,
  coverageOf,
  isYearOutdated,
  loadCollectInfo,
  monthKey,
  loadMonths,
  loadReviews,
  loadYears,
  missingMonths,
  monthSites,
  monthsKey,
  previousMonth,
  readyMonths,
  reportMonths,
  reportYears,
  reviewsKey,
  siteCollect,
  sourceOf,
  yearsKey,
} from "../archive";
import { bindProfileFields, fillProfileFields, readProfileFields } from "../profile-form";
import { monthName } from "../report-prompt";
import { renderMonthReport, renderYearReport } from "../report-view";
import {
  activeProfile,
  fullViewUrl,
  LEFT_TIP_KEY,
  loadSettings,
  onSettingsChanged,
  PANEL_TAB_KEY,
  saveSettings,
} from "../storage";
import type { CollectInfo } from "../archive";
import { SOURCE_NAMES, SOURCES, type Message, type MonthEntry, type ReportResponse, type Settings, type Source, type YearEntry } from "../types";
import { isYear, periodName } from "../year-report";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

const profileSel = $<HTMLSelectElement>("#profile");
const setupBox = $("#setup");
const profileCard = $("#profile-form");
const profileForm = $<HTMLFormElement>("#profile-edit");
const profileView = $("#profile-view");
const profileSaved = $("#profile-saved");

const params = new URLSearchParams(location.search);
/** True when opened as a normal browser tab ("Full view") instead of in Chrome's side panel. */
const isFull = params.get("view") === "full";
document.body.classList.toggle("full", isFull);

let settings: Settings;
/** The business card shows a compact row until the owner clicks Edit. */
let editing = false;
/** True while the form has changes that are not saved yet. */
let dirty = false;
/** The business the form belongs to. */
let editingFor = "";

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
  profileCard.hidden = !profile;
  if (profile) {
    if (profile.id !== editingFor) {
      // Another business: start closed, unless it has no name yet.
      editingFor = profile.id;
      editing = !profile.businessName.trim();
      dirty = false;
      profileSaved.textContent = "";
    }
    if (!dirty) fillProfileFields(profileForm, profile);
    showProfileMode();
  }
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

/* ---------- Monthly and yearly reports ---------- */

const monthSel = $<HTMLSelectElement>("#report-month");
const makeBtn = $<HTMLButtonElement>("#make-report");
const missingBtn = $<HTMLButtonElement>("#make-missing");
const pdfBtn = $<HTMLButtonElement>("#save-pdf");
const statusBox = $("#report-status");
const reportEl = $("#report");

let months: Record<string, MonthEntry> = {};
let years: Record<string, YearEntry> = {};
/** The business the report list belongs to. */
let reportsFor = "";
/** The report on screen: a month ("2026-08") or a year ("2026"). */
let selectedPeriod = params.get("report") ?? "";
let missingCount = 0;
let missingByYear: Record<string, number> = {};
let collectInfo: CollectInfo | undefined;
let busy = false;
/** Set when the side panel opened this full view to save a PDF. */
let printWhenReady = isFull && params.get("print") === "1";

function setStatus(kind: "busy" | "ok" | "error" | "", text = "") {
  statusBox.hidden = !kind;
  statusBox.className = `notice small ${kind === "busy" ? "" : kind}`;
  statusBox.textContent = text;
}

/** The saved report for a month or a year, if there is one. */
function entryFor(period: string): MonthEntry | YearEntry | undefined {
  return isYear(period) ? years[period] : months[period];
}

/** The sites in use that are not complete yet for a month, so its report would leave them out. Never for years. */
function waitingSites(period: string): Source[] {
  if (isYear(period)) return [];
  const profile = settings && activeProfile(settings);
  return monthSites(collectInfo, period, Date.now(), profile?.skippedSources ?? []).waiting;
}

function siteNames(list: Source[]): string {
  return list.map((s) => SOURCE_NAMES[s]).join(" and ");
}

function optionLabel(period: string): string {
  const e = entryFor(period);
  if (!e) {
    const waiting = waitingSites(period);
    return `${periodName(period)} · ${waiting.length ? `waiting for ${siteNames(waiting)}` : "no report yet"}`;
  }
  return `${periodName(period)}${e.opened ? "" : " · new"}`;
}

function optionGroup(label: string, periods: string[]): HTMLOptGroupElement {
  const group = document.createElement("optgroup");
  group.label = label;
  group.append(...periods.map((p) => new Option(optionLabel(p), p, false, p === selectedPeriod)));
  return group;
}

/** Loads the selected business's reports and fills the report picker. */
async function renderReports() {
  const profile = settings && activeProfile(settings);
  $("#reports-card").hidden = !profile;
  if (!profile) {
    reportEl.hidden = true;
    return;
  }
  if (profile.id !== reportsFor) {
    if (reportsFor) selectedPeriod = "";
    reportsFor = profile.id;
    setStatus("");
  }
  const [loaded, loadedYears, info] = await Promise.all([
    loadMonths(profile.id),
    loadYears(profile.id),
    loadCollectInfo(profile.id),
  ]);
  if (profile.id !== reportsFor) return; // the owner switched business while loading
  months = loaded;
  years = loadedYears;
  collectInfo = info;
  const now = Date.now();
  const skip = profile.skippedSources ?? [];
  const list = reportMonths(readyMonths(info, now, skip), months);
  const yearList = reportYears(list, years);
  const missing = missingMonths(coverageOf(info, skip), months, now);
  missingCount = missing.length;
  missingByYear = {};
  for (const m of missing) missingByYear[m.slice(0, 4)] = (missingByYear[m.slice(0, 4)] ?? 0) + 1;

  $("#reports-empty").hidden = list.length > 0;
  $("#reports-empty").textContent =
    "No complete months yet. Open your reviews on each site, sorted by newest, and go back past the start of last month. Then its report can be made.";
  $("#reports-controls").hidden = !list.length;

  if (!list.includes(selectedPeriod) && !yearList.includes(selectedPeriod)) {
    // Newest unopened report first (yearly before monthly), then the newest monthly report, then the newest month.
    const unopened = (p: string) => {
      const e = entryFor(p);
      return e && !e.opened;
    };
    selectedPeriod =
      yearList.find(unopened) ?? list.find(unopened) ?? list.find((m) => months[m]) ?? list[0] ?? "";
  }
  monthSel.replaceChildren(optionGroup("Years", yearList), optionGroup("Months", list));
  missingBtn.textContent = missingCount ? `Make missing reports (${missingCount})` : "Make missing reports";
  showSelectedReport();
}

/** Explains which site a month is still waiting for, with the choice to make the report without it. */
function showWaiting(waiting: Source[]) {
  const box = $("#report-sites");
  box.hidden = !waiting.length;
  if (!waiting.length) return box.replaceChildren();
  const names = siteNames(waiting);
  const p = document.createElement("p");
  p.textContent =
    `${monthName(selectedPeriod)} is not complete on ${names} yet. To include it, open ${names} sorted by newest ` +
    `and go back to ${monthName(selectedPeriod)}. Or leave it out:`;
  const without = document.createElement("button");
  without.type = "button";
  without.textContent = `Make without ${names}`;
  without.disabled = busy;
  without.onclick = () => makeMonth(selectedPeriod, waiting);
  const always = document.createElement("button");
  always.type = "button";
  always.textContent = `Always leave ${names} out`;
  always.title = "For this business. You can use it again from the Review history card.";
  always.disabled = busy;
  always.onclick = () => setSkipped(waiting, true);
  const row = document.createElement("div");
  row.className = "row";
  row.append(without, always);
  box.replaceChildren(p, row);
}

/** Leaves sites out of (or back in) this business's reports. */
async function setSkipped(sources: Source[], skip: boolean) {
  const profile = settings && activeProfile(settings);
  if (!profile) return;
  const now = new Set(profile.skippedSources ?? []);
  for (const s of sources) {
    if (skip) now.add(s);
    else now.delete(s);
  }
  profile.skippedSources = [...now];
  await saveSettings(settings);
}

function showSelectedReport() {
  const entry = entryFor(selectedPeriod);
  const waiting = waitingSites(selectedPeriod);
  showWaiting(waiting);
  makeBtn.textContent = entry ? "Make again" : "Make report";
  makeBtn.disabled = busy || !selectedPeriod || waiting.length > 0;
  missingBtn.disabled = busy || !missingCount;
  pdfBtn.hidden = !entry;
  reportEl.hidden = !entry;
  if (!entry) {
    reportEl.replaceChildren();
    return;
  }
  if (isYear(selectedPeriod)) {
    const year = entry as YearEntry;
    renderYearReport(reportEl, year, months, {
      previous: years[String(Number(selectedPeriod) - 1)],
      outdated: isYearOutdated(year, months),
    });
  } else {
    renderMonthReport(reportEl, entry as MonthEntry, months[previousMonth(selectedPeriod)]);
  }
  markShownReportOpened();
  if (printWhenReady) {
    printWhenReady = false;
    setTimeout(printReport, 300); // let the page finish drawing first
  }
}

/** A report counts as opened once the owner has it on screen. */
function markShownReportOpened() {
  const entry = entryFor(selectedPeriod);
  if (currentTab !== "reports" || !entry || entry.opened || !reportsFor) return;
  entry.opened = true; // locally too, so it is only sent once
  const msg: Message = { type: "markReportOpened", profileId: reportsFor, period: selectedPeriod };
  chrome.runtime.sendMessage(msg).catch(() => {});
}

monthSel.addEventListener("change", () => {
  selectedPeriod = monthSel.value;
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
  const period = selectedPeriod;
  if (!reportsFor || !period) return;
  if (entryFor(period) && !confirm(`Make the ${periodName(period)} report again? The current one will be replaced.`)) return;
  if (isYear(period)) {
    const n = missingByYear[period] ?? 0;
    runReportJob(
      { type: "makeYearReport", profileId: reportsFor, year: period },
      n
        ? `Making ${n} missing monthly report${n === 1 ? "" : "s"} first, then the ${period} report… This can take about a minute per report.`
        : `Making the ${period} report… This can take up to a minute.`,
    );
    return;
  }
  makeMonth(period);
});

/** Makes one month's report, leaving out `skip` sites for this report only. */
function makeMonth(month: string, skip: Source[] = []) {
  if (!reportsFor) return;
  if (skip.length && months[month] && !confirm(`Make the ${monthName(month)} report again? The current one will be replaced.`)) return;
  runReportJob(
    { type: "makeMonthReport", profileId: reportsFor, month, skip },
    `Making the ${monthName(month)} report${skip.length ? ` without ${siteNames(skip)}` : ""}… This can take up to a minute.`,
  );
}

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
  document.title = `ReviewReply – ${profile?.businessName || "Business"} – ${periodName(selectedPeriod)}`;
  window.addEventListener("afterprint", () => (document.title = old), { once: true });
  window.print();
}

pdfBtn.addEventListener("click", () => {
  if (isFull) return printReport();
  // Printing from the narrow side panel works badly, so the wide full view opens and prints instead.
  chrome.tabs.create({ url: `${fullViewUrl()}&tab=reports&report=${selectedPeriod}&print=1` });
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

/** "Jan 2026 – Sep 2026", or "" when there are no months. */
function monthSpan(list: string[]): string {
  return list.length ? `${monthLabel(monthStart(list[0]))} – ${monthLabel(monthStart(list[list.length - 1]))}` : "";
}

/** How to get a site's list into the order that proves months complete. */
const SORT_HELP: Record<Source, string> = {
  google: "Google's review list is not sorted by Newest. Switch the sort to Newest",
  tripadvisor: "Tripadvisor's review list is not sorted by Most recent, or a filter is on. Sort by Most recent without filters",
  facebook: "Facebook's reviews are not in order from newest to oldest. Open the page's Reviews tab",
};

/** Shows, per review site, how many reviews are saved for the selected business and which months are complete. */
async function renderHistory() {
  const profile = settings && activeProfile(settings);
  $("#history").hidden = !profile;
  if (!profile) return;
  const [reviews, info] = await Promise.all([loadReviews(profile.id), loadCollectInfo(profile.id)]);
  $("#history-business").textContent = profile.businessName || "(unnamed business)";
  const now = Date.now();

  // Sites with saved reviews or collection state, Google first.
  const sources = SOURCES.filter(
    (src) => collectedSources(info).includes(src) || reviews.some((r) => sourceOf(r) === src),
  );
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = "") => {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  $("#history-sites").replaceChildren(
    ...sources.map((src) => {
      const own = reviews.filter((r) => sourceOf(r) === src); // saved newest first
      const site = siteCollect(info, src);
      const complete = completeMonths(site?.coverage ?? [], now);
      const skipped = (profile.skippedSources ?? []).includes(src);
      const sub = [
        `${own.length} review${own.length === 1 ? "" : "s"}`,
        own.length ? `${monthLabel(own[own.length - 1].date)} – ${monthLabel(own[0].date)}` : "",
        site ? `collected ${daysAgoLabel(site.lastCollectedAt)}` : "",
        complete.length ? `complete ${monthSpan(complete)}` : "",
      ].filter(Boolean).join(" · ");
      const lastMonth = previousMonth(monthKey(now));

      const li = make("li", "list-item");
      const icon = make("span", `site-icon ${src}`, SOURCE_NAMES[src][0]);
      icon.setAttribute("aria-hidden", "true");
      const body = make("div", "body");
      body.append(make("div", "title", SOURCE_NAMES[src]), make("div", "sub", sub));
      li.append(icon, body);
      if (skipped) {
        const right = make("div", "body-right");
        const again = make("button", "link", "Use again");
        again.type = "button";
        again.onclick = () => setSkipped([src], false);
        right.append(make("span", "status off", "Left out"), document.createElement("br"), again);
        right.style.textAlign = "right";
        li.append(right);
      } else {
        li.append(
          complete.includes(lastMonth)
            ? make("span", "status done", "Up to date")
            : make("span", "status wait", "Needs a visit"),
        );
      }
      return li;
    }),
  );
  $("#history-count").textContent = reviews.length ? "" : "No reviews collected yet.";
  $("#history-count").hidden = !!reviews.length;

  const complete = completeMonths(coverageOf(info, profile.skippedSources), now);
  $("#history-complete").textContent = complete.length
    ? `Complete months${sources.length > 1 ? " on every site" : ""}: ${monthSpan(complete)}`
    : reviews.length
      ? "No complete months yet."
      : "";

  const unsorted = sources.filter((src) => siteCollect(info, src)?.lastSortedByNewest === false);
  $("#history-sort-warning").hidden = !unsorted.length;
  $("#history-sort-warning").textContent = unsorted
    .map((src) => `${SORT_HELP[src]} so ReviewReply can tell which months are complete.`)
    .join(" ");
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
  if (changes[monthsKey(profile.id)] || changes[yearsKey(profile.id)] || changes[collectKey(profile.id)]) renderReports();
});

/* ---------- Business profile ---------- */

/** Shows the compact row (name + Edit) or the form (fields + Save). */
function showProfileMode() {
  const p = settings && activeProfile(settings);
  if (!p) return;
  profileView.hidden = editing;
  profileForm.hidden = !editing;
  $("#pv-name").textContent = p.businessName || "(unnamed business)";
  $("#pv-type").textContent = [p.businessType, p.reportLanguage && `reports in ${p.reportLanguage}`].filter(Boolean).join(" · ");
}

$("#edit-profile").addEventListener("click", () => {
  editing = true;
  profileSaved.textContent = "";
  showProfileMode();
  $<HTMLInputElement>("#p-businessName").focus();
});

$("#cancel-profile").addEventListener("click", () => {
  const p = activeProfile(settings);
  if (!p) return;
  dirty = false;
  editing = !p.businessName.trim();
  fillProfileFields(profileForm, p);
  showProfileMode();
});

/** Saves the form into the selected business. */
async function saveProfile() {
  const p = activeProfile(settings);
  if (!p) return;
  readProfileFields(profileForm, p);
  dirty = false;
  editing = false;
  await saveSettings(settings);
  profileSaved.textContent = "Saved";
  showProfileMode();
}

profileForm.addEventListener("submit", (e) => {
  e.preventDefault();
  saveProfile();
});

bindProfileFields(profileForm, () => {
  dirty = true;
  profileSaved.textContent = "";
});

profileSel.addEventListener("change", async () => {
  const p = activeProfile(settings);
  if (dirty && p && confirm(`Save your changes to "${p.businessName || "this business"}" first?`)) await saveProfile();
  dirty = false;
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
