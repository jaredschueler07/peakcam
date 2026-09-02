import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  REPO_ROOT,
  loadEnv,
  loadEnvFile,
  readSupabaseEnv,
} from "./env.mjs";

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "peakcam-env-"));
}

function withCleanEnv(keys, fn) {
  const saved = new Map();
  for (const k of keys) {
    saved.set(k, process.env[k]);
    delete process.env[k];
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("loadEnvFile parses key=value and skips comments and blanks", () => {
  const dir = tmpdir();
  const file = path.join(dir, ".env.test");
  fs.writeFileSync(
    file,
    ["# a comment", "", "PC_TEST_A=1", "  PC_TEST_B = two  ", "no-equals-sign"].join("\n"),
  );

  withCleanEnv(["PC_TEST_A", "PC_TEST_B"], () => {
    loadEnvFile(file);
    assert.equal(process.env.PC_TEST_A, "1");
    assert.equal(process.env.PC_TEST_B, "two");
  });
});

test("loadEnvFile strips surrounding quotes", () => {
  const dir = tmpdir();
  const file = path.join(dir, ".env.test");
  fs.writeFileSync(file, ['PC_TEST_Q="quoted"', "PC_TEST_S='single'"].join("\n"));

  withCleanEnv(["PC_TEST_Q", "PC_TEST_S"], () => {
    loadEnvFile(file);
    assert.equal(process.env.PC_TEST_Q, "quoted");
    assert.equal(process.env.PC_TEST_S, "single");
  });
});

test("loadEnvFile never overwrites an existing variable", () => {
  const dir = tmpdir();
  const file = path.join(dir, ".env.test");
  fs.writeFileSync(file, "PC_TEST_EXISTING=from-file");

  withCleanEnv(["PC_TEST_EXISTING"], () => {
    process.env.PC_TEST_EXISTING = "from-process";
    loadEnvFile(file);
    assert.equal(process.env.PC_TEST_EXISTING, "from-process");
  });
});

test("loadEnvFile ignores a missing file", () => {
  assert.doesNotThrow(() => loadEnvFile(path.join(tmpdir(), "nope.env")));
});

test("loadEnv reads .env.local before .env, and .env.local wins", () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, ".env.local"), "PC_TEST_PREC=local");
  fs.writeFileSync(path.join(dir, ".env"), "PC_TEST_PREC=plain\nPC_TEST_ONLY=only");

  withCleanEnv(["PC_TEST_PREC", "PC_TEST_ONLY"], () => {
    loadEnv(dir);
    assert.equal(process.env.PC_TEST_PREC, "local");
    assert.equal(process.env.PC_TEST_ONLY, "only");
  });
});

test("REPO_ROOT points at the repo containing package.json", () => {
  assert.ok(fs.existsSync(path.join(REPO_ROOT, "package.json")));
});

test("readSupabaseEnv returns null when either variable is missing", () => {
  withCleanEnv(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"], () => {
    assert.equal(readSupabaseEnv(), null);

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
    assert.equal(readSupabaseEnv(), null);

    process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
    assert.deepEqual(readSupabaseEnv(), {
      url: "https://x.supabase.co",
      key: "svc",
    });
  });
});
