import { test } from "node:test";
import assert from "node:assert";
import { readServiceEnv, requireServiceEnv } from "./service-env";

const FULL = {
  NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};

test("requireServiceEnv returns both values when configured", () => {
  assert.deepStrictEqual(requireServiceEnv(FULL), {
    url: "https://proj.supabase.co",
    serviceKey: "service-key",
  });
});

test("requireServiceEnv names the missing variable instead of asserting non-null", () => {
  assert.throws(
    () => requireServiceEnv({ SUPABASE_SERVICE_ROLE_KEY: "k" }),
    /missing NEXT_PUBLIC_SUPABASE_URL/
  );
  assert.throws(
    () => requireServiceEnv({ NEXT_PUBLIC_SUPABASE_URL: "u" }),
    /missing SUPABASE_SERVICE_ROLE_KEY/
  );
  assert.throws(
    () => requireServiceEnv({}),
    /missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY/
  );
});

test("an empty string counts as missing, not as a usable key", () => {
  assert.throws(
    () => requireServiceEnv({ NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "k" }),
    /missing NEXT_PUBLIC_SUPABASE_URL/
  );
});

test("readServiceEnv reports absence without throwing", () => {
  assert.deepStrictEqual(readServiceEnv({}), { url: undefined, serviceKey: undefined });
  assert.deepStrictEqual(readServiceEnv(FULL), {
    url: "https://proj.supabase.co",
    serviceKey: "service-key",
  });
});
