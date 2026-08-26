# Assistant Runtime NDJSON Observability (Track E)

Structured traces for diagnosing stuck turns. Scaffold aligned with T3’s
`apps/server/src/observability/**` model, adapted to Cozea’s userdata paths.

## Flag: `cozea.obs.ndjson`

**Default: off.**

Enable local NDJSON span traces:

```shell
COZEA_OBS_NDJSON=1 bun run dev
```

When enabled, completed spans append to:

`<assistant-home>/userdata/logs/server.trace.ndjson`

(dev runs use `<assistant-home>/dev/logs/server.trace.ndjson`).

Each line is one JSON object (`type: "cozea-span"`) with `name`, `traceId`,
`spanId`, `durationMs`, sanitized `attributes`, and `exit`.

### Instrumented boundaries (best-effort)

- `turn.start` / `turn.end` — provider runtime turn lifecycle
- `provider.call.*` — ProviderService operation wrapper
- `git.status` — GitManager status refresh

Secret-looking attribute keys (`password`, `token`, `apiKey`, `authorization`, …)
are replaced with `[redacted]` before write.

## Optional OTLP (not required for CI)

Only used when NDJSON is on **and** a traces URL is set:

| Env | Purpose |
| --- | --- |
| `COZEA_OTLP_TRACES_URL` | OTLP/JSON HTTP endpoint (e.g. local Tempo) |
| `COZEA_OTLP_SERVICE_NAME` | defaults to `cozea-assistant-runtime` |
| `COZEA_OTLP_EXPORT_INTERVAL_MS` | batch interval, default `5000` |

Leave `COZEA_OTLP_TRACES_URL` unset in CI — no Grafana or collector is required.
Failed OTLP exports are dropped; the runtime continues.

## Smoke check

```shell
COZEA_OBS_NDJSON=1 # start the app / runtime, run one turn
tail -n 20 ~/.cozea/userdata/logs/server.trace.ndjson   # path may vary by home
```

You should see readable lines for `turn.start`, `provider.call.*`, and `turn.end`.
