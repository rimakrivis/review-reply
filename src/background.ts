import { OpenAIProvider } from "./ai/openai";
import { ProviderError } from "./ai/provider";
import {
  addToArchive,
  coverageOf,
  monthSites,
  type PageSeen,
  loadCollectInfo,
  loadMonths,
  loadReviews,
  loadYears,
  missingMonths,
  monthsKey,
  monthsOfYear,
  previousMonth,
  reviewsInMonth,
  saveMonthEntry,
  saveYearEntry,
  sitesInUse,
  sourceOf,
  statsBySource,
  statsFor,
  sumBySource,
  sumStats,
  yearsKey,
} from "./archive";
import { buildPrompt } from "./prompt";
import { buildMonthPrompt, monthName, reviewsForReport } from "./report-prompt";
import { activeProfile, fullViewUrl, loadSettings } from "./storage";
import { SOURCE_NAMES, type DraftRequest, type DraftResponse, type Message, type MonthEntry, type ReportResponse, type Review, type Source } from "./types";
import { buildYearPrompt, isYear } from "./year-report";

chrome.runtime.onInstalled.addListener((details) => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});

async function draft(request: DraftRequest, profileId?: string): Promise<DraftResponse> {
  const settings = await loadSettings();
  const profile = activeProfile(settings, profileId);
  if (!profile) {
    return { ok: false, needsSetup: true, error: "Create a business profile in Settings first." };
  }
  if (!request.review.text.trim() && !request.review.rating && request.review.recommends === undefined) {
    return { ok: false, error: "There is no review text or rating to reply to." };
  }
  try {
    const provider = new OpenAIProvider(settings.apiKey, settings.model);
    const result = await provider.draft(buildPrompt(profile, request));
    return { ok: true, result, profileName: profile.businessName };
  } catch (e) {
    if (e instanceof ProviderError) return { ok: false, error: e.message, needsSetup: e.needsSetup };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * A queue runs storage jobs one after another. Google's page and its pop-up frame can send reviews at the same
 * moment; without a queue, two saves could read the same old list and one would overwrite the other.
 */
function makeQueue() {
  let queue: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const run = queue.then(job, job);
    queue = run.catch(() => {});
    return run;
  };
}

/** Saving reviews. */
const enqueue = makeQueue();
/** Making reports and changing saved months. Separate, so a slow AI request never holds up saving reviews. */
const enqueueReport = makeQueue();

/**
 * Keeps the background worker awake during a long job. Chrome stops it after 30 seconds without extension activity,
 * and a report request can take longer; any extension API call counts as activity.
 */
async function keepAwake<T>(job: () => Promise<T>): Promise<T> {
  const timer = setInterval(() => chrome.runtime.getPlatformInfo(), 20_000);
  try {
    return await job();
  } finally {
    clearInterval(timer);
  }
}

/** Saves reviews seen on a review page under the business selected in the side panel. */
async function archive(reviews: Review[], seen: PageSeen): Promise<number> {
  const profile = activeProfile(await loadSettings());
  if (!profile || !reviews.length) return 0;
  return addToArchive(profile.id, reviews, seen);
}

/* ---------- Monthly reports ---------- */

/** The sites the owner always leaves out of this business's reports. */
async function skippedSources(profileId: string): Promise<Source[]> {
  const profile = (await loadSettings()).profiles.find((p) => p.id === profileId);
  return profile?.skippedSources ?? [];
}

/**
 * Counts one month's stars, asks the AI for the report (when there are reviews) and saves it. Uses the reviews of
 * every site in use, except the ones left out (always, in the profile, or for this report in `skip`). Refuses while
 * a site in use is not complete for the month, so no site is left out by accident.
 */
async function makeMonthReport(profileId: string, month: string, skip: Source[] = []): Promise<void> {
  const settings = await loadSettings();
  const profile = settings.profiles.find((p) => p.id === profileId);
  if (!profile) throw new ProviderError("This business profile no longer exists.");
  const [reviews, info, months] = await Promise.all([
    loadReviews(profileId),
    loadCollectInfo(profileId),
    loadMonths(profileId),
  ]);
  const now = Date.now();
  const leftOut = [...(profile.skippedSources ?? []), ...skip];
  const { ready, waiting } = monthSites(info, month, now, leftOut);
  if (!ready.length) {
    throw new ProviderError(
      `${monthName(month)} is not complete yet. Open your reviews sorted by newest and go back to ${monthName(month)}.`,
    );
  }
  if (waiting.length) {
    const names = waiting.map((s) => SOURCE_NAMES[s]).join(" and ");
    throw new ProviderError(`${monthName(month)} is not complete on ${names} yet. Open it there, or make the report without it.`);
  }
  // Only sites in use that were left out are worth mentioning in the report.
  const skipped = sitesInUse(info).filter((s) => leftOut.includes(s));
  const monthReviews = reviewsInMonth(reviews, month).filter((r) => ready.includes(sourceOf(r)));
  const stats = statsFor(monthReviews);
  let report = null;
  if (monthReviews.length) {
    const listed = reviewsForReport(monthReviews);
    const prompt = buildMonthPrompt(profile, month, listed, stats, months[previousMonth(month)]);
    report = await new OpenAIProvider(settings.apiKey, settings.model).summarizeMonth(prompt, listed);
  }
  const entry: MonthEntry = { month, stats, bySource: statsBySource(monthReviews), report, createdAt: now, opened: false };
  if (skipped.length) entry.skipped = skipped;
  await saveMonthEntry(profileId, entry);
}

/**
 * Makes a report for every month complete on all sites in use that has none, oldest first, so each can compare
 * with the one before. Months still waiting for a site are left for the owner to decide.
 */
async function makeMissingReports(profileId: string): Promise<number> {
  const [info, months, skip] = await Promise.all([loadCollectInfo(profileId), loadMonths(profileId), skippedSources(profileId)]);
  const todo = missingMonths(coverageOf(info, skip), months, Date.now());
  for (const month of todo) await makeMonthReport(profileId, month);
  return todo.length;
}

/* ---------- Yearly reports ---------- */

/**
 * Makes the year's missing monthly reports, then the yearly report from all of them. The year may be unfinished:
 * the report then covers the months so far. Returns how many reports were made.
 */
async function makeYearReport(profileId: string, year: string): Promise<number> {
  const [info, before, skip] = await Promise.all([loadCollectInfo(profileId), loadMonths(profileId), skippedSources(profileId)]);
  const todo = missingMonths(coverageOf(info, skip), before, Date.now()).filter((m) => m.startsWith(`${year}-`));
  for (const month of todo) await makeMonthReport(profileId, month);

  const settings = await loadSettings();
  const profile = settings.profiles.find((p) => p.id === profileId);
  if (!profile) throw new ProviderError("This business profile no longer exists.");
  const [months, years] = await Promise.all([loadMonths(profileId), loadYears(profileId)]);
  const entries = monthsOfYear(months, year);
  if (!entries.length) {
    throw new ProviderError(
      `There are no complete months in ${year} yet. Open each review site's list sorted by newest and go back into ${year}.`,
    );
  }
  const stats = sumStats(entries.map((e) => e.stats));
  let report = null;
  if (entries.some((e) => e.report)) {
    const prompt = buildYearPrompt(profile, year, entries, stats, years[String(Number(year) - 1)]);
    report = await new OpenAIProvider(settings.apiKey, settings.model).summarizeYear(prompt, entries);
  }
  await saveYearEntry(profileId, {
    year,
    months: entries.map((e) => e.month),
    stats,
    bySource: sumBySource(entries.map((e) => e.bySource ?? { google: e.stats })),
    report,
    createdAt: Date.now(),
    opened: false,
  });
  return todo.length + 1;
}

/** Runs a report job in the report queue and turns errors into a message for the page. */
async function reportJob(job: () => Promise<number>): Promise<ReportResponse> {
  try {
    return { ok: true, made: await enqueueReport(() => keepAwake(job)) };
  } catch (e) {
    if (e instanceof ProviderError) return { ok: false, error: e.message, needsSetup: e.needsSetup };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** `period` is a month ("2026-08") or a year ("2026"). */
async function markReportOpened(profileId: string, period: string): Promise<void> {
  const [key, saved] = isYear(period)
    ? [yearsKey(profileId), await loadYears(profileId)]
    : [monthsKey(profileId), await loadMonths(profileId)];
  const entry = saved[period];
  if (!entry || entry.opened) return;
  await chrome.storage.local.set({ [key]: { ...saved, [period]: { ...entry, opened: true } } });
}

chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
  if (msg.type === "archiveReviews") {
    enqueue(() => archive(msg.reviews, { source: msg.source, sortedByNewest: msg.sortedByNewest, page: msg.page })).catch((e) => console.warn("[ReviewReply] Could not save reviews", e));
    return false;
  }
  if (msg.type === "draft") {
    draft(msg.request, msg.profileId).then(sendResponse);
    return true; // keep the channel open for the async answer
  }
  if (msg.type === "makeMonthReport") {
    reportJob(async () => {
      await makeMonthReport(msg.profileId, msg.month, msg.skip);
      return 1;
    }).then(sendResponse);
    return true;
  }
  if (msg.type === "makeMissingReports") {
    reportJob(() => makeMissingReports(msg.profileId)).then(sendResponse);
    return true;
  }
  if (msg.type === "makeYearReport") {
    reportJob(() => makeYearReport(msg.profileId, msg.year)).then(sendResponse);
    return true;
  }
  if (msg.type === "markReportOpened") {
    enqueueReport(() => markReportOpened(msg.profileId, msg.period)).catch((e) => console.warn("[ReviewReply] Could not mark report", e));
    return false;
  }
  if (msg.type === "openOptions") {
    chrome.runtime.openOptionsPage();
  }
  if (msg.type === "openFull") {
    chrome.tabs.create({ url: fullViewUrl() });
  }
  if (msg.type === "openPanel") {
    const windowId = sender.tab?.windowId;
    if (windowId === undefined) {
      chrome.tabs.create({ url: fullViewUrl() });
      return false;
    }
    // No await before open(): Chrome only allows it while the owner's click still counts.
    chrome.sidePanel.open({ windowId }).catch(() => chrome.tabs.create({ url: fullViewUrl() }));
  }
  return false;
});
