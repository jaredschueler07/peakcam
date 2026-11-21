// Vendored from liftie@4.4.2 (github.com/pirxpilot/liftie, commit 05bbe05e39c6), BSD-3-Clause, Copyright (c) 2012 Damian Krzeminski. See ../../../License.md. Unmodified below this line. Do not edit: re-run scripts/liftie-worker/vendor.mjs.
import Debug from 'debug';

const debug = Debug('liftie:resort:bridger-bowl');

import coerce from '../../tools/coerce.js';
export default parse;

function parse({ data } = {}) {
  const ls = data?.lift_status ?? [];
  const liftStatus = {};
  ls.forEach(({ display_name, status }) => (liftStatus[display_name] = coerce(status)));
  debug('Lift Status', liftStatus);
  return liftStatus;
}
