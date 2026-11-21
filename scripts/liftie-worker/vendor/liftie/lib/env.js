// Vendored from liftie@4.4.2 (github.com/pirxpilot/liftie, commit 05bbe05e39c6), BSD-3-Clause, Copyright (c) 2012 Damian Krzeminski. See ../License.md. Unmodified below this line. Do not edit: re-run scripts/liftie-worker/vendor.mjs.
import { tmpdir } from 'node:os';

const {
  CSP_REPORT_URI,
  LIFTIE_CSP_ENFORCE,
  LIFTIE_STATIC_HOST = '',
  LIFTIE_USER_AGENT,
  LOG_DIR = tmpdir(),
  NODE_ENV = 'development',
  OPENWEATHER_API_KEY,
  PORT = 3000,
  WEBCAMS_API_KEY
} = process.env;

process.env.SITE_URL ??= `http://localhost:${PORT}`;

const { SITE_URL } = process.env;

export {
  CSP_REPORT_URI,
  LIFTIE_CSP_ENFORCE,
  LIFTIE_STATIC_HOST,
  LIFTIE_USER_AGENT,
  LOG_DIR,
  NODE_ENV,
  OPENWEATHER_API_KEY,
  PORT,
  SITE_URL,
  WEBCAMS_API_KEY
};
