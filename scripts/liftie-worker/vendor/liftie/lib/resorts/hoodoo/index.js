// Vendored from liftie@4.4.2 (github.com/pirxpilot/liftie, commit 05bbe05e39c6), BSD-3-Clause, Copyright (c) 2012 Damian Krzeminski. See ../../../License.md. Unmodified below this line. Do not edit: re-run scripts/liftie-worker/vendor.mjs.
export default {
  selector: '#tablepress-10 tr',
  parse: {
    name: 0,
    status: {
      child: 1,
      fn: s => (s === 'CLOSED' ? 'closed' : 'open')
    }
  }
};
