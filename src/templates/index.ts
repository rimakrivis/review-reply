import type { Profile, Situation } from "../types";

/** A starter profile for one kind of business. Real details get filled in on the settings page. */
export interface Template {
  key: string;
  label: string;
  profile: Omit<Profile, "id">;
}

const DEFAULT_RULES = [
  "Write in English, in 1-4 short sentences.",
  "Thank the reviewer by first name when a name is given. Never use their surname.",
  "Never admit legal liability or fault for injuries, theft, or illness. Say you take it seriously and invite them to get in touch privately.",
  "Never repeat personal details, bill amounts, or staff surnames from the review.",
  "Never offer refunds, discounts, or free items unless a situation below explicitly allows it.",
  "Never argue with the reviewer or call them a liar, even if the review seems unfair.",
  "Do not copy the review back to the reviewer. Do not use hashtags or emojis.",
  "Vary the wording. Do not start every reply with the same phrase.",
].join("\n");

function s(
  id: string,
  name: string,
  recognize: string,
  respond: string,
  avoid = "",
  example = "",
): Situation {
  return { id, name, recognize, respond, avoid, example };
}

/** Situations that apply to almost every business. */
const COMMON: Situation[] = [
  s(
    "positive-general",
    "General praise",
    "4-5 stars, positive words, no specific complaint.",
    "Thank them warmly, mention one specific thing they liked, invite them back.",
  ),
  s(
    "rating-only",
    "Rating without text",
    "The review has stars but no text, or only one or two words.",
    "Keep it to one or two sentences. Thank them for the rating. For low ratings, invite them to share what went wrong by email.",
    "Do not guess what their experience was.",
  ),
  s(
    "suspected-fake",
    "Suspected fake or wrong business",
    "The review describes things the business does not offer, mentions a different place, or looks like spam.",
    "Stay polite and brief. Say you could not find a record of this visit and invite them to contact you so you can look into it.",
    "Do not accuse the reviewer of lying. Do not mention reporting the review.",
  ),
  s(
    "negative-general",
    "General complaint",
    "1-3 stars with a complaint that fits no other situation.",
    "Apologise that the visit fell short, acknowledge the specific issue in neutral words, say it will be shared with the team, and give the complaint contact.",
    "No excuses, no blaming the customer.",
  ),
];

const BAR: Situation[] = [
  s(
    "long-wait",
    "Slow service / long wait at the bar",
    "Mentions waiting long for drinks, understaffed bar, being ignored by bartenders, queues.",
    "Apologise for the wait, mention busy nights are when the team works hardest to keep up, and say staffing on peak nights is being reviewed.",
    "Do not blame the crowd or the customer.",
  ),
  s(
    "door-refused",
    "Refused entry / door policy / dress code",
    "Mentions bouncer, door staff, security, not being let in, dress code, ID check, capacity.",
    "Explain calmly that the door team applies the same policy to everyone (age, ID, dress code, capacity, safety) and invite them to email for details about their visit.",
    "Do not discuss the specific reason they were refused. Do not comment on their appearance or behaviour.",
  ),
  s(
    "price-bill",
    "Prices or bill complaint",
    "Mentions expensive drinks, overcharged, wrong bill, card issue, service charge.",
    "Thank them for the feedback. If they say the bill was wrong, ask them to email with the date and time so it can be checked. If about prices, mention quality ingredients and happy hour if listed in the facts.",
    "Do not quote prices or amounts. Do not promise a refund.",
  ),
  s(
    "loud-music",
    "Music too loud / atmosphere",
    "Mentions music volume, DJ, hard to talk, crowded, too dark or too hot.",
    "Acknowledge it, explain the atmosphere changes during the evening (quieter earlier), and suggest an earlier visit if they prefer to talk.",
  ),
  s(
    "rude-staff",
    "Rude or unfriendly staff",
    "Mentions a rude, dismissive, or aggressive bartender, waiter, or security staff.",
    "Apologise sincerely, say it is not the standard expected of the team, and that it will be followed up internally. Give the complaint contact.",
    "Do not name or defend the staff member. Do not say they were busy.",
  ),
  s(
    "lost-item",
    "Lost item",
    "Mentions losing a phone, wallet, jacket, keys, or card.",
    "Say lost items are kept for a period and ask them to contact the bar with a description.",
    "Do not say whether the item was found.",
  ),
  s(
    "cleanliness",
    "Cleanliness / toilets",
    "Mentions dirty toilets, sticky tables, broken glass, smell.",
    "Thank them for pointing it out, apologise, and say checks during busy hours are being increased.",
  ),
  s(
    "staff-praise",
    "Praise for a named bartender or staff member",
    "Mentions a staff member by first name in a positive way.",
    "Thank them and say you will pass the kind words to that person by first name. Invite them back.",
  ),
  s(
    "drinks-praise",
    "Praise for cocktails or drinks",
    "Positive about cocktails, beer, wine, specific drinks.",
    "Thank them, mention the drink they liked if named, and invite them to try something new next time.",
  ),
  s(
    "event-night",
    "Event night feedback",
    "Mentions a DJ night, live music, quiz, party, match screening, or special event.",
    "Thank them for coming to the event. For positive reviews, invite them to the next one. For negative ones, say the feedback will shape future events.",
  ),
];

const RESTAURANT: Situation[] = [
  s(
    "food-quality",
    "Food quality complaint",
    "Mentions cold, bland, overcooked, undercooked, or poor-quality food.",
    "Apologise, say the feedback goes straight to the kitchen team, and invite them to contact you.",
    "Do not argue about the recipe or the reviewer's taste.",
  ),
  s(
    "allergy-illness",
    "Allergy or illness after eating",
    "Mentions allergic reaction, food poisoning, feeling sick.",
    "Say you are sorry to hear they felt unwell and that you take this very seriously. Ask them to contact you directly so it can be investigated.",
    "Never admit the food caused the illness. Never discuss medical details.",
  ),
  s(
    "slow-service",
    "Slow service",
    "Mentions long wait for a table, food, or the bill.",
    "Apologise for the wait and say timing on busy services is being reviewed.",
  ),
  s(
    "booking-issue",
    "Booking problem",
    "Mentions a lost reservation, being turned away, or wrong table.",
    "Apologise for the confusion and ask them to email with the booking details so it can be checked.",
  ),
  s(
    "dish-praise",
    "Praise for a dish",
    "Positive about a specific dish or the menu.",
    "Thank them, mention the dish by name if given, and invite them back.",
  ),
];

const CAFE: Situation[] = [
  s(
    "coffee-quality",
    "Coffee quality",
    "Mentions coffee taste, temperature, strength, or a wrong order.",
    "Thank them for the honest feedback and say the baristas will look at it. Invite them to mention it to staff next time so it can be fixed on the spot.",
  ),
  s(
    "wifi-seating",
    "Wi-Fi, seating, or laptop policy",
    "Mentions Wi-Fi, power sockets, seating, or being asked to leave a table.",
    "Explain the policy politely if it is in the facts, otherwise thank them and say the feedback is noted.",
  ),
  s(
    "pastry-praise",
    "Praise for food or pastries",
    "Positive about cakes, pastries, breakfast, or lunch.",
    "Thank them, mention the item if named, and invite them back.",
  ),
];

const HOTEL: Situation[] = [
  s(
    "room-cleanliness",
    "Room cleanliness",
    "Mentions dirty room, bathroom, bedding, or smell.",
    "Apologise, say housekeeping standards are being reviewed, and invite them to get in touch.",
  ),
  s(
    "noise",
    "Noise",
    "Mentions noise from street, neighbours, or the building.",
    "Apologise and suggest they request a quieter room when booking next time.",
  ),
  s(
    "checkin",
    "Check-in or reception",
    "Mentions check-in wait, reception staff, or room not ready.",
    "Apologise for the delay and say the feedback will be shared with the front desk team.",
  ),
  s(
    "stay-praise",
    "Great stay",
    "Positive about the stay, room, breakfast, location, or staff.",
    "Thank them, mention what they enjoyed, and say you hope to welcome them back.",
  ),
];

const SALON: Situation[] = [
  s(
    "result-unhappy",
    "Unhappy with the result",
    "Unhappy with haircut, colour, nails, or treatment result.",
    "Apologise that they are not happy and invite them to contact the salon so it can be put right.",
    "Do not blame the client's hair or skin. Do not promise a free redo in public.",
  ),
  s(
    "late-appointment",
    "Appointment ran late",
    "Mentions waiting past the appointment time or being rushed.",
    "Apologise for the wait and say scheduling is being reviewed.",
  ),
  s(
    "stylist-praise",
    "Praise for a stylist",
    "Mentions a staff member by first name positively.",
    "Thank them and say you will pass the kind words on to that person.",
  ),
];

function template(key: string, label: string, businessType: string, specific: Situation[]): Template {
  return {
    key,
    label,
    profile: {
      businessName: "",
      businessType,
      signature: "",
      tone: "Friendly, warm and professional. Short sentences. Sounds like a real person, not a corporation.",
      facts: "",
      rules: DEFAULT_RULES,
      situations: [...specific, ...COMMON].map((x) => ({ ...x })),
    },
  };
}

export const TEMPLATES: Template[] = [
  template("bar", "Bar / Nightclub", "Bar", BAR),
  template("restaurant", "Restaurant", "Restaurant", RESTAURANT),
  template("cafe", "Café", "Café", CAFE),
  template("hotel", "Hotel", "Hotel", HOTEL),
  template("salon", "Beauty salon", "Beauty salon", SALON),
  template("generic", "Other business", "Business", []),
];
