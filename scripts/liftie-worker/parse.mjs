// ─────────────────────────────────────────────────────────────
// Loads the vendored Liftie parse helpers and runs one resort's parser over
// a response body. No network here: the body is handed in. (The one
// exception is upstream's own: Liftie's Vail parser follows a waiting-room
// redirect itself; the worker classifies that page as `blocked` before the
// parser ever sees it.)
// ─────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const VENDOR = path.join(HERE, "vendor", "liftie");

/** The vendored parser modules, or null when their libraries are not installed. */
export async function loadLiftie() {
  try {
    const { default: getParseFn } = await import("./vendor/liftie/lib/lifts/parse.js");
    const { parseHtml } = await import("./vendor/liftie/lib/lifts/parser.js");
    const { version } = JSON.parse(fs.readFileSync(path.join(VENDOR, "VERSION.json"), "utf8"));
    return { root: VENDOR, version, getParseFn, parseHtml };
  } catch (err) {
    if (err && err.code === "ERR_MODULE_NOT_FOUND") return null;
    throw err;
  }
}


/**
 * Run the resort's parser over `text` (`kind` "html" or "json") and resolve
 * with whatever it returns: a `name → state` map, possibly empty. Rejects on
 * a body that is not JSON when JSON was expected (SyntaxError), a parser
 * error, or a parser that does not finish in `timeoutMs`.
 */
export async function parseOperatorBody(liftie, id, kind, text, timeoutMs = 15_000) {
  const parseFn = await liftie.getParseFn(id);
  const parsed = new Promise((resolve, reject) => {
    const done = (err, data) => (err ? reject(err instanceof Error ? err : new Error(String(err))) : resolve(data));
    if (kind === "html") {
      liftie.parseHtml(text, parseFn, done);
      return;
    }
    const body = JSON.parse(text);
    if (parseFn.isAsync) parseFn(body, done);
    else done(null, parseFn(body));
  });
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("parser timed out")), timeoutMs);
  });
  try {
    return await Promise.race([parsed, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
