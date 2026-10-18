import { publicError, publicJson, publicOptions } from "@/lib/public-api/headers";
import { buildJsonSchemas, schemaFileStems } from "@/lib/public-api/json-schemas";

// GET /.well-known/schemas/{file}.json — one JSON Schema (draft 2020-12)
// per registered wire shape, generated from the zod registry with absolute
// $id/$ref URLs back into this directory. `resort.json`, `cams.json`,
// `powder.json`, `status.json`, `search-index.json`, `ask.json`,
// `batch.json` and the component shapes they reference.
export const dynamic = "force-static";
export const dynamicParams = false;

const CACHE_CONTROL = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400";

export function generateStaticParams(): Array<{ file: string }> {
  return schemaFileStems().map((stem) => ({ file: `${stem}.json` }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }): Promise<Response> {
  const { file } = await params;
  const stem = file.endsWith(".json") ? file.slice(0, -5) : null;
  const schema = stem ? buildJsonSchemas()[stem] : undefined;
  if (!schema) return publicError(404, "schema_not_found", `No schema named ${file}. The index is at /.well-known/schemas.`);
  return publicJson(schema, { contentType: "application/schema+json; charset=utf-8", cacheControl: CACHE_CONTROL });
}

export function OPTIONS(): Response {
  return publicOptions();
}
