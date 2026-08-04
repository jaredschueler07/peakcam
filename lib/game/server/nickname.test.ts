import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_NICKNAME_LENGTH } from "./run-schema";
import { sanitizeNickname } from "./nickname";

test("an ordinary nickname passes through unchanged", () => {
  assert.equal(sanitizeNickname("Powder Hound"), "Powder Hound");
  assert.equal(sanitizeNickname("jared_99"), "jared_99");
});

test("surrounding and internal whitespace is normalised", () => {
  assert.equal(sanitizeNickname("   Sendy   "), "Sendy");
  assert.equal(sanitizeNickname("Roca\t\tJack"), "Roca Jack");
  assert.equal(sanitizeNickname("Line\nBreak"), "Line Break");
  assert.equal(sanitizeNickname("a\u2003\u2003b"), "a b", "em spaces collapse too");
});

test("nothing usable becomes null rather than an error", () => {
  assert.equal(sanitizeNickname(""), null);
  assert.equal(sanitizeNickname("     "), null);
  assert.equal(sanitizeNickname("\u200b\u200b"), null, "zero-width only is empty");
  assert.equal(sanitizeNickname(undefined), null);
  assert.equal(sanitizeNickname(null), null);
  assert.equal(sanitizeNickname(42), null);
});

test("control characters are stripped", () => {
  assert.equal(sanitizeNickname("Send\u0000it"), "Sendit");
  assert.equal(sanitizeNickname("drop\u001bit"), "dropit");
  assert.equal(sanitizeNickname("del\u007fete"), "delete");
});

test("invisible and bidi-override characters are stripped", () => {
  // Two names that would render identically if the zero-width space survived.
  assert.equal(sanitizeNickname("ad\u200bmin"), "admin");
  assert.equal(sanitizeNickname("\u202eabc"), "abc", "RTL override cannot flip the row");
  assert.equal(sanitizeNickname("a\ufeffb"), "ab");
  assert.equal(sanitizeNickname("soft\u00adhyphen"), "softhyphen");
});

test("names longer than the column are capped without a trailing space", () => {
  const long = sanitizeNickname("x".repeat(100));
  assert.equal(long?.length, MAX_NICKNAME_LENGTH);

  // The cap lands mid-gap here; the result must not end in a space.
  const capped = sanitizeNickname(`${"a".repeat(MAX_NICKNAME_LENGTH - 1)} tail`);
  assert.equal(capped, "a".repeat(MAX_NICKNAME_LENGTH - 1));
  assert.doesNotMatch(capped!, /\s$/);
});

test("non-Latin names are preserved — they are names, not attacks", () => {
  assert.equal(sanitizeNickname("Ñandú"), "Ñandú");
  assert.equal(sanitizeNickname("ゆき"), "ゆき");
  assert.equal(sanitizeNickname("Кирилл"), "Кирилл");
});

test("equivalent Unicode spellings normalise to one stored form", () => {
  // "é" as a single code point and as e + combining acute must not become two
  // different leaderboard entries.
  const precomposed = "Chlo\u00e9";
  const combining = "Chloe\u0301";
  assert.notEqual(precomposed, combining, "the two spellings really are different bytes");
  assert.equal(sanitizeNickname(precomposed), sanitizeNickname(combining));
});

test("every sanitised name satisfies the migration's CHECK", () => {
  const inputs = [
    "Powder Hound",
    "   Sendy   ",
    "x".repeat(100),
    "ad\u200bmin",
    "Ñandú",
    `${"a".repeat(MAX_NICKNAME_LENGTH - 1)} tail`,
  ];
  for (const input of inputs) {
    const name = sanitizeNickname(input);
    assert.ok(name !== null, `${JSON.stringify(input)} should survive`);
    assert.ok(
      [...name].length >= 1 && name.length <= MAX_NICKNAME_LENGTH,
      `${JSON.stringify(name)} violates char_length between 1 and ${MAX_NICKNAME_LENGTH}`,
    );
  }
});
