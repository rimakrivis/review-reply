import { OpenAIProvider } from "./ai/openai";
import { ProviderError } from "./ai/provider";
import {
  addToArchive,
  isMonthComplete,
  loadCollectInfo,
  loadMonths,
  loadReviews,
  missingMonths,
  monthsKey,
  previousMonth,
  reviewsInMonth,
  saveMonthEntry,
  statsFor,
} from "./archive";
import { buildPrompt } from "./prompt";
import { buildMonthPrompt, monthName, reviewsForReport } from "./report-prompt";
import { activeProfile, fullViewUrl, loadSettings } from "./storage";
import type { DraftRequest, DraftResponse, Message, ReportResponse, Review } from "./types";

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
  if (!request.review.text.trim() && !request.review.rating) {
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

/** Saves reviews seen on a Google page under the business selected in the side panel. */
async function archive(reviews: Review[], sortedByNewest?: boolean): Promise<number> {
  const profile = activeProfile(await loadSettings());
  if (!profile || !reviews.length) return 0;
  return addToArchive(profile.id, reviews, sortedByNewest);
}

/* ---------- Monthly reports ---------- */

/** Counts one month's stars, asks the AI for the report (when there are reviews) and saves it. */
async function makeMonthReport(profileId: string, month: string): Promise<void> {
  const settings = await loadSettings();
  const profile = settings.profiles.find((p) => p.id === profileId);
  if (!profile) throw new ProviderError("This business profile no longer exists.");
  const [reviews, info, months] = await Promise.all([
    loadReviews(profileId),
    loadCollectInfo(profileId),
    loadMonths(profileId),
  ]);
  const now = Date.now();
  if (!isMonthComplete(info?.coverage ?? [], month, now)) {
    throw new ProviderError(
      `${monthName(month)} is not complete yet. Sort your Google reviews by Newest and scroll back to ${monthName(month)}.`,
    );
  }
  const monthReviews = reviewsInMonth(reviews, month);
  const stats = statsFor(monthReviews);
  let report = null;
  if (monthReviews.length) {
    const listed = reviewsForReport(monthReviews);
    const prompt = buildMonthPrompt(profile, month, listed, stats, months[previousMonth(month)]);
    report = await new OpenAIProvider(settings.apiKey, settings.model).summarizeMonth(prompt, listed);
  }
  await saveMonthEntry(profileId, { month, stats, report, createdAt: now, opened: false });
}

/** Makes a report for every complete month that has none, oldest first, so each can compare with the one before. */
async function makeMissingReports(profileId: string): Promise<number> {
  const [info, months] = await Promise.all([loadCollectInfo(profileId), loadMonths(profileId)]);
  const todo = missingMonths(info?.coverage ?? [], months, Date.now());
  for (const month of todo) await makeMonthReport(profileId, month);
  return todo.length;
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

async function markReportOpened(profileId: string, month: string): Promise<void> {
  const months = await loadMonths(profileId);
  if (!months[month] || months[month].opened) return;
  months[month] = { ...months[month], opened: true };
  await chrome.storage.local.set({ [monthsKey(profileId)]: months });
}

chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
  if (msg.type === "archiveReviews") {
    enqueue(() => archive(msg.reviews, msg.sortedByNewest)).catch((e) => console.warn("[ReviewReply] Could not save reviews", e));
    return false;
  }
  if (msg.type === "draft") {
    draft(msg.request, msg.profileId).then(sendResponse);
    return true; // keep the channel open for the async answer
  }
  if (msg.type === "makeMonthReport") {
    reportJob(async () => {
      await makeMonthReport(msg.profileId, msg.month);
      return 1;
    }).then(sendResponse);
    return true;
  }
  if (msg.type === "makeMissingReports") {
    reportJob(() => makeMissingReports(msg.profileId)).then(sendResponse);
    return true;
  }
  if (msg.type === "markReportOpened") {
    enqueueReport(() => markReportOpened(msg.profileId, msg.month)).catch((e) => console.warn("[ReviewReply] Could not mark report", e));
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
