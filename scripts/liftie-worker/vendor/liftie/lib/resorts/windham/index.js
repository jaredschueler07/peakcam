// Vendored from liftie@4.4.2 (github.com/pirxpilot/liftie, commit 05bbe05e39c6), BSD-3-Clause, Copyright (c) 2012 Damian Krzeminski. See ../../../License.md. Unmodified below this line. Do not edit: re-run scripts/liftie-worker/vendor.mjs.
export default {
  selector: 'h3:contains(Lift Status) + div img.lf-type',
  parse: {
    name: '+',
    status: {
      child: '+/+/0',
      attribute: 'alt',
      fn: text => (/open/i.test(text) ? 'open' : 'closed')
    }
  }
};
