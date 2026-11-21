// Vendored from liftie@4.4.2 (github.com/pirxpilot/liftie, commit 05bbe05e39c6), BSD-3-Clause, Copyright (c) 2012 Damian Krzeminski. See ../License.md. Unmodified below this line. Do not edit: re-run scripts/liftie-worker/vendor.mjs.
import { selectAll } from 'css-select';

// select we were using before had reverse order of the parameters
export default function select(dom, selector) {
  return selectAll(selector, dom);
}
