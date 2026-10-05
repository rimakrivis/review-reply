import type { PageInfo, Review, Source } from "../types";
import { extractAllReviews, extractReview, findReviewContainer, isSortedByNewest } from "./extract";
import {
  extractAllFacebookReviews,
  extractFacebookReview,
  findFacebookContainer,
  isFacebookReviewsPage,
  isFacebookSortedByNewest,
} from "./facebook";
import {
  extractAllTripadvisorReviews,
  extractTripadvisorReview,
  findTripadvisorContainer,
  isTripadvisorOwnerPage,
  isTripadvisorSortedByNewest,
  tripadvisorPageInfo,
} from "./tripadvisor";

/** How ReviewReply reads one review site. The content script picks one per page with siteFor(). */
export interface SiteReader {
  source: Source;
  /** The review a reply box belongs to, or null when it is not a review's reply box. */
  findReviewContainer(editor: Element): Element | null;
  extractReview(container: Element): Review;
  /** Every review on the page, for the review history. Empty on pages that are not the owner's reviews. */
  extractAllReviews(root: ParentNode): Review[];
  /** Whether the list is sorted newest first and complete; undefined when the page shows no sort order. */
  isSortedByNewest(root: ParentNode): boolean | undefined;
  /** Sites with numbered pages: which results this page shows. */
  pageInfo?(root: ParentNode): PageInfo | undefined;
  /** Whether to show the ✨ button. Google's own check lives in the launcher. */
  hasOwnerReviews?(doc: Document): boolean;
}

export const google: SiteReader = {
  source: "google",
  findReviewContainer,
  extractReview: (c) => extractReview(c),
  extractAllReviews: (root) => extractAllReviews(root),
  isSortedByNewest,
};

export const tripadvisor: SiteReader = {
  source: "tripadvisor",
  findReviewContainer: findTripadvisorContainer,
  extractReview: (c) => extractTripadvisorReview(c),
  extractAllReviews: (root) => {
    const doc = "location" in root ? (root as Document) : (root as Element).ownerDocument;
    return isTripadvisorOwnerPage(doc.location) ? extractAllTripadvisorReviews(root) : [];
  },
  isSortedByNewest: isTripadvisorSortedByNewest,
  pageInfo: tripadvisorPageInfo,
  hasOwnerReviews: (doc) => isTripadvisorOwnerPage(doc.location) && extractAllTripadvisorReviews(doc).length > 0,
};

export const facebook: SiteReader = {
  source: "facebook",
  // Drafting works on any review Facebook shows, e.g. one opened from a notification.
  findReviewContainer: findFacebookContainer,
  extractReview: (c) => extractFacebookReview(c),
  // Collecting only on the page's Reviews tab, so other posts never end up in the history.
  extractAllReviews: (root) => {
    const doc = "location" in root ? (root as Document) : (root as Element).ownerDocument;
    return isFacebookReviewsPage(doc.location) ? extractAllFacebookReviews(root) : [];
  },
  isSortedByNewest: isFacebookSortedByNewest,
  hasOwnerReviews: (doc) => isFacebookReviewsPage(doc.location) && extractAllFacebookReviews(doc).length > 0,
};

/** The reader for the page's site. Google is the default, also for the demo page. */
export function siteFor(loc: Pick<Location, "hostname">): SiteReader {
  if (/(^|\.)tripadvisor\.[a-z.]+$/i.test(loc.hostname)) return tripadvisor;
  if (/(^|\.)facebook\.com$/i.test(loc.hostname)) return facebook;
  return google;
}
