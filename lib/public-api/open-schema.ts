// Response schemas are open: a client must ignore properties it does not know.
//
// zod's JSON Schema output for `z.object` says `additionalProperties: false`,
// which turns every additive field into a breaking change for a client that
// validates strictly against a copy of the schema it fetched earlier. That
// happened on 2026-11-20: #143 added `data.liftDay` to the conditions
// envelope and MCP clients holding the previous `tools/list` rejected
// `get_resort_conditions` ("data must NOT have additional properties"). The
// server does not advertise `listChanged`, so those clients never refetch.
//
// `openResponseSchema` removes every `additionalProperties: false` from an
// emitted JSON Schema. It is applied to what we PUBLISH for responses
// (/.well-known/schemas, OpenAPI components; the MCP server it was written
// for was retired on 2026-11-21); it never touches the zod schemas that
// validate input.

type Json = unknown;

/** A deep copy of `schema` with every `additionalProperties: false` removed. */
export function openResponseSchema<T extends Json>(schema: T): T {
  if (Array.isArray(schema)) return schema.map((v) => openResponseSchema(v)) as T;
  if (schema && typeof schema === "object") {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(schema as Record<string, Json>)) {
      if (k === "additionalProperties" && v === false) continue;
      out[k] = openResponseSchema(v);
    }
    return out as T;
  }
  return schema;
}

/** Paths (dot-joined) of every `additionalProperties: false` in a JSON Schema; empty when it is open. */
export function closedObjectPaths(schema: Json, path = "$"): string[] {
  if (Array.isArray(schema)) return schema.flatMap((v, i) => closedObjectPaths(v, `${path}[${i}]`));
  if (schema && typeof schema === "object") {
    const o = schema as Record<string, Json>;
    return [...(o.additionalProperties === false ? [path] : []), ...Object.entries(o).flatMap(([k, v]) => closedObjectPaths(v, `${path}.${k}`))];
  }
  return [];
}

/** Request-body schemas in the registry: these stay closed, they describe what we accept. */
export const REQUEST_SCHEMA_IDS: ReadonlySet<string> = new Set(["BatchRequest"]);
