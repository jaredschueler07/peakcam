// Vendored from liftie@4.4.2 (github.com/pirxpilot/liftie, commit 05bbe05e39c6), BSD-3-Clause, Copyright (c) 2012 Damian Krzeminski. See ../../License.md. Unmodified below this line. Do not edit: re-run scripts/liftie-worker/vendor.mjs.
import Debug from 'debug';
import * as domutil from '../tools/domutil.js';

const debug = Debug('liftie:lifts');

/**
 * catch exceptions thrown by parse
 */
export default async function getParseFn(resortId) {
  const { default: descriptor } = await import(`../resorts/${resortId}/index.js`);
  const parse = typeof descriptor === 'function' ? descriptor : collectParse;

  wrappedParse.isAsync = parse.length > 1;

  return wrappedParse;

  function wrappedParse(...args) {
    try {
      return parse(...args);
    } catch (e) {
      console.error(`Exception when parsing ${resortId}`, e);
      return {};
    }
  }

  function collectParse(dom) {
    const liftStatus = domutil.collect(dom, descriptor.selector, descriptor.parse);
    debug(`${resortId} Lift Status:`, liftStatus);
    return liftStatus;
  }
}
