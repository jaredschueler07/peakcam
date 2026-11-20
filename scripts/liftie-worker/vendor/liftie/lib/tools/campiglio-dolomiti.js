// Vendored from liftie@4.4.2 (github.com/pirxpilot/liftie, commit 05bbe05e39c6), BSD-3-Clause, Copyright (c) 2012 Damian Krzeminski. See ../../License.md. Unmodified below this line. Do not edit: re-run scripts/liftie-worker/vendor.mjs.
export default index => ({
  selector: `.piste-overview:nth-of-type(${index}) .col-6:first-child dt`,
  parse: {
    name: 2,
    status: {
      child: '0',
      attribute: 'title'
    }
  }
});
