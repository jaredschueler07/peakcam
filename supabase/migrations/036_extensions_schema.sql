-- ─────────────────────────────────────────────────────────────
-- Migration 036 — move `vector` and `pg_trgm` out of `public`.
--
-- WHY. Security Advisor `extension_in_public` (live-database audit on
-- 2026-11-07): `vector` (0.8.0) and `pg_trgm` (1.6) are installed in
-- `public`. Split out of 034 so the policy and index work there does not wait
-- on, or roll back with, an extension move.
--
-- WHAT. A guarded `DO` block raises if any column, index, view, default,
-- policy or non-extension function depends on either extension (the
-- extensions' own members, deptype 'e', are excluded), then runs `ALTER
-- EXTENSION ... SET SCHEMA extensions` for each. Role search_path: `postgres`
-- has `"$user", public, extensions`; `anon`, `authenticated` and
-- `service_role` use the cluster default (no `extensions`). Nothing in the app
-- uses either extension, so no caller loses access.
--
-- APPLY. By hand (SQL Editor / MCP `apply_migration`), the whole file in one
-- run so it is one transaction and `set local lock_timeout` applies: a
-- statement that cannot get its lock within 3 s fails and rolls everything
-- back; re-run it then. Independent of 034 and 035. Idempotent: a no-op once
-- the extensions are out of `public`.
--
-- VERIFY.
--   Supabase Dashboard → Advisors → Security Advisor: `extension_in_public`
--   shows 0 warnings for `vector` and `pg_trgm`, and
--   ```sql
--   -- expect nspname = 'extensions' for both
--   select e.extname, n.nspname
--   from pg_extension e
--   join pg_namespace n on n.oid = e.extnamespace
--   where e.extname in ('vector', 'pg_trgm');
--   ```
-- ─────────────────────────────────────────────────────────────

set local lock_timeout = '3s';

-- ── Move `vector` and `pg_trgm` from `public` to `extensions` ──
-- Both are relocatable in prod (`vector` 0.8.0, `pg_trgm` 1.6 have
-- `extrelocatable = true`), so this is `alter extension ... set schema
-- extensions` for each. A non-relocatable extension raises instead of being
-- dropped and recreated. No-op on re-run once the extension is out of `public`.
--
-- Guard, per extension, before moving it (any hit raises and rolls back the
-- whole migration):
--   a. Catalog dependents: any table column, index, view/rule, column default,
--      constraint, domain/type, function signature, policy or trigger that
--      depends (deptype 'n'/'a') on an object owned by the extension. Objects
--      that are themselves members of an extension (deptype 'e', e.g.
--      pg_trgm's own functions and operator classes) are excluded, and only
--      those catalogs are inspected, so the extension's internals (implicit
--      array types `_vector`/`_gtrgm` with deptype 'i', `pg_amop`/`pg_amproc`
--      rows of its own operator families) never trip the check. This covers
--      columns of type vector/halfvec/sparsevec and indexes using a
--      trgm/vector/hnsw/ivfflat operator class.
--   b. Function bodies: `pg_depend` does not track names inside SQL/plpgsql
--      bodies, so non-extension functions whose source mentions the
--      extension's types or functions are matched by name.
-- Neither applies in prod on 2026-11-07 (no such columns, indexes or
-- functions).
--
-- search_path after the move: the `postgres` role has `"$user", public,
-- extensions`; `anon`, `authenticated` and `service_role` have no role-level
-- override (cluster default, which does not include `extensions`). Nothing in
-- the app calls `similarity()`/`%`/vector operators, so that is fine; any
-- future use must schema-qualify (`extensions.similarity(...)`) or set the
-- function's search_path.

create schema if not exists extensions;

do $$
declare
  ext_name        text;
  ext_oid         oid;
  is_relocatable  boolean;
  dep_detail      text;
begin
  foreach ext_name in array array['pg_trgm', 'vector'] loop
    select e.oid, e.extrelocatable
      into ext_oid, is_relocatable
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = ext_name
      and n.nspname = 'public';

    -- Not installed, or already moved out of `public`: skip.
    if not found then
      continue;
    end if;

    -- a. Catalog dependents on objects owned by this extension.
    select string_agg(distinct pg_describe_object(d.classid, d.objid, d.objsubid), ', ')
      into dep_detail
    from pg_depend member
    join pg_depend d
      on d.refclassid = member.classid
     and d.refobjid   = member.objid
    where member.refclassid = 'pg_extension'::regclass
      and member.refobjid   = ext_oid
      and member.deptype    = 'e'
      and d.deptype in ('n', 'a')
      and d.classid in (
        'pg_class'::regclass, 'pg_rewrite'::regclass, 'pg_attrdef'::regclass,
        'pg_constraint'::regclass, 'pg_type'::regclass, 'pg_proc'::regclass,
        'pg_policy'::regclass, 'pg_trigger'::regclass
      )
      and not exists (
        select 1
        from pg_depend own
        where own.classid    = d.classid
          and own.objid      = d.objid
          and own.refclassid = 'pg_extension'::regclass
          and own.deptype    = 'e'
      );

    if dep_detail is not null then
      raise exception 'Cannot move extension % out of public: objects depend on it: %', ext_name, dep_detail;
    end if;

    -- b. Non-extension function bodies that name the extension's types/functions.
    select string_agg(format('%I.%I', n.nspname, p.proname), ', ')
      into dep_detail
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema')
      and not exists (
        select 1
        from pg_depend own
        where own.classid    = 'pg_proc'::regclass
          and own.objid      = p.oid
          and own.refclassid = 'pg_extension'::regclass
          and own.deptype    = 'e'
      )
      and (
        (ext_name = 'vector' and p.prosrc ~* '\m(vector|halfvec|sparsevec|l2_distance|inner_product|cosine_distance|l1_distance|hamming_distance|jaccard_distance)\M')
        or (ext_name = 'pg_trgm' and p.prosrc ~* '\m(similarity|word_similarity|strict_word_similarity|show_trgm|show_limit|set_limit|gtrgm\w*)\M')
      );

    if dep_detail is not null then
      raise exception 'Cannot move extension % out of public: function bodies reference it: %', ext_name, dep_detail;
    end if;

    if not is_relocatable then
      raise exception 'Extension % is not relocatable; move it by hand (drop + create in extensions) after checking dependents', ext_name;
    end if;

    execute format('alter extension %I set schema extensions', ext_name);
  end loop;
end
$$;
