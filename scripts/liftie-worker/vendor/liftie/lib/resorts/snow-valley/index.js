// Vendored from liftie@4.4.2 (github.com/pirxpilot/liftie, commit 05bbe05e39c6), BSD-3-Clause, Copyright (c) 2012 Damian Krzeminski. See ../../../License.md. Unmodified below this line. Do not edit: re-run scripts/liftie-worker/vendor.mjs.
import * as domutil from '../../tools/domutil.js';

export default {
  selector: '.liftStatus tr',
  parse: {
    name(node) {
      const child = domutil.child(node, 0);
      return domutil.allText(child).split('-')[0];
    },
    status: 1
  }
};
