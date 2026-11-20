// Vendored from liftie@4.4.2 (github.com/pirxpilot/liftie, commit 05bbe05e39c6), BSD-3-Clause, Copyright (c) 2012 Damian Krzeminski. See ../../../License.md. Unmodified below this line. Do not edit: re-run scripts/liftie-worker/vendor.mjs.
export default {
  // each lift renders as <details> with a lift-title row; the status icon div
  // carries title="open"/"closed" (occasionally a raw term id, coerced away)
  selector: 'div.lift-title',
  parse: {
    name: '1',
    status: {
      child: '0/0',
      attribute: 'title'
    }
  }
};
