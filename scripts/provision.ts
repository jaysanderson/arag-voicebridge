/**
 * Write a prospect's stored ARAG `ask` search configuration through the admin API of a RUNNING
 * VoiceBridge. Idempotent: re-running updates the same named configuration.
 *
 *   ADMIN_TOKEN=… make provision P=progress
 *   ADMIN_TOKEN=… make provision P=progress ARGS="--dry-run --reranker predict"
 */
const base = (process.env.BASE_URL ?? "http://localhost:8080").replace(/\/+$/, "");
const args = process.argv.slice(2);
const key = args.find((a) => !a.startsWith("--"));
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
if (!key) {
  console.error(
    "Usage: node scripts/provision.ts <prospect> [--dry-run] [--reranker noop|predict] [--model <id>]",
  );
  process.exit(1);
}
const token = process.env.ADMIN_TOKEN;
if (!token) {
  console.error("ADMIN_TOKEN is required (it protects /api/v1/admin/*). Never commit it.");
  process.exit(1);
}
const body: Record<string, unknown> = { dry_run: args.includes("--dry-run") };
if (flag("reranker")) body.reranker = flag("reranker");
if (flag("model")) body.generative_model = flag("model");
if (flag("name")) body.name = flag("name");

const res = await fetch(`${base}/api/v1/admin/prospects/${encodeURIComponent(key)}/provision`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
});
const out = (await res.json()) as Record<string, unknown>;
if (!res.ok) {
  console.error(`✖ HTTP ${res.status}: ${out.detail ?? JSON.stringify(out)}`);
  process.exit(1);
}
console.log(`${out.applied ? "✓ provisioned" : "· dry run"} ${out.name}`);
console.log(JSON.stringify(out.config, null, 2));
