/**
 * Generate docs/developer/api-reference.md from an OpenAPI document.
 *   node scripts/openapi-to-md.ts <openapi.json|url> <out.md>
 * Zero dependencies; renders paths, parameters, request/response schemas.
 */
import { readFileSync, writeFileSync } from "node:fs";

const [src, out] = process.argv.slice(2);
if (!src || !out) {
  console.error("usage: openapi-to-md.ts <openapi.json|url> <out.md>");
  process.exit(1);
}
const doc = src.startsWith("http") ? await (await fetch(src)).json() : JSON.parse(readFileSync(src, "utf8"));
const paths = doc.paths as Record<string, Record<string, Record<string, unknown>>>;
const schemas = ((doc.components as Record<string, unknown>)?.schemas ?? {}) as Record<
  string,
  Record<string, unknown>
>;

function ref(s: unknown): string {
  if (!s || typeof s !== "object") return "";
  const o = s as Record<string, unknown>;
  if (typeof o.$ref === "string") {
    const n = o.$ref.split("/").pop() ?? "";
    return `[${n}](#${n.toLowerCase()})`;
  }
  if (o.type === "array")
    return `array of ${ref(o.items) || String((o.items as Record<string, unknown>)?.type ?? "any")}`;
  return String(o.type ?? "object");
}
function schemaTable(s: Record<string, unknown>): string {
  const props = (s.properties ?? {}) as Record<string, Record<string, unknown>>;
  const req = new Set((s.required as string[]) ?? []);
  if (!Object.keys(props).length) return `_${ref(s) || "object"}_\n`;
  const rows = Object.entries(props).map(
    ([k, v]) =>
      `| \`${k}\` | ${ref(v)}${v.enum ? ` (${(v.enum as unknown[]).map((e) => `\`${e}\``).join(", ")})` : ""} | ${req.has(k) ? "yes" : ""} | ${String(v.description ?? "").replace(/\n/g, " ")} |`,
  );
  return `| Field | Type | Required | Description |\n|---|---|---|---|\n${rows.join("\n")}\n`;
}

const sec = ((doc.components as Record<string, unknown>)?.securitySchemes ?? {}) as Record<
  string,
  Record<string, unknown>
>;
let md = `# API reference — ${doc.info.title} v${doc.info.version}\n\n${doc.info.description ?? ""}\n\nGenerated from \`openapi.json\` — do not edit by hand. Interactive docs: \`/api/v1/docs\` (Redoc) and \`/api/v1/swagger\` (try it out).\n\n## Authentication\n\n${Object.entries(
  sec,
)
  .map(([k, v]) => `- **${k}** — ${v.type} ${v.scheme ?? v.in ?? ""} ${v.name ?? ""}: ${v.description ?? ""}`)
  .join("\n")}\n\n`;
const byTag = new Map<string, string[]>();
for (const [p, ops] of Object.entries(paths)) {
  for (const [m, op] of Object.entries(ops)) {
    if (m === "parameters") continue;
    const tag = ((op.tags as string[]) ?? ["other"])[0]!;
    const params = [
      ...((ops.parameters as unknown as unknown[]) ?? []),
      ...((op.parameters as unknown[]) ?? []),
    ] as Array<Record<string, unknown>>;
    let block = `### \`${m.toUpperCase()} ${p}\`\n\n**${op.summary ?? op.operationId}**${op.description ? ` — ${op.description}` : ""}\n\n`;
    if (params.length) {
      block += `Parameters:\n\n| Name | In | Type | Required | Description |\n|---|---|---|---|---|\n${params
        .map(
          (x) =>
            `| \`${x.name}\` | ${x.in} | ${ref(x.schema)} | ${x.required ? "yes" : ""} | ${x.description ?? ""} |`,
        )
        .join("\n")}\n\n`;
    }
    const rb = (op.requestBody as Record<string, unknown> | undefined)?.content as
      | Record<string, Record<string, unknown>>
      | undefined;
    if (rb) {
      for (const [ct, c] of Object.entries(rb)) {
        const inline = typeof c.schema === "object" && !(c.schema as Record<string, unknown>).$ref;
        block += `Request body (\`${ct}\`): ${ref(c.schema)}\n\n${inline ? schemaTable(c.schema as Record<string, unknown>) : ""}\n`;
      }
    }
    block += "Responses:\n\n";
    for (const [code, r] of Object.entries((op.responses ?? {}) as Record<string, Record<string, unknown>>)) {
      const content = (r.content ?? {}) as Record<string, Record<string, unknown>>;
      const first = Object.entries(content)[0];
      block += `- \`${code}\` ${r.description ?? ""}${first ? ` — \`${first[0]}\` ${ref(first[1]?.schema)}` : ""}\n`;
    }
    const security = op.security as Array<Record<string, unknown>> | undefined;
    block += `\nAuth: ${security?.length ? security.map((s) => Object.keys(s).join("+")).join(" or ") : "public"}\n\n`;
    byTag.set(tag, [...(byTag.get(tag) ?? []), block]);
  }
}
for (const [tag, blocks] of byTag) md += `## ${tag}\n\n${blocks.join("\n")}`;
md += "## Schemas\n\n";
for (const [name, s] of Object.entries(schemas))
  md += `### ${name}\n\n${s.description ? `${s.description}\n\n` : ""}${schemaTable(s)}\n`;
writeFileSync(out, md);
console.log(`wrote ${out} (${Object.keys(paths).length} paths, ${Object.keys(schemas).length} schemas)`);
