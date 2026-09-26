import { OpenAIProvider } from "./ai/openai";
import { ProviderError } from "./ai/provider";
import { buildPrompt } from "./prompt";
import { activeProfile, loadSettings, PENDING_KEY } from "./storage";
import type { DraftRequest, DraftResponse, Message } from "./types";

const MENU_ID = "review-reply-draft";


chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Draft a reply to this review",
    contexts: ["selection"],
  });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText) return;
  // Open first: sidePanel.open must run synchronously inside the user gesture.
  if (tab?.windowId !== undefined) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
  chrome.storage.session.set({
    [PENDING_KEY]: { text: info.selectionText, at: Date.now() },
  });
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

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  if (msg.type === "draft") {
    draft(msg.request, msg.profileId).then(sendResponse);
    return true; // keep the channel open for the async answer
  }
  if (msg.type === "openOptions") {
    chrome.runtime.openOptionsPage();
  }
  return false;
});
