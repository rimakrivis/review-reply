import { OpenAIProvider } from "./ai/openai";
import { ProviderError } from "./ai/provider";
import { addToArchive } from "./archive";
import { buildPrompt } from "./prompt";
import { activeProfile, fullViewUrl, loadSettings } from "./storage";
import type { DraftRequest, DraftResponse, Message, Review } from "./types";

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
 * Runs storage jobs one after another. Google's page and its pop-up frame can send reviews at the same moment;
 * without the queue, two saves could read the same old list and one would overwrite the other.
 */
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
}

/** Saves reviews seen on a Google page under the business selected in the side panel. */
async function archive(reviews: Review[], sortedByNewest?: boolean): Promise<number> {
  const profile = activeProfile(await loadSettings());
  if (!profile || !reviews.length) return 0;
  return addToArchive(profile.id, reviews, sortedByNewest);
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
