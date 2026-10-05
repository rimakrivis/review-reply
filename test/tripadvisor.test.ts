// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  extractAllTripadvisorReviews,
  extractTripadvisorReview,
  findTripadvisorContainer,
  isTripadvisorOwnerPage,
  isTripadvisorSortedByNewest,
  tripadvisorPageInfo,
} from "../src/content/tripadvisor";
import { siteFor } from "../src/content/sites";

/** Shaped like Tripadvisor's owner page (tripadvisor.com/reviews): obfuscated classes, list items are buttons. */
const bubbles = (n: number) =>
  `<svg role="img" class="UctUV" data-automation="bubbleRatingImage" aria-labelledby="t${n}"><title id="t${n}">${n} of 5 bubbles</title><path></path></svg>`;

const item = (name: string, date: string, n: number, title: string, text: string, replied = false) => `
  <button class="onXpl"><div class="pChLG"><img alt="reviewer logo"><div><div class="biGQs">${name}</div><div class="biGQs">${date}</div></div></div>
    <div class="DyFaS"><div>${bubbles(n)}</div><div><svg aria-hidden="true"></svg></div>
    <div><div>${title}</div></div><div><div>${text}</div></div>
    <div><div>${date}</div>${replied ? "<div>Response published</div>" : ""}</div></div>
    <div><div>${replied ? "<div>Response published</div>" : "<div></div>"}</div></div>
  </button>`;

function page({ sort = "Most recent", total = 513, shown = 513 } = {}) {
  return `
    <div class="header"><div>4.1</div><span>|</span><span>${total} reviews</span></div>
    <div><button>Filters</button><button>No response</button></div>
    <div><div><strong>30 of ${shown}</strong> reviews </div><div>Sorted by: ${sort}</div></div>
    <div id="REVIEWS"><div class="kXCMl">
      <div data-review-gid="taur:111">
        <div><button class="kCViF"><div><span>guest_one</span><div><span>4 contributions</span></div></div></button>
        <div class="xUqsL"><div>${bubbles(5)}</div>
          <div>Review from Sep 24, 2026</div><div>Great</div>
          <div><div><span>Really nice place, great vibes.</span></div>
            <div><button>Select as favorite</button><span>Premium subscribers can select eligible reviews.</span>
            <button><span>Report Review</span></button><a>How to Respond: Top Tips</a></div></div>
          <div class="roAGK"><textarea placeholder="Your response"></textarea>
            <div>Your name will display as <span>Lost in Amsterdam</span>, <span>Marketing</span></div>
            <button type="submit" disabled>Submit</button></div>
        </div></div>
      </div>
      ${item("traveller_two", "Sep 23, 2026", 1, "Short changed...", "Had been going each time I visited, bought a coffee and p...")}
      ${item("Guest Three", "Nov 30, 2024", 2, "Health and safety", "Seated downstairs.", true)}
    </div></div>
    <div>Showing results 1-30 of ${shown}</div>`;
}

const ownerUrl = { hostname: "www.tripadvisor.com", pathname: "/reviews" };

describe("Tripadvisor pages", () => {
  it("recognises the owner pages and picks the Tripadvisor reader", () => {
    expect(isTripadvisorOwnerPage(ownerUrl)).toBe(true);
    expect(isTripadvisorOwnerPage({ hostname: "www.tripadvisor.nl", pathname: "/Restaurant_Review-g188590-d4208377" })).toBe(false);
    expect(siteFor({ hostname: "www.tripadvisor.co.uk" }).source).toBe("tripadvisor");
    expect(siteFor({ hostname: "business.google.com" }).source).toBe("google");
  });

  it("reads the opened review with its full text and reply box", () => {
    document.body.innerHTML = page();
    const box = findTripadvisorContainer(document.querySelector("textarea")!)!;
    const r = extractTripadvisorReview(box);
    expect(r).toEqual({
      source: "tripadvisor",
      reviewerName: "guest_one",
      rating: 5,
      text: "Great\nReally nice place, great vibes.",
      date: new Date(2026, 8, 24).getTime(),
      dateIsRough: false,
      hasOwnerReply: false,
      googleId: "taur:111",
    });
  });

  it("reads the list: shortened texts, replies, and no duplicates of the opened review", () => {
    document.body.innerHTML = page();
    const all = extractAllTripadvisorReviews(document);
    expect(all.map((r) => [r.reviewerName, r.rating, r.hasOwnerReply])).toEqual([
      ["guest_one", 5, false],
      ["traveller_two", 1, false],
      ["Guest Three", 2, true],
    ]);
    expect(all[1].text).toBe("Short changed...\nHad been going each time I visited, bought a coffee and p");
    expect(all[1].textIsShort).toBe(true);
    expect(all[2].textIsShort).toBeUndefined();
    expect(all[2].date).toBe(new Date(2024, 10, 30).getTime());
  });

  it("reads the page numbers and sort order", () => {
    document.body.innerHTML = page();
    expect(tripadvisorPageInfo(document)).toEqual({ first: 1, last: 30, total: 513 });
    expect(isTripadvisorSortedByNewest(document)).toBe(true);
  });

  it("does not trust another sort order or a filtered list", () => {
    document.body.innerHTML = page({ sort: "Highest rating" });
    expect(isTripadvisorSortedByNewest(document)).toBe(false);
    document.body.innerHTML = page({ shown: 40 }); // e.g. the "No response" filter
    expect(isTripadvisorSortedByNewest(document)).toBe(false);
    document.body.innerHTML = "<div>No reviews here</div>";
    expect(isTripadvisorSortedByNewest(document)).toBeUndefined();
  });
});
