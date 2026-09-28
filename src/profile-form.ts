import type { Profile } from "./types";

/**
 * Binds `<input data-field="businessName">`-style inputs to a Profile.
 * Shared by the Settings page and the side panel.
 */

/** Profile fields edited as plain text (everything except the id and the two lists). */
export type ProfileTextField = Exclude<keyof Profile, "id" | "situations" | "urgentTopics">;

function fields(root: ParentNode): (HTMLInputElement | HTMLTextAreaElement)[] {
  return Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-field]"));
}

/** Shows the profile in every field under root. Skips the field being typed in, so the cursor never jumps. */
export function fillProfileFields(root: ParentNode, p: Profile): void {
  for (const el of fields(root)) {
    if (el === el.ownerDocument.activeElement) continue;
    el.value = p[el.dataset.field as ProfileTextField] ?? "";
  }
}

/** Copies every field under root into the profile. */
export function readProfileFields(root: ParentNode, p: Profile): void {
  for (const el of fields(root)) p[el.dataset.field as ProfileTextField] = el.value;
}

/** Calls onInput whenever the owner types in a field under root. */
export function bindProfileFields(
  root: ParentNode,
  onInput: (field: ProfileTextField, value: string) => void,
): void {
  for (const el of fields(root)) {
    el.addEventListener("input", () => onInput(el.dataset.field as ProfileTextField, el.value));
  }
}
