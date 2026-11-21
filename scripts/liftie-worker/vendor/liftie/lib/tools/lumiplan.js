// Vendored from liftie@4.4.2 (github.com/pirxpilot/liftie, commit 05bbe05e39c6), BSD-3-Clause, Copyright (c) 2012 Damian Krzeminski. See ../../License.md. Unmodified below this line. Do not edit: re-run scripts/liftie-worker/vendor.mjs.
import toTitleCase from 'to-title-case';

export default {
  selector: '.POI_title:contains(Lifts) + .liaisons .POI_info',
  parse: {
    name: {
      child: '1/0/0',
      fn: toTitleCase
    },
    status: {
      child: '2/1',
      attribute: 'src',
      regex: /lp_runway_trail_(\w+)\.svg$/
    }
  }
};
