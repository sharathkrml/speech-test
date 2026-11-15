import { expect, test } from "bun:test";
import { matchWords, wordScore } from "./score";

test("exact words pass", () => {
  expect(wordScore("She sells sea shells.", "She sells sea shells.")).toBe(1);
});

test("one misheard word still passes", () => {
  expect(wordScore("by the sea shore", "by the sea short")).toBe(1);
});

test("half the twister fails", () => {
  expect(wordScore("She sells sea shells by the sea shore", "she sells sea shells")).toBeCloseTo(0.5);
});

test("silence scores zero", () => {
  expect(wordScore("Peter Piper", "")).toBe(0);
});

test("matched words line up with the twister", () => {
  expect(matchWords("red lorry yellow lorry", "red lorry").matched).toEqual([true, true, false, false]);
});

test("one missed word does not consume the rest", () => {
  const { score } = matchWords(
    "How much wood would a woodchuck could chuck wood",
    "How much would would a woodchuck could chuck wood",
  );
  expect(score).toBeGreaterThan(0.85);
});
