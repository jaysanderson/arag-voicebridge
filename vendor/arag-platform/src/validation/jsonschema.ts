/**
 * A compact JSON Schema (2020-12 subset) validator, sufficient for OpenAPI request/response
 * validation without a dependency. Supported: type (incl. arrays of types, "integer"), enum,
 * const, required, properties, additionalProperties (bool/schema), items, minItems, maxItems,
 * uniqueItems, minLength, maxLength, pattern, format (uuid, date-time, date, email, uri),
 * minimum, maximum, exclusiveMinimum/Maximum, multipleOf, nullable (OpenAPI 3.0 compat),
 * oneOf, anyOf, allOf, not, $ref (local `#/components/schemas/...` and `#/$defs/...`).
 */

export interface SchemaError {
  path: string;
  message: string;
}

export interface ValidateOptions {
  /** Root document for resolving `$ref`. */
  root?: unknown;
  /** Coerce strings to numbers/booleans (for query/path params). */
  coerce?: boolean;
}

type Schema = Record<string, unknown> | boolean;

const FORMATS: Record<string, RegExp> = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  "date-time": /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
  date: /^\d{4}-\d{2}-\d{2}$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  uri: /^[a-z][a-z0-9+.-]*:\/\/\S+$/i,
};

function resolveRef(ref: string, root: unknown): Schema {
  if (!ref.startsWith("#/")) throw new Error(`Only local $ref supported: ${ref}`);
  let node: unknown = root;
  for (const part of ref.slice(2).split("/")) {
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    if (typeof node !== "object" || node === null || !(key in (node as object)))
      throw new Error(`Unresolvable $ref: ${ref}`);
    node = (node as Record<string, unknown>)[key];
  }
  return node as Schema;
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function matchesType(v: unknown, t: string): boolean {
  const actual = typeOf(v);
  if (t === "number") return actual === "number" || actual === "integer";
  return actual === t;
}

/** Validate `value` against `schema`. Returns a list of errors (empty = valid). When `coerce` is set the coerced value is returned in `value`. */
export function validate(
  value: unknown,
  schema: Schema,
  opts: ValidateOptions = {},
): { errors: SchemaError[]; value: unknown } {
  const errors: SchemaError[] = [];
  const root = opts.root ?? schema;
  const out = walk(value, schema, "", errors, root, Boolean(opts.coerce), 0);
  return { errors, value: out };
}

function walk(
  value: unknown,
  schema: Schema,
  path: string,
  errors: SchemaError[],
  root: unknown,
  coerce: boolean,
  depth: number,
): unknown {
  if (depth > 64) return value;
  if (schema === true) return value;
  if (schema === false) {
    errors.push({ path, message: "schema forbids any value" });
    return value;
  }
  let s = schema;
  if (typeof s.$ref === "string")
    s = { ...(resolveRef(s.$ref, root) as Record<string, unknown>), ...omit(s, "$ref") };

  // nullable / null in type list
  const types = s.type === undefined ? [] : Array.isArray(s.type) ? (s.type as string[]) : [s.type as string];
  if (value === null && (s.nullable === true || types.includes("null"))) return value;

  // coercion for query/path params
  if (coerce && typeof value === "string" && types.length) {
    if (types.includes("integer") && /^-?\d+$/.test(value)) value = Number(value);
    else if (types.includes("number") && /^-?\d+(\.\d+)?$/.test(value)) value = Number(value);
    else if (types.includes("boolean") && /^(true|false)$/.test(value)) value = value === "true";
    else if (types.includes("array")) value = value.split(",");
  }

  if (types.length && !types.some((t) => matchesType(value, t))) {
    errors.push({ path, message: `expected ${types.join("|")}, got ${typeOf(value)}` });
    return value;
  }
  if (s.enum !== undefined && !(s.enum as unknown[]).some((e) => deepEqual(e, value))) {
    errors.push({ path, message: `must be one of ${JSON.stringify(s.enum)}` });
  }
  if (s.const !== undefined && !deepEqual(s.const, value))
    errors.push({ path, message: `must equal ${JSON.stringify(s.const)}` });

  if (typeof value === "string") {
    if (typeof s.minLength === "number" && value.length < s.minLength)
      errors.push({ path, message: `must be at least ${s.minLength} characters` });
    if (typeof s.maxLength === "number" && value.length > s.maxLength)
      errors.push({ path, message: `must be at most ${s.maxLength} characters` });
    if (typeof s.pattern === "string" && !new RegExp(s.pattern, "u").test(value))
      errors.push({ path, message: `must match ${s.pattern}` });
    if (typeof s.format === "string" && FORMATS[s.format] && !FORMATS[s.format]!.test(value))
      errors.push({ path, message: `must be a valid ${s.format}` });
  }
  if (typeof value === "number") {
    if (typeof s.minimum === "number" && value < s.minimum)
      errors.push({ path, message: `must be >= ${s.minimum}` });
    if (typeof s.maximum === "number" && value > s.maximum)
      errors.push({ path, message: `must be <= ${s.maximum}` });
    if (typeof s.exclusiveMinimum === "number" && value <= s.exclusiveMinimum)
      errors.push({ path, message: `must be > ${s.exclusiveMinimum}` });
    if (typeof s.exclusiveMaximum === "number" && value >= s.exclusiveMaximum)
      errors.push({ path, message: `must be < ${s.exclusiveMaximum}` });
    if (
      typeof s.multipleOf === "number" &&
      Math.abs(value / s.multipleOf - Math.round(value / s.multipleOf)) > 1e-9
    )
      errors.push({ path, message: `must be a multiple of ${s.multipleOf}` });
  }
  if (Array.isArray(value)) {
    if (typeof s.minItems === "number" && value.length < s.minItems)
      errors.push({ path, message: `must have at least ${s.minItems} items` });
    if (typeof s.maxItems === "number" && value.length > s.maxItems)
      errors.push({ path, message: `must have at most ${s.maxItems} items` });
    if (s.uniqueItems === true) {
      const seen = new Set(value.map((v) => JSON.stringify(v)));
      if (seen.size !== value.length) errors.push({ path, message: "items must be unique" });
    }
    if (s.items !== undefined) {
      value = value.map((v, i) =>
        walk(v, s.items as Schema, `${path}/${i}`, errors, root, coerce, depth + 1),
      );
    }
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const props = (s.properties ?? {}) as Record<string, Schema>;
    for (const r of (s.required as string[] | undefined) ?? []) {
      if (obj[r] === undefined) errors.push({ path: `${path}/${r}`, message: "is required" });
    }
    const next: Record<string, unknown> = { ...obj };
    for (const [k, ps] of Object.entries(props)) {
      if (obj[k] !== undefined) next[k] = walk(obj[k], ps, `${path}/${k}`, errors, root, coerce, depth + 1);
    }
    const ap = s.additionalProperties;
    if (ap === false || (ap && typeof ap === "object")) {
      for (const k of Object.keys(obj)) {
        if (k in props) continue;
        if (ap === false) errors.push({ path: `${path}/${k}`, message: "is not an allowed property" });
        else next[k] = walk(obj[k], ap as Schema, `${path}/${k}`, errors, root, coerce, depth + 1);
      }
    }
    value = next;
  }

  if (Array.isArray(s.allOf))
    for (const sub of s.allOf as Schema[]) value = walk(value, sub, path, errors, root, coerce, depth + 1);
  if (Array.isArray(s.anyOf)) {
    const ok = (s.anyOf as Schema[]).some(
      (sub) =>
        walk(value, sub, path, [], root, false, depth + 1) !== undefined &&
        countErrors(value, sub, root) === 0,
    );
    if (!ok) errors.push({ path, message: "does not match any allowed schema" });
  }
  if (Array.isArray(s.oneOf)) {
    const n = (s.oneOf as Schema[]).filter((sub) => countErrors(value, sub, root) === 0).length;
    if (n !== 1) errors.push({ path, message: `must match exactly one schema (matched ${n})` });
  }
  if (s.not !== undefined && countErrors(value, s.not as Schema, root) === 0)
    errors.push({ path, message: "must not match the forbidden schema" });
  return value;
}

function countErrors(value: unknown, schema: Schema, root: unknown): number {
  const errs: SchemaError[] = [];
  walk(value, schema, "", errs, root, false, 0);
  return errs.length;
}

function omit(o: Record<string, unknown>, key: string): Record<string, unknown> {
  const { [key]: _drop, ...rest } = o;
  return rest;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a))
    return Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  if (typeof a === "object") {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    return (
      ka.length === kb.length &&
      ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
    );
  }
  return false;
}

/** Format errors as a short human string. */
export function formatErrors(errors: SchemaError[]): string {
  return errors.map((e) => `${e.path || "/"} ${e.message}`).join("; ");
}
