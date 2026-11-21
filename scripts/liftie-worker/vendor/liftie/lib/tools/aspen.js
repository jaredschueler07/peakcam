// Vendored from liftie@4.4.2 (github.com/pirxpilot/liftie, commit 05bbe05e39c6), BSD-3-Clause, Copyright (c) 2012 Damian Krzeminski. See ../../License.md. Unmodified below this line. Do not edit: re-run scripts/liftie-worker/vendor.mjs.
import Debug from 'debug';
import coerce from './coerce.js';

const debug = Debug('liftie:resort:aspen');

export default function parse(data) {
  const liftStatus = {};

  data.liftStatuses.forEach(lift => {
    liftStatus[lift.liftName] = coerce(lift.status);
  });

  debug('Aspen Lift Status:', liftStatus);
  return liftStatus;
}
