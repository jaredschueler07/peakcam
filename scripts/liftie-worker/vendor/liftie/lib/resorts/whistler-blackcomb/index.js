// Vendored from liftie@4.4.2 (github.com/pirxpilot/liftie, commit 05bbe05e39c6), BSD-3-Clause, Copyright (c) 2012 Damian Krzeminski. See ../../../License.md. Unmodified below this line. Do not edit: re-run scripts/liftie-worker/vendor.mjs.
import toTitleCase from 'to-title-case';

export default {
  selector: 'lift',
  parse: {
    name: {
      attribute: 'name',
      fn: s =>
        toTitleCase(s)
          .replace(/(\d+)Th/, '$1th')
          .replace(/t.bar/i, 'T-Bar')
    },
    status: {
      attribute: 'status'
    }
  }
};
