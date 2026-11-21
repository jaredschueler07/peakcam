// Vendored from liftie@4.4.2 (github.com/pirxpilot/liftie, commit 05bbe05e39c6), BSD-3-Clause, Copyright (c) 2012 Damian Krzeminski. See ../../License.md. Unmodified below this line. Do not edit: re-run scripts/liftie-worker/vendor.mjs.
import coerce from './coerce.js';

// common parser for Intrawest http://www.intrawest.com/about-us/who-we-are.aspx

export default function parse(lifts) {
  return lifts.reduce((ls, { Name: name, StatusEnglish: status }) => {
    ls[name] = coerce(status);
    return ls;
  }, {});
}
