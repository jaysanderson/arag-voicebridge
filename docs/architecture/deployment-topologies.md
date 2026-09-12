# Deployment topologies

## Single Fly machine + volume (the shipped topology)

`fly.toml` deploys one `shared-cpu-1x` / 512 MB machine in `iad`, with `min_machines_running = 1`
(a warm machine so the first demo turn of the day is not a cold start) and
`auto_stop_machines = "suspend"` / `auto_start_machines = true` otherwise. `DATA_DIR=/data` is a
mounted 1 GB volume (`[[mounts]]`) — this is where `prospects.json`, `turns.json`, `jobs.json` and
`golden-evals.json` live (see [`data-flow.md`](data-flow.md)). Because the JSON store is a
single-writer, in-memory-plus-flush design (`vendor/arag-platform/src/store/jsonstore.ts`), this
topology has a hard limit baked in: **the volume ties the deployment to exactly one machine.**
Scaling to `min_machines_running > 1` or adding a second region would give each machine its own,
diverging registry/turn-log/job state — there is no shared store to coordinate them. See
[`scaling.md`](scaling.md) for what has to change first.

`http_service.concurrency` is a soft limit of 40 / hard limit of 60 concurrent requests — generous
for a demo, not sized for production call volumes (see [`scaling.md`](scaling.md) for the real
bottleneck, which is ARAG generation latency per turn, not request concurrency).

## Co-location with the ARAG zone

`primary_region = "iad"` is chosen specifically because the default `ARAG_REGION_DEFAULT`
(`aws-us-east-2-1`) resolves to a host near Fly's `iad` region — the comment in `fly.toml` spells
this out. Every extra network hop between the voice agent, VoiceBridge and ARAG adds directly to
perceived turn latency, and generation time already dominates that budget (see
[`scaling.md`](scaling.md)). If a prospect's Knowledge Box sits in a different ARAG zone/region,
the right fix is to co-locate a VoiceBridge deployment near *that* zone, not to accept the extra
round trip — `AragClientPool.baseUrlFor()` already resolves a per-prospect base URL from the
prospect's own `region` field, so multiple prospects with different zones can share one deployment
at the cost of some of them carrying a longer hop.

## Multi-region notes

A genuinely multi-region deployment (one VoiceBridge machine per ARAG zone a customer base spans)
is possible today only if each region's machine owns its **own** prospect subset and its own
`DATA_DIR` — i.e. treat each region as a fully independent deployment rather than a scaled-out
cluster of one product, because the JSON store has no cross-machine consistency story. Sharing one
logical registry across regions needs the store extension point in
[`../developer/extension-points.md`](../developer/extension-points.md) (a real database) resolved
first. Until then, "multi-region" in practice means "multiple independent single-machine
deployments, one per region, each provisioned with the subset of prospects that belong there."

## Behind an existing gateway

VoiceBridge's own security headers, CORS allowlist and rate limiting (see
[`security-model.md`](security-model.md)) are designed to be sufficient standalone, but nothing
about the product assumes it is internet-facing directly. Running it behind an existing API gateway
or reverse proxy needs exactly two things configured correctly:

- **Client IP attribution for rate limiting** — `TRUST_PROXY` (`fly | xff | none`) controls which
  header the platform's rate limiter trusts to identify a client. `fly` trusts Fly's own proxy
  headers; behind a different gateway that terminates TLS and forwards `X-Forwarded-For`, set
  `TRUST_PROXY=xff` so the token-bucket limiter keys on the real client rather than the gateway's
  own address (which would otherwise let every client behind the gateway share one bucket). Set
  `TRUST_PROXY=none` only when there is no reverse proxy at all and the connecting socket address
  is already the real client.
- **`ALLOWED_ORIGINS`** — same-origin requests (the workspace and Operator, served by
  VoiceBridge itself) never send an `Origin` header on same-origin `GET`s and so are unaffected;
  cross-origin browser clients (an embedded widget on a separate marketing site, for example) need
  their origin listed explicitly, since the default is same-origin only.

A gateway that also wants to add its own authentication in front of VoiceBridge's own
(`API_KEYS`/`ADMIN_TOKEN`) can do so without conflict — VoiceBridge's auth is purely additive and
does not assume it is the only layer.
