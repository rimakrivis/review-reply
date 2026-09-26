/** Renders mock reviews shaped like Google's owner review page (star aria-labels, reply textarea). */

interface MockReview {
  id: string;
  name: string;
  rating: number;
  when: string;
  text: string;
  ownerReply?: string;
}

const REVIEWS: MockReview[] = [
  {
    id: "r1",
    name: "Laura S.",
    rating: 2,
    when: "2 days ago",
    text: "Nice place but we waited almost 25 minutes to get two drinks on Saturday. Only one bartender for a full bar, and he kept serving people who came after us.",
  },
  {
    id: "r2",
    name: "Tom B.",
    rating: 5,
    when: "a week ago",
    text: "Mia behind the bar made me the best espresso martini I've ever had. Great playlist too, we stayed until closing!",
  },
  {
    id: "r3",
    name: "Jake W.",
    rating: 1,
    when: "3 weeks ago",
    text: "Bouncer wouldn't let us in because of trainers, while other people with trainers walked right in. Rude and ridiculous.",
  },
  {
    id: "r4",
    name: "Emma R.",
    rating: 4,
    when: "a month ago",
    text: "Cocktails are excellent and the staff are lovely. Music gets really loud after 10pm though, hard to have a conversation.",
  },
  { id: "r5", name: "Chris D.", rating: 3, when: "a month ago", text: "" },
  {
    id: "r6",
    name: "Ben T.",
    rating: 1,
    when: "2 months ago",
    text: "Worst haircut of my life, the stylist didn't listen at all.",
  },
  {
    id: "r7",
    name: "Priya N.",
    rating: 5,
    when: "3 months ago",
    text: "Came for the quiz night, brilliant host and great atmosphere.",
    ownerReply: "Thanks Priya! Glad you enjoyed quiz night. See you at the next one.\n— The Copper Fox team",
  },
];

const COLORS = ["#0ea5e9", "#8b5cf6", "#f97316", "#10b981", "#ef4444", "#6366f1", "#14b8a6"];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function ownerBlock(text: string): HTMLElement {
  const box = el("div", "owner");
  box.append(el("div", "owner-title", "Response from the owner"), el("p", "text", text));
  return box;
}

function renderReview(r: MockReview, i: number): HTMLElement {
  const card = el("article", "review");
  card.dataset.reviewId = r.id;

  const who = el("div", "who");
  const avatar = el("div", "avatar", r.name[0]);
  avatar.style.background = COLORS[i % COLORS.length];
  avatar.setAttribute("aria-hidden", "true");
  who.append(avatar, el("div", "name", r.name));

  const meta = el("div", "meta");
  const stars = el("span", "stars", "★".repeat(r.rating) + "☆".repeat(5 - r.rating));
  stars.setAttribute("role", "img");
  stars.setAttribute("aria-label", `Rated ${r.rating}.0 out of 5,`);
  meta.append(stars, el("span", "muted", r.when));

  card.append(who, meta);
  if (r.text) card.append(el("p", "text", r.text));

  if (r.ownerReply) {
    card.append(ownerBlock(r.ownerReply));
    return card;
  }

  const replyBtn = el("button", "link", "Reply");
  replyBtn.type = "button";
  replyBtn.addEventListener("click", () => {
    replyBtn.remove();
    const box = el("div", "reply-box");
    const ta = el("textarea");
    ta.setAttribute("aria-label", "Reply to review");
    ta.placeholder = "Write a public reply…";
    const post = el("button", "primary", "Post reply");
    const cancel = el("button", undefined, "Cancel");
    post.disabled = true;
    ta.addEventListener("input", () => (post.disabled = !ta.value.trim()));
    cancel.addEventListener("click", () => {
      box.remove();
      card.append(replyBtn);
    });
    post.addEventListener("click", () => {
      box.replaceWith(ownerBlock(ta.value.trim()));
    });
    const actions = el("div", "actions");
    actions.append(cancel, post);
    box.append(ta, actions);
    card.append(box);
    ta.focus();
  });
  card.append(replyBtn);
  return card;
}

document.getElementById("reviews")!.append(...REVIEWS.map(renderReview));
