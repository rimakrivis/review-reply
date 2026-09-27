import { OpenAIProvider } from "./ai/openai";
import { ProviderError } from "./ai/provider";
import { buildPrompt } from "./prompt";
import { activeProfile, fullViewUrl, loadSettings } from "./storage";
import type { DraftRequest, DraftResponse, Message } from "./types";

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

chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
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
