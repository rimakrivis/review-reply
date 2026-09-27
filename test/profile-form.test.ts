// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bindProfileFields, fillProfileFields, readProfileFields } from "../src/profile-form";
import { profileFromTemplate } from "../src/profiles";

beforeEach(() => {
  document.body.innerHTML = `
    <input id="name" data-field="businessName" />
    <textarea id="facts" data-field="facts"></textarea>`;
});

const $ = (id: string) => document.getElementById(id) as HTMLInputElement;

describe("profile form", () => {
  it("fills, reads and reports edits", () => {
    const p = profileFromTemplate("bar", "Bar Nova");
    p.facts = "Open from 18:00";
    fillProfileFields(document, p);
    expect($("name").value).toBe("Bar Nova");
    expect($("facts").value).toBe("Open from 18:00");

    const onInput = vi.fn();
    bindProfileFields(document, onInput);
    $("name").value = "Bar Nova Vilnius";
    $("name").dispatchEvent(new Event("input"));
    expect(onInput).toHaveBeenCalledWith("businessName", "Bar Nova Vilnius");

    readProfileFields(document, p);
    expect(p.businessName).toBe("Bar Nova Vilnius");
  });

  it("does not overwrite the field being typed in", () => {
    const p = profileFromTemplate("bar", "Saved name");
    $("name").value = "Typing…";
    $("name").focus();
    fillProfileFields(document, p);
    expect($("name").value).toBe("Typing…");
  });
});
