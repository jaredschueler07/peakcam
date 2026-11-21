// Vendored from liftie@4.4.2 (github.com/pirxpilot/liftie, commit 05bbe05e39c6), BSD-3-Clause, Copyright (c) 2012 Damian Krzeminski. See ../../../License.md. Unmodified below this line. Do not edit: re-run scripts/liftie-worker/vendor.mjs.
export default {
  selector: 'table.mb-16 tr',
  parse: {
    name: '1/0',
    status: {
      child: '0/0',
      attribute: 'aria-label',
      regex: /(red|green)/i
    }
  }
};
