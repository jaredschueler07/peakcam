// A <title> whose children are text plus an expression renders as two text
// nodes on the server and one in the browser, which React reports as a
// hydration error (#418). That happened on /resorts/{slug}/history until
// 2026-11-23. Every <title> in a component must have a single child.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" || name.startsWith(".") ? [] : tsxFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

/** True when the JSX between <title> and </title> is more than one child. */
export function hasMixedTitleChildren(inner: string): boolean {
  const text = inner.trim();
  if (text === "" || !text.includes("{")) return false;
  // One expression and nothing else: `{...}` spanning the whole content.
  if (!text.startsWith("{") || !text.endsWith("}")) return true;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0 && i < text.length - 1) return true;
  }
  return false;
}

test("hasMixedTitleChildren tells one child from several", () => {
  assert.equal(hasMixedTitleChildren("Plain text"), false);
  assert.equal(hasMixedTitleChildren("{summary}"), false);
  assert.equal(hasMixedTitleChildren("{`Season snowfall curve, ${season.label}`}"), false);
  assert.equal(hasMixedTitleChildren("Season snowfall curve, {season.label}"), true);
  assert.equal(hasMixedTitleChildren("{a} {b}"), true);
});

test("no component renders a <title> with more than one child", () => {
  const offenders: string[] = [];
  for (const file of [...tsxFiles("components"), ...tsxFiles("app")]) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/g)) {
      if (hasMixedTitleChildren(match[1])) offenders.push(`${file}: ${match[0].slice(0, 100)}`);
    }
  }
  assert.deepEqual(offenders, []);
});
