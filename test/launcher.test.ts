// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampPos,
  hasOwnerReviews,
  initLauncher,
  LAUNCHER_ATTR,
  resetLauncher,
  REVIEWS_FOUND,
} from "../src/content/launcher";

type Listener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;

let stored: Record<string, unknown>;
let listeners: Listener[];
const sendMessage = vi.fn(() => Promise.resolve());

beforeEach(() => {
  stored = { settings: { showLauncher: true } };
  listeners = [];
  sendMessage.mockClear();
  vi.stubGlobal("chrome", {
    runtime: { id: "test", sendMessage },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: stored[key] }),
        set: async (items: Record<string, unknown>) => {
          Object.assign(stored, items);
          for (const [k, v] of Object.entries(items)) listeners.forEach((l) => l({ [k]: { newValue: v } }, "local"));
        },
      },
      onChanged: { addListener: (l: Listener) => listeners.push(l) },
    },
  });
});

afterEach(() => {
  resetLauncher();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const REVIEW = `
  <div class="card">
    <a>Anna K.</a>
    <span role="img" aria-label="Rated 4.0 out of 5"></span>
    <span>Great cocktails.</span>
    <button>Reply</button>
  </div>`;

const launcher = () => document.querySelector(`[${LAUNCHER_ATTR}]`);
const menuButton = (action: string) =>
  launcher()!.shadowRoot!.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;

describe("hasOwnerReviews", () => {
  it("is false on a normal search page with ratings but no Reply buttons", () => {
    document.body.innerHTML = `<div><span aria-label="Rated 4.5 out of 5"></span> Some restaurant</div>`;
    expect(hasOwnerReviews()).toBe(false);
  });

  it("is true when a review has a Reply button", () => {
    document.body.innerHTML = REVIEW;
    expect(hasOwnerReviews()).toBe(true);
  });

  it("understands Google in Lithuanian", () => {
    document.body.innerHTML = REVIEW.replace("<button>Reply</button>", `<div jsaction="x">Atsakyti</div>`);
    expect(hasOwnerReviews()).toBe(true);
  });
});

describe("clampPos", () => {
  it("keeps the button inside the window", () => {
    expect(clampPos({ right: -20, bottom: 5000 }, 800, 600)).toEqual({ right: 0, bottom: 552 });
  });
});

describe("launcher", () => {
  it("does not appear on a page without reviews", async () => {
    document.body.innerHTML = `<p>Search results</p>`;
    await initLauncher();
    expect(launcher()).toBeNull();
  });

  it("appears once on a page with reviews", async () => {
    document.body.innerHTML = REVIEW;
    await initLauncher();
    await initLauncher();
    expect(document.querySelectorAll(`[${LAUNCHER_ATTR}]`)).toHaveLength(1);
  });

  it("appears when a pop-up frame inside the page reports reviews", async () => {
    document.body.innerHTML = `<p>Search results</p>`;
    await initLauncher();
    expect(launcher()).toBeNull();
    window.dispatchEvent(new MessageEvent("message", { data: { type: REVIEWS_FOUND } }));
    expect(launcher()).not.toBeNull();
  });

  it("stays hidden when the owner turned it off", async () => {
    stored.settings = { showLauncher: false };
    document.body.innerHTML = REVIEW;
    await initLauncher();
    expect(launcher()).toBeNull();
  });

  it("opens the side panel and the full view from its menu", async () => {
    document.body.innerHTML = REVIEW;
    await initLauncher();
    const fab = launcher()!.shadowRoot!.querySelector<HTMLButtonElement>(".fab")!;
    fab.click();
    expect(launcher()!.shadowRoot!.querySelector<HTMLElement>(".menu")!.hidden).toBe(false);
    menuButton("panel").click();
    expect(sendMessage).toHaveBeenLastCalledWith({ type: "openPanel" });
    menuButton("full").click();
    expect(sendMessage).toHaveBeenLastCalledWith({ type: "openFull" });
  });

  it("hides itself and saves the setting", async () => {
    document.body.innerHTML = REVIEW;
    await initLauncher();
    menuButton("hide").click();
    await vi.waitFor(() => expect(launcher()).toBeNull());
    expect((stored.settings as { showLauncher: boolean }).showLauncher).toBe(false);
  });
});
