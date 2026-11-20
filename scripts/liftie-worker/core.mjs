// ─────────────────────────────────────────────────────────────
// Pure helpers for the Liftie worker: the request plan for a resort
// definition, robots.txt evaluation, response classification and the
// lift-map clean-up. No network and no Liftie import here, so these are
// testable without the worker's own node_modules.
// ─────────────────────────────────────────────────────────────

export const LIFT_STATES = ["open", "hold", "scheduled", "closed"];

/** Liftie resort ids are directory names; refuse anything that could leave the directory. */
export function isSafeResortId(id) {
  return typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
}

function fullUrl(part) {
  if (!part || typeof part.host !== "string" || typeof part.pathname !== "string") return null;
  let url;
  try {
    url = new URL(part.pathname, part.host);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (part.query && typeof part.query === "object") url.search = new URLSearchParams(part.query).toString();
  return url;
}

/**
 * The one request Liftie would make for this resort, by the same precedence as
 * its lib/lifts/index.js: `api` (JSON, or HTML when `api.html`) → `dataUrl`
 * (HTML) → `url` (HTML). Returns null when the definition names no usable URL.
 */
export function requestPlan(def) {
  if (!def || typeof def !== "object") return null;
  const page = fullUrl(def.url);
  if (def.api) {
    const url = fullUrl(def.api);
    if (!url) return null;
    const body = def.api.body == null ? null : JSON.stringify(def.api.body);
    return {
      kind: def.api.html ? "html" : "json",
      url: url.href,
      method: body ? "POST" : "GET",
      body,
      accept: "application/json",
      ignoreErrors: false,
      pageUrl: page ? page.href : url.href,
    };
  }
  const source = def.dataUrl ?? def.url;
  const url = fullUrl(source);
  if (!url) return null;
  return {
    kind: "html",
    url: url.href,
    method: "GET",
    body: null,
    accept: "*/*",
    ignoreErrors: Boolean(source.ignoreErrors),
    pageUrl: page ? page.href : url.href,
  };
}

// ── robots.txt (RFC 9309) ────────────────────────────────────

/** The product token robots.txt groups are matched against: "PeakCam/1.0 (…)" → "peakcam". */
export function productToken(userAgent) {
  const m = /^[^\s/(]+/.exec(String(userAgent ?? "").trim());
  return (m ? m[0] : "").toLowerCase();
}

function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === "allow" || field === "disallow") {
      lastWasAgent = false;
      if (current) current.rules.push({ allow: field === "allow", pattern: value });
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

function patternToRegExp(pattern) {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/**
 * May `userAgent` fetch `pathAndQuery` under this robots.txt? The group naming
 * our product token wins over `*`; within a group the longest matching pattern
 * decides and Allow wins a tie. No matching group or rule means allowed.
 */
export function robotsAllows(robotsText, userAgent, pathAndQuery) {
  const token = productToken(userAgent);
  const groups = parseRobots(robotsText);
  const named = groups.filter((g) => token && g.agents.some((a) => a !== "*" && token.includes(a)));
  const chosen = named.length ? named : groups.filter((g) => g.agents.includes("*"));
  let best = null;
  for (const group of chosen) {
    for (const rule of group.rules) {
      if (rule.pattern === "") continue; // "Disallow:" with no value allows everything
      if (!patternToRegExp(rule.pattern).test(pathAndQuery)) continue;
      const length = rule.pattern.length;
      if (!best || length > best.length || (length === best.length && rule.allow && !best.allow)) best = { length, allow: rule.allow };
    }
  }
  return best ? best.allow : true;
}

/**
 * What a robots.txt fetch outcome means (RFC 9309 §2.3.1): 2xx → evaluate the
 * body; 4xx → no restrictions; 5xx or unreachable → assume disallowed.
 */
export function robotsDecision(status, body, userAgent, pathAndQuery) {
  if (status == null) return { allowed: false, basis: "robots.txt unreachable" };
  if (status >= 200 && status < 300) {
    const allowed = robotsAllows(body, userAgent, pathAndQuery);
    return { allowed, basis: allowed ? "robots.txt allows the path" : "robots.txt disallows the path" };
  }
  if (status >= 400 && status < 500) return { allowed: true, basis: `no robots.txt (HTTP ${status})` };
  return { allowed: false, basis: `robots.txt answered HTTP ${status}` };
}

// ── Response classification ──────────────────────────────────

// Unmistakable even in a 200: a challenge interstitial or Vail Resorts' waiting-room redirect.
const INTERSTITIAL = /just a moment|challenges\.cloudflare\.com|px-captcha|pardon our interruption|waitingroom\.snow\.com|document\.location\.href = '\/\?c=vailresorts/i;
// Only meaningful beside an error status: the words can appear on a page that loaded.
const DENIAL = /access denied|_incapsula_resource|incapsula incident|perimeterx/i;

/**
 * Names a refused request. `blocked` = the site turned an automated client
 * away (401/403/429, a bot challenge, a waiting room); `http` = any other
 * non-2xx. Returns null for a response worth parsing.
 */
export function classifyResponse(status, headers, bodyStart, ignoreErrors = false) {
  const get = (name) => (headers && typeof headers.get === "function" ? headers.get(name) : null) ?? "";
  const body = bodyStart ?? "";
  const ok = status >= 200 && status < 300;
  const interstitial = get("cf-mitigated").toLowerCase() === "challenge" || INTERSTITIAL.test(body);
  if (status === 401 || status === 403 || status === 429) {
    return { reason: "blocked", detail: interstitial || DENIAL.test(body) ? `HTTP ${status} with a bot challenge page` : `HTTP ${status}` };
  }
  if (interstitial || (!ok && DENIAL.test(body))) return { reason: "blocked", detail: `HTTP ${status} with a bot challenge or waiting-room page` };
  if (!ok && !ignoreErrors) return { reason: "http", detail: `HTTP ${status}` };
  return null;
}

/** Keep only `name → one of the four Liftie states`; trims names, drops empties. */
export function cleanLifts(raw) {
  const lifts = {};
  if (!raw || typeof raw !== "object") return lifts;
  for (const [name, state] of Object.entries(raw)) {
    const key = String(name).trim();
    if (key && LIFT_STATES.includes(state)) lifts[key] = state;
  }
  return lifts;
}

/** Liftie's resort.json carries the last known opening day; only a date still ahead is news. */
export function futureOpening(opening, now) {
  if (typeof opening !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(opening)) return null;
  return opening > now.toISOString().slice(0, 10) ? opening : null;
}
