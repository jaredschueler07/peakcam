// Vendored from liftie@4.4.2 (github.com/pirxpilot/liftie, commit 05bbe05e39c6), BSD-3-Clause, Copyright (c) 2012 Damian Krzeminski. See ../../License.md. Unmodified below this line. Do not edit: re-run scripts/liftie-worker/vendor.mjs.
import { LIFTIE_USER_AGENT } from '../env.js';

export default function request({ host, pathname, query }) {
  const fullUrl = new URL(pathname, host);
  if (query) {
    fullUrl.search = new URLSearchParams(query).toString();
  }
  return fetch(fullUrl, {
    headers: {
      'User-Agent': LIFTIE_USER_AGENT,
      Accept: '*/*'
    }
  });
}
