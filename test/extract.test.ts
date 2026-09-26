// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractReview, findReviewContainer, parseRating } from "../src/content/extract";
import { fillEditor, scan } from "../src/content/content";

/** A card shaped like Google's owner review list: no data attributes, obfuscated classes. */
function card(name: string, stars: string, text: string, extra = "") {
  return `
    <div class="xK3a">
      <div class="aB"><img aria-hidden="true" alt=""><a class="n1">${name}</a><div class="m">Local Guide · 23 reviews</div></div>
      <div class="r"><span role="img" aria-label="${stars}"><span>★★★★</span></span><span class="d">2 weeks ago</span></div>
      <div class="t"><span>${text}</span><button>More</button></div>
      ${extra}
      <div class="rep"><textarea aria-label="Reply"></textarea></div>
    </div>`;
}

beforeEach(() => {
  document.body.innerHTML = `
    <header><textarea name="q" role="combobox"></textarea><textarea class="other"></textarea></header>
    <div class="list">
      ${card("Anna K.", "Rated 4.0 out of 5,", "Great cocktails, friendly staff.")}
      ${card("Jonas", "1 star", "Waited <b>forever</b> for a drink.",
        `<div class="own"><div>Response from the owner</div><div>Sorry Jonas, we will do better.</div></div>`)}
    </div>`;
});

describe("parseRating", () => {
  it("reads common label formats", () => {
    expect(parseRating("Rated 4.0 out of 5,")).toBe(4);
    expect(parseRating("5 stars")).toBe(5);
    expect(parseRating("1 star")).toBe(1);
    expect(parseRating("3/5")).toBe(3);
    expect(parseRating("4,0 out of 5")).toBe(4);
    expect(parseRating("Reply")).toBe(0);
  });
});

describe("findReviewContainer", () => {
  it("finds the single review around a reply box", () => {
    const [a, b] = document.querySelectorAll(".rep textarea");
    expect(findReviewContainer(a)?.className).toBe("xK3a");
    expect(findReviewContainer(b)).not.toBe(findReviewContainer(a));
  });
  it("ignores boxes that are not inside one review", () => {
    expect(findReviewContainer(document.querySelector(".other")!)).toBeNull();
  });
  it("prefers data-review-id when present", () => {
    document.body.innerHTML = `<div data-review-id="x"><div><textarea></textarea></div></div>`;
    expect(findReviewContainer(document.querySelector("textarea")!)?.getAttribute("data-review-id")).toBe("x");
  });
});

describe("extractReview", () => {
  it("reads name, stars and text, skipping dates, badges, stars and buttons", () => {
    const c = findReviewContainer(document.querySelectorAll(".rep textarea")[0])!;
    expect(extractReview(c)).toEqual({ reviewerName: "Anna K.", rating: 4, text: "Great cocktails, friendly staff." });
  });
  it("excludes the owner's existing reply and joins split text", () => {
    const c = findReviewContainer(document.querySelectorAll(".rep textarea")[1])!;
    const r = extractReview(c);
    expect(r.rating).toBe(1);
    expect(r.text.replace(/\n/g, " ")).toBe("Waited forever for a drink.");
    expect(r.text).not.toMatch(/Sorry Jonas/);
  });
});

describe("content script", () => {
  it("adds one draft bar per review reply box, never to search boxes", () => {
    expect(scan()).toBe(2);
    expect(scan()).toBe(0); // idempotent
    const hosts = document.querySelectorAll("[data-review-reply-ui]");
    expect(hosts.length).toBe(2);
    expect(document.querySelector("header [data-review-reply-ui]")).toBeNull();
  });

  it("fills the reply box so the page notices", () => {
    const ta = document.querySelector<HTMLTextAreaElement>(".rep textarea")!;
    const onInput = vi.fn();
    ta.addEventListener("input", onInput);
    fillEditor(ta, "Thank you!");
    expect(ta.value).toBe("Thank you!");
    expect(onInput).toHaveBeenCalled();
  });

  it("drafts through the background worker when the button is clicked", async () => {
    const sendMessage = vi.fn(async () => ({
      ok: true, profileName: "Fox", result: { situation: "Drinks praise", confidence: "high", reply: "Thanks Anna!" },
    }));
    (globalThis as any).chrome = { runtime: { sendMessage } };
    scan();
    const host = document.querySelector("[data-review-reply-ui]")!;
    host.shadowRoot!.querySelector<HTMLButtonElement>("button.primary")!.click();
    await vi.waitFor(() => expect(document.querySelector<HTMLTextAreaElement>(".rep textarea")!.value).toBe("Thanks Anna!"));
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "draft",
      request: expect.objectContaining({ review: { reviewerName: "Anna K.", rating: 4, text: "Great cocktails, friendly staff." } }),
    }));
    expect(host.shadowRoot!.querySelector(".status")!.textContent).toContain("Drinks praise");
    delete (globalThis as any).chrome;
  });
});
