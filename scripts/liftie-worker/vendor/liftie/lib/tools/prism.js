// Vendored from liftie@4.4.2 (github.com/pirxpilot/liftie, commit 05bbe05e39c6), BSD-3-Clause, Copyright (c) 2012 Damian Krzeminski. See ../../License.md. Unmodified below this line. Do not edit: re-run scripts/liftie-worker/vendor.mjs.
import Debug from 'debug';
import * as domutil from './domutil.js';

const debug = Debug('liftie:resort');

export default function parse(dom) {
  const liftStatus = domutil.collect(dom, '.lift_list_table tbody tr', tr => {
    const last = tr.children.at(-1);
    let status = domutil.findText(last);

    if (!status) {
      status = last.children[0].attribs.alt;
      if (status) {
        status = status.split(' ').pop();
      }
    }
    return {
      name: domutil.childText(tr, '0/0'),
      status
    };
  });

  debug('Lift Status:', liftStatus);
  return liftStatus;
}
