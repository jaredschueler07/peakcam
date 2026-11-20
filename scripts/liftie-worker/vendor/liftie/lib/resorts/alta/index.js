// Vendored from liftie@4.4.2 (github.com/pirxpilot/liftie, commit 05bbe05e39c6), BSD-3-Clause, Copyright (c) 2012 Damian Krzeminski. See ../../../License.md. Unmodified below this line. Do not edit: re-run scripts/liftie-worker/vendor.mjs.
import vm from 'node:vm';
import Debug from 'debug';
import select from '../../select.js';
import { allText } from '../../tools/domutil.js';

const debug = Debug('liftie:resort:alta');

function extractLiftData(script) {
  const data = vm.runInNewContext(script, { window: Object.create(null) });
  return data?.liftStatus?.lifts ?? {};
}

export default function parse(dom) {
  const dataScript = select(dom, 'script')
    .map(script => allText(script).trim())
    .find(script => script.includes('window.Alta = '));

  const liftStatus = extractLiftData(dataScript).reduce((ls, { name, open }) => {
    ls[name] = open ? 'open' : 'closed';
    return ls;
  }, {});

  debug('Alta Lift Status:', liftStatus);
  return liftStatus;
}
