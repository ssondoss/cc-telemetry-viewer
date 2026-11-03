# cc-telemetry-viewer

A small, local, live dashboard for [Claude Code](https://code.claude.com) telemetry. It shows tokens, cost and time, grouped by request type (main thread, subagents, `agent_summary`, `away_summary`, …), by model, by Claude Code version or by day.

- **One command, no dependencies.** It receives OpenTelemetry data from Claude Code directly. You don't need a collector, Docker or a database.
- **Local only.** It listens on `127.0.0.1` and never sends data anywhere.
- **Privacy-minded storage.** Only the fields the dashboard needs are saved. Emails, account IDs and organization IDs are dropped.
- **Bounded storage.** Detailed logs are kept for 7 days (or up to 100,000 requests). After that they're automatically compacted into daily totals.

> Not affiliated with or endorsed by Anthropic. Claude Code's telemetry format may change between versions.

## Quick start

Requires Node.js 18.17 or newer.

```bash
npx cc-telemetry-viewer
```

Then start Claude Code with telemetry pointed at the viewer:

```bash
CLAUDE_CODE_ENABLE_TELEMETRY=1 \
OTEL_LOGS_EXPORTER=otlp \
OTEL_EXPORTER_OTLP_PROTOCOL=http/json \
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 \
OTEL_LOGS_EXPORT_INTERVAL=5000 \
claude
```

Open http://127.0.0.1:4318. Requests appear about 5 seconds after Claude Code makes them.

### Always on, including the VS Code extension

Add the variables to the `env` block of `~/.claude/settings.json` (all projects) or `.claude/settings.local.json` (one project):

```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "http://127.0.0.1:4318",
    "OTEL_LOGS_EXPORT_INTERVAL": "5000"
  }
}
```

New sessions pick it up. If the viewer isn't running, Claude Code works as normal and the telemetry is dropped.

## The dashboard

| Panel | Shows |
|-------|-------|
| Overview | Cost, requests, tokens, output tokens, average request time |
| Breakdown | Requests, input, cache read, cache write, output, cost, average time and share of cost per group |
| Daily history | Totals per day, including compacted days |
| Latest requests | The newest detailed requests, live |

Open **Settings** to show or hide panels, change the grouping, pick a date range and set the refresh interval. Settings are saved in your browser.

**Compact logs** converts every detailed log into daily totals and deletes the detail. Cost, tokens, time and history stay. Only the "Latest requests" list is emptied.

## Options

```
--port <number>            Port for the dashboard and the OTLP receiver (default 4318)
--data-dir <path>          Where data is stored (default ./data in the project folder)
--retention-days <number>  Days of detailed logs to keep before compacting (default 7)
--max-events <number>      Maximum detailed logs to keep (default 100000)
```

## Data

Everything lives in the data directory:

| File | Contents |
|------|----------|
| `events.jsonl` | One line per detailed API request: time, request type, model, version, session ID, token counts, cost, duration |
| `daily.json` | Compacted totals per day, request type, model and version |

Delete the directory to start fresh.

## How it works

Claude Code exports OpenTelemetry logs over OTLP. With `OTEL_EXPORTER_OTLP_PROTOCOL=http/json` it sends them as JSON `POST` requests to `/v1/logs`. The viewer keeps the `claude_code.api_request` events, stores the fields above and serves the dashboard on the same port. Metrics sent to `/v1/metrics` are acknowledged but not stored yet.

## Development

```bash
npm start -- --port 4319
```

## License

MIT
