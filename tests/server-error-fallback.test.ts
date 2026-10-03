import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ServerErrorPage from "../pages/500";

test("static 500 fallback renders a usable recovery page without leaking an error", () => {
  const html = renderToStaticMarkup(createElement(ServerErrorPage));
  assert.match(html, /PeakCam · 500/);
  assert.match(html, /We couldn’t load this page\./);
  assert.match(html, /catalog is temporarily unavailable/);
  assert.match(html, /href="\/"/);
});
