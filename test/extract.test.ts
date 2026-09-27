// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractAllReviews,
  extractReview,
  findReviewContainer,
  parseRating,
  isSortedByNewest,
  parseReviewDate,
  splitDetails,
} from "../src/content/extract";
import { collect, fillEditor, scan } from "../src/content/content";

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
    const now = Date.UTC(2026, 8, 27);
    expect(extractReview(c, now)).toEqual({
      reviewerName: "Anna K.",
      rating: 4,
      text: "Great cocktails, friendly staff.",
      date: now - 14 * 86_400_000, // "2 weeks ago"
      dateIsRough: false,
      hasOwnerReply: false,
    });
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
      request: expect.objectContaining({
        review: expect.objectContaining({ reviewerName: "Anna K.", rating: 4, text: "Great cocktails, friendly staff." }),
      }),
    }));
    expect(host.shadowRoot!.querySelector(".status")!.textContent).toContain("Drinks praise");
    delete (globalThis as any).chrome;
  });
});

describe("parseReviewDate", () => {
  const now = Date.UTC(2026, 8, 27, 12);
  const DAY = 86_400_000;

  it("reads Google's relative English dates", () => {
    expect(parseReviewDate("3 days ago", now)).toEqual({ date: now - 3 * DAY, rough: false });
    expect(parseReviewDate("a week ago", now)).toEqual({ date: now - 7 * DAY, rough: false });
    expect(parseReviewDate("Edited 2 weeks ago", now)).toEqual({ date: now - 14 * DAY, rough: false });
    expect(parseReviewDate("yesterday", now)).toEqual({ date: now - DAY, rough: false });
  });

  it("marks months and years as rough", () => {
    expect(parseReviewDate("2 months ago", now)).toEqual({ date: now - 60 * DAY, rough: true });
    expect(parseReviewDate("a year ago", now)).toEqual({ date: now - 365 * DAY, rough: true });
  });

  it("reads Lithuanian dates", () => {
    expect(parseReviewDate("prieš 3 dienas", now)).toEqual({ date: now - 3 * DAY, rough: false });
    expect(parseReviewDate("prieš mėnesį", now)).toEqual({ date: now - 30 * DAY, rough: true });
    expect(parseReviewDate("Redaguota prieš 2 metus", now)).toEqual({ date: now - 730 * DAY, rough: true });
  });

  it("reads full dates", () => {
    expect(new Date(parseReviewDate("March 5, 2025", now)!.date).getDate()).toBe(5);
    expect(new Date(parseReviewDate("5 March 2025", now)!.date).getMonth()).toBe(2);
  });

  it("ignores text that is not a date", () => {
    expect(parseReviewDate("Great cocktails", now)).toBeNull();
    expect(parseReviewDate("Local Guide · 23 reviews", now)).toBeNull();
  });
});

describe("extractAllReviews", () => {
  it("finds every dated review, skips the overall rating and notices owner replies", () => {
    document.body.innerHTML = `
      <div class="summary"><span aria-label="Rated 4.5 out of 5"></span> 4.5 · 120 reviews</div>
      <div class="list">
        ${card("Anna K.", "Rated 4.0 out of 5,", "Great cocktails, friendly staff.")}
        ${card("Jonas", "1 star", "Waited forever.",
          `<div class="own"><div>Response from the owner</div><div>Sorry Jonas.</div></div>`)}
      </div>`;
    const reviews = extractAllReviews(document, Date.UTC(2026, 8, 27));
    expect(reviews.map((r) => [r.reviewerName, r.rating, r.hasOwnerReply])).toEqual([
      ["Anna K.", 4, false],
      ["Jonas", 1, true],
    ]);
    expect(reviews.every((r) => typeof r.date === "number")).toBe(true);
  });
});

describe("collect", () => {
  it("sends the page's reviews once, and again only when they change", () => {
    const sendMessage = vi.fn(() => Promise.resolve());
    (globalThis as any).chrome = { runtime: { id: "test", sendMessage } };
    collect(); // no sort button yet: the search page's previews are not saved
    expect(sendMessage).not.toHaveBeenCalled();
    document.body.insertAdjacentHTML("afterbegin", `<button aria-label="Newest" aria-expanded="false">Newest</button>`);
    collect();
    collect();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "archiveReviews",
        sortedByNewest: true,
        reviews: expect.arrayContaining([expect.objectContaining({ reviewerName: "Anna K." })]),
      }),
    );
    document.querySelector(".list")!.insertAdjacentHTML("beforeend", card("Mia", "5 stars", "Lovely!"));
    collect();
    expect(sendMessage).toHaveBeenCalledTimes(2);
    delete (globalThis as any).chrome;
  });
});

/** The shape of a review in Google's business review pop-up (2026), with made-up content. */
const GOOGLE_CARD = `
  <div class="kx2i0d">
    <article aria-label="Review">
      <div><a aria-label="Link to reviewer profile">Sam Test<i aria-hidden="true">open_in_new</i></a>
        <div>1 review • 0 photos</div></div>
      <div data-review-id="ABC123"><button aria-label="Report review"></button></div>
      <span><div><span role="img" aria-label="2 out of 5 stars"><i aria-hidden="true">star</i></span>
        <span> 19 hours ago</span> <span>New</span></div>
        <div><div style="display: none;">Slow bar, pricey drinks <a role="button">View full review</a></div>
          <div>Slow bar, pricey drinks<div><div>
            <span>Food: </span><span>4/5</span><span>Service: </span><span>1/5</span>
            <span>Atmosphere: </span><span>3/5</span>
          </div></div></div></div></span>
    </article>
    <div class="reply"><div><div>Test Bar &amp; Lounge</div><div>Owner</div></div>
      <div> 6 hours ago</div><div>Sorry to hear that, Sam.</div>
      <button>Edit</button><button>Delete</button></div>
  </div>`;

describe("Google's review pop-up layout", () => {
  const now = Date.UTC(2026, 8, 27, 12);

  it("reads the guest's words once, without hidden copies, sub-ratings or the owner's reply", () => {
    document.body.innerHTML = `<div class="list">${GOOGLE_CARD}</div>`;
    const [r] = extractAllReviews(document, now);
    expect(r).toEqual({
      reviewerName: "Sam Test",
      rating: 2,
      text: "Slow bar, pricey drinks",
      details: { Food: "4/5", Service: "1/5", Atmosphere: "3/5" },
      hasOwnerReply: true,
      googleId: "ABC123",
      date: now - 19 * 3_600_000,
      dateIsRough: false,
    });
  });

  it("separates Google's extra answers from the guest's words", () => {
    expect(splitDetails(["€10–20", "Great night out", "Group size", "3-4 people", "Noise level", "Quiet"])).toEqual({
      details: { "Price per person": "€10–20", "Group size": "3-4 people", "Noise level": "Quiet" },
      rest: ["Great night out"],
    });
    expect(splitDetails(["Tip: ask for Mia"]).rest).toEqual(["Tip: ask for Mia"]); // not a Google label
  });
});

describe("isSortedByNewest", () => {
  it("reads the visible word on the button, and ignores the menu's items", () => {
    const menu = `<ul role="menu"><li role="menuitem"><span>Most relevant</span></li><li role="menuitem"><span>Newest</span></li></ul>`;
    document.body.innerHTML = `${menu}<button><svg></svg><span aria-hidden="true">Most relevant</span></button>`;
    expect(isSortedByNewest(document)).toBe(false);
    document.body.innerHTML = `${menu}<button><svg></svg><span aria-hidden="true">Newest</span></button>`;
    expect(isSortedByNewest(document)).toBe(true);
    document.body.innerHTML = menu; // menu items alone are not the button
    expect(isSortedByNewest(document)).toBeUndefined();
  });

  it("reads Google's sort button", () => {
    document.body.innerHTML = `<button aria-label="Newest" aria-expanded="false">Newest</button>`;
    expect(isSortedByNewest(document)).toBe(true);
    document.body.innerHTML = `<button aria-label="Most relevant" aria-expanded="false">Most relevant</button>`;
    expect(isSortedByNewest(document)).toBe(false);
    document.body.innerHTML = `<p>No sort button here</p>`;
    expect(isSortedByNewest(document)).toBeUndefined();
  });
});

describe("after the extension is reloaded", () => {
  it("an old copy of the script stays quiet instead of throwing errors", () => {
    (globalThis as any).chrome = { runtime: {} }; // no id: the connection to the extension is gone
    document.body.insertAdjacentHTML("afterbegin", `<button aria-label="Newest" aria-expanded="false">Newest</button>`);
    expect(() => collect()).not.toThrow();
    delete (globalThis as any).chrome;
  });
});
