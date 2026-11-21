// Vendored from liftie@4.4.2 (github.com/pirxpilot/liftie, commit 05bbe05e39c6), BSD-3-Clause, Copyright (c) 2012 Damian Krzeminski. See ../../../License.md. Unmodified below this line. Do not edit: re-run scripts/liftie-worker/vendor.mjs.
import Debug from 'debug';
import coerce from '../../tools/coerce.js';

const debug = Debug('liftie:resort:jackson-hole');

export default parse;

function parse(data) {
  const liftStatus = {};

  Object.values(data.lifts).forEach(({ name, openingStatus }) => {
    liftStatus[name] = coerce(openingStatus);
  });

  debug('Lift Status:', liftStatus);
  return liftStatus;
}
