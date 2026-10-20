import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GOOGLE_BUTTON_LABEL, GoogleMark, GoogleSignInButton } from "../components/auth/GoogleSignInButton";

// Google's sign-in branding: the "G" mark keeps its four official colours.
const GOOGLE_COLOURS = ["#EA4335", "#4285F4", "#FBBC05", "#34A853"];

test("the Google button renders the official mark, the label and an or-divider", () => {
  const html = renderToStaticMarkup(createElement(GoogleSignInButton, {}));
  assert.match(html, /type="button"/);
  assert.match(html, new RegExp(GOOGLE_BUTTON_LABEL));
  assert.equal(GOOGLE_BUTTON_LABEL, "Continue with Google");
  for (const colour of GOOGLE_COLOURS) assert.ok(html.includes(`fill="${colour}"`), `missing ${colour}`);
  assert.match(html, />or</);
  assert.doesNotMatch(html, /disabled=""/);
  assert.doesNotMatch(html, /type="submit"/, "must never submit the email form");
});

test("busy and disabled states lock the button", () => {
  const busy = renderToStaticMarkup(createElement(GoogleSignInButton, { busy: true }));
  assert.match(busy, /disabled=""/);
  assert.match(busy, /aria-busy="true"/);
  assert.match(busy, /Opening Google…/);
  const disabled = renderToStaticMarkup(createElement(GoogleSignInButton, { disabled: true }));
  assert.match(disabled, /disabled=""/);
  assert.match(disabled, new RegExp(GOOGLE_BUTTON_LABEL));
});

test("the mark is decorative and never recoloured by a size change", () => {
  const html = renderToStaticMarkup(createElement(GoogleMark, { size: 14 }));
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /width="14"/);
  for (const colour of GOOGLE_COLOURS) assert.ok(html.includes(colour));
});
