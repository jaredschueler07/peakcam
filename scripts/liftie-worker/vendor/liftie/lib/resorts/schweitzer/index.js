// Vendored from liftie@4.4.2 (github.com/pirxpilot/liftie, commit 05bbe05e39c6), BSD-3-Clause, Copyright (c) 2012 Damian Krzeminski. See ../../../License.md. Unmodified below this line. Do not edit: re-run scripts/liftie-worker/vendor.mjs.
export default {
  selector: '#liftsOpenStatus .liftIcon',
  parse: {
    name: node => node.next.children[0].data,
    status(node) {
      const status = node.attribs.class;
      const match = status.match(/\bstatus(\S+)\b/);
      return match ? match[1] : 'Closed';
    }
  }
};
