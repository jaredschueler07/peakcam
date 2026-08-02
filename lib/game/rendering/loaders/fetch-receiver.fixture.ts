/**
 * A `fetch` stub that enforces the receiver rule real `fetch` enforces.
 *
 * Injected fetchers in tests are plain functions, and a plain function does not care what `this`
 * is — so an ordinary fake happily accepts `this.fetcher(url)`, the one call shape the browser
 * rejects with `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation`. That gap
 * let a loader ship whose every test passed and which could never complete a single request.
 *
 * This stub closes it by failing the same way the platform does. Use it in at least one test per
 * loader; a plain fake is fine for the rest.
 */
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ReceiverCheckingFetch {
  fetcher: FetchLike;
  /** The `this` each call was made with, in order. */
  receivers: unknown[];
  urls: string[];
}

/**
 * `respond` supplies the Response for a URL. The returned `fetcher` throws exactly as the WebIDL
 * binding does whenever it is called with a receiver that is neither `undefined` (an unbound call
 * in a strict-mode module) nor the global object.
 */
export function receiverCheckingFetch(
  respond: (url: string) => Response | Promise<Response>,
): ReceiverCheckingFetch {
  const receivers: unknown[] = [];
  const urls: string[] = [];
  // A `function`, not an arrow: an arrow has no `this` of its own and would defeat the check.
  const fetcher = function (this: unknown, input: RequestInfo | URL): Promise<Response> {
    receivers.push(this);
    urls.push(String(input));
    if (this !== undefined && this !== globalThis) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    }
    return Promise.resolve(respond(String(input)));
  };
  return { fetcher: fetcher as FetchLike, receivers, urls };
}

/** Asserts every recorded call used a receiver real `fetch` would have accepted. */
export function assertAcceptableReceivers(recorded: ReceiverCheckingFetch, label: string): void {
  if (recorded.receivers.length === 0) throw new Error(`${label}: the fetcher was never called`);
  for (const [i, receiver] of recorded.receivers.entries()) {
    if (receiver !== undefined && receiver !== globalThis) {
      throw new Error(
        `${label}: call ${i} used receiver ${String(receiver)} — real fetch would throw ` +
          "'Illegal invocation'. Call the fetcher as a free variable, not as this.fetcher(...).",
      );
    }
  }
}
