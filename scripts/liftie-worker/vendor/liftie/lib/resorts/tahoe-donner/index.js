// Vendored from liftie@4.4.2 (github.com/pirxpilot/liftie, commit 05bbe05e39c6), BSD-3-Clause, Copyright (c) 2012 Damian Krzeminski. See ../../../License.md. Unmodified below this line. Do not edit: re-run scripts/liftie-worker/vendor.mjs.
const states = {
  check: 'open',
  clock: 'scheduled',
  times: 'closed'
};

export default {
  selector: 'h2:contains(LIFT STATUS) + table tr:not(:first-child)',
  parse: {
    name: 0,
    status: {
      child: '2/0',
      attribute: 'class',
      regex: /fa-([a-z]+)-circle/,
      fn: s => states[s]
    }
  }
};
