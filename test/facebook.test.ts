// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { statsFor, sumStats } from "../src/archive";
import {
  extractAllFacebookReviews,
  extractFacebookReview,
  findFacebookContainer,
  isFacebookReviewsPage,
  isFacebookSortedByNewest,
  parseFacebookDate,
} from "../src/content/facebook";
import { siteFor } from "../src/content/sites";
import { buildUserPrompt } from "../src/prompt";

const NOW = new Date(2026, 9, 5, 12).getTime();
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();

/** Shaped like a Facebook page's Reviews tab: articles, data-ad-rendering-role, a Lexical comment box. */
function review(name: string, verb: string, date: string, text: string, extra = "") {
  return `
    <div role="article"><div>
      <div data-ad-rendering-role="profile_name"><h3><span><b><a href="https://www.facebook.com/x" role="link">${name}</a></b>
        <b><img alt=""></b> ${verb} <b><a href="https://www.facebook.com/lostinamsterdamlounge" role="link">Lost In Amsterdam Lounge Cafe</a></b>.</span></h3></div>
      <div><a aria-label="${date}" href="https://www.facebook.com/x/posts/pfbid0${name.length}abc?__cft__" role="link">${date}</a>
        <span aria-hidden="true"> · </span></div>
      <div role="button" aria-label="Veiksmai"></div>
      <div data-ad-rendering-role="story_message"><div data-ad-preview="message"><div dir="auto">${text}</div></div></div>
      <div><a href="#" role="link">Žr. vertimą</a></div>
      ${extra}
      <div aria-label="Patinka" role="button"></div>
      <form role="presentation"><div aria-label="Komentuoti kaip Lost In Amsterdam Lounge Cafe" contenteditable="true" role="textbox"><p><br></p></div>
        <ul><li><span><div aria-label="Įterpti jaustuką" role="button"></div></span></li></ul></form>
    </div></div>`;
}

function page() {
  return `
    <div><span>94 % rekomendacijų (3 872 peržiūr.)</span></div>
    ${review("Anna Smith", "rekomenduoja", "Sausis 29 d.", "Rude staff, €25 for a cocktail.")}
    ${review("Ben Jones", "nerekomenduoja", "2025 m. Spalis 30 d.", "Long story short… <div role=\"button\">Žr. daugiau</div>",
      `<div><ul><li><span dir="auto">Cozy atmosphere</span><span aria-hidden="true"> · </span></li><li><span>Best coffee</span></li></ul></div>
       <div role="article" aria-label="Komentaras, kurį parašė Lost In Amsterdam Lounge Cafe prieš 2 d."><span>Thanks Ben!</span></div>`)}
  `;
}

describe("Facebook dates", () => {
  it("reads Lithuanian and English dates", () => {
    expect(parseFacebookDate("Sausis 29 d.", NOW)).toBe(day(2026, 1, 29));
    expect(parseFacebookDate("2025 m. Spalis 30 d.", NOW)).toBe(day(2025, 10, 30));
    expect(parseFacebookDate("spalio 30 d.", NOW)).toBe(day(2025, 10, 30)); // still ahead this year: last year's
    expect(parseFacebookDate("January 29", NOW)).toBe(day(2026, 1, 29));
    expect(parseFacebookDate("October 30, 2025 at 14:05", NOW)).toBe(day(2025, 10, 30));
    expect(parseFacebookDate("29 January 2026", NOW)).toBe(day(2026, 1, 29));
  });
  it("reads short relative dates", () => {
    expect(parseFacebookDate("3 d.", NOW)).toBe(NOW - 3 * 86_400_000);
    expect(parseFacebookDate("5h", NOW)).toBe(NOW - 5 * 3_600_000);
    expect(parseFacebookDate("2 sav.", NOW)).toBe(NOW - 14 * 86_400_000);
    expect(parseFacebookDate("Vakar", NOW)).toBe(NOW - 86_400_000);
  });
  it("ignores text that is not a date", () => {
    expect(parseFacebookDate("Lost In Amsterdam Lounge Cafe", NOW)).toBeNull();
    expect(parseFacebookDate("Žr. vertimą", NOW)).toBeNull();
  });
});

describe("Facebook reviews", () => {
  it("recognises the Reviews tab and picks the Facebook reader", () => {
    expect(isFacebookReviewsPage({ hostname: "www.facebook.com", pathname: "/lostinamsterdamlounge/reviews", search: "" })).toBe(true);
    expect(isFacebookReviewsPage({ hostname: "www.facebook.com", pathname: "/profile.php", search: "?id=1&sk=reviews" })).toBe(true);
    expect(isFacebookReviewsPage({ hostname: "www.facebook.com", pathname: "/lostinamsterdamlounge", search: "" })).toBe(false);
    expect(siteFor({ hostname: "www.facebook.com" }).source).toBe("facebook");
  });

  it("reads recommendations, dates, ids, tags, shortened texts and the page's own reply", () => {
    document.body.innerHTML = page();
    const [anna, ben] = extractAllFacebookReviews(document, NOW);
    expect(anna).toEqual({
      source: "facebook",
      reviewerName: "Anna Smith",
      rating: 0,
      recommends: true,
      text: "Rude staff, €25 for a cocktail.",
      date: day(2026, 1, 29),
      dateIsRough: false,
      googleId: "fb:pfbid010abc",
      hasOwnerReply: false,
    });
    expect(ben).toMatchObject({
      reviewerName: "Ben Jones",
      recommends: false,
      text: "Long story short",
      textIsShort: true,
      details: { Tags: "Cozy atmosphere, Best coffee" },
      hasOwnerReply: true,
    });
  });

  it("finds the review a comment box belongs to", () => {
    document.body.innerHTML = page();
    const boxes = document.querySelectorAll('[role="textbox"]');
    expect(extractFacebookReview(findFacebookContainer(boxes[1])!, NOW).reviewerName).toBe("Ben Jones");
    document.body.innerHTML = `<div role="article"><h3>Anna shared a post</h3><div contenteditable="true" role="textbox"></div></div>`;
    expect(findFacebookContainer(document.querySelector('[role="textbox"]')!)).toBeNull();
  });

  it("checks the order, since Facebook shows no sort button", () => {
    document.body.innerHTML = page();
    expect(isFacebookSortedByNewest(document)).toBe(true);
    document.body.innerHTML = review("Old", "rekomenduoja", "2024 m. Spalis 1 d.", "a") + review("New", "rekomenduoja", "Sausis 2 d.", "b");
    expect(isFacebookSortedByNewest(document)).toBe(false);
  });

  it("counts recommendations and tells the AI about them", () => {
    const s = statsFor([{ rating: 0, recommends: true }, { rating: 0, recommends: false }, { rating: 4 }]);
    expect(s).toMatchObject({ count: 3, average: 4, recommend: [1, 1] });
    expect(sumStats([s, s]).recommend).toEqual([2, 2]);
    expect(statsFor([{ rating: 5 }]).recommend).toBeUndefined();
    const prompt = buildUserPrompt({ review: { reviewerName: "Ben", rating: 0, recommends: false, text: "Meh" }, variant: "default" });
    expect(prompt).toContain("Rating: does not recommend the business");
  });
});
