// Vendored from liftie@4.4.2 (github.com/pirxpilot/liftie, commit 05bbe05e39c6), BSD-3-Clause, Copyright (c) 2012 Damian Krzeminski. See ../../../License.md. Unmodified below this line. Do not edit: re-run scripts/liftie-worker/vendor.mjs.
import { findText } from '../../tools/domutil.js';

export default {
  selector: '.tablepress-table-name',
  parse(node) {
    const [name, status] = findText(node).split('-');
    return {
      name: name,
      status: status
    };
  }
};
