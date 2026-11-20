// Vendored from liftie@4.4.2 (github.com/pirxpilot/liftie, commit 05bbe05e39c6), BSD-3-Clause, Copyright (c) 2012 Damian Krzeminski. See ../../../License.md. Unmodified below this line. Do not edit: re-run scripts/liftie-worker/vendor.mjs.
import Debug from 'debug';

const debug = Debug('liftie:resort:bogusbasin');

import select from '../../select.js';
import coerce from '../../tools/coerce.js';
export default parse;

function parse(dom) {
  const dataScript = select(dom, 'x-filterable-lift-trail-status').map(script => script.attribs['data-data'].trim());
  const data = JSON.parse(dataScript);

  const liftStatus = data.lifts.reduce((ls, lift) => {
    ls[lift['title']] = coerce(lift['openingStatus']);
    return ls;
  }, {});

  debug('Bogus Basin Lift Status:', liftStatus);
  return liftStatus;
}
