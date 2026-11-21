// Vendored from liftie@4.4.2 (github.com/pirxpilot/liftie, commit 05bbe05e39c6), BSD-3-Clause, Copyright (c) 2012 Damian Krzeminski. See ../../../License.md. Unmodified below this line. Do not edit: re-run scripts/liftie-worker/vendor.mjs.
import { text } from '../../tools/domutil.js';

export default {
  selector: '.snowreport_sponsorarea:nth-child(2) table tbody tr',
  parse: {
    name: 0,
    status(node) {
      const src = text(node, { child: '1/0', attribute: 'src' });
      return src.includes('cross') ? 'closed' : 'open';
    }
  }
};
