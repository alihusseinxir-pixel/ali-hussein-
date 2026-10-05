import { describe, expect, it } from "vitest";
import { extractMentions, mentionSpans } from "./mentions";

const people = [{ id: "1", name: "Ali" }, { id: "2", name: "Ali Khan" }, { id: "3", name: "أحمد" }];
describe("mentions", () => {
  it("prefers the longest matching name", () => {
    expect(extractMentions("hi @Ali Khan please", people)).toEqual(["2"]);
  });
  it("matches case-insensitively, Arabic names, and several people", () => {
    expect(extractMentions("@ali and @أحمد، شكرا", people).sort()).toEqual(["1", "3"]);
  });
  it("ignores partial words and emails", () => {
    expect(extractMentions("@Alice is not Ali", people)).toEqual([]);
    expect(extractMentions("mail me at x@Ali.com", people)).toEqual([]);
  });
  it("returns spans for highlighting", () => {
    expect(mentionSpans("a @Ali b", people)).toEqual([{ start: 2, end: 6, id: "1" }]);
  });
});
