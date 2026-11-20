// Vendored from liftie@4.4.2 (github.com/pirxpilot/liftie, commit 05bbe05e39c6), BSD-3-Clause, Copyright (c) 2012 Damian Krzeminski. See ../../License.md. Unmodified below this line. Do not edit: re-run scripts/liftie-worker/vendor.mjs.
const ICON_MAP = {
  check_circle: 'open',
  remove_circle: 'close'
};

export default {
  selector: 'h2 + table tbody tr',
  parse: {
    name: 3,
    status: {
      child: '0/0',
      fn: s => ICON_MAP[s]
    }
  }
};
