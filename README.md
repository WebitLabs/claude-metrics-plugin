# Claude Metrics — Plugin

Captures `UserPromptSubmit` and `Stop` events from Claude Code and posts them to the Claude Metrics ingest API.

## What it sends

| Hook | Endpoint | Payload |
|---|---|---|
| `UserPromptSubmit` | `POST {CLAUDE_METRICS_API_URL}/events/prompt` | `event_id`, `account_email`, `session_id`, `turn_id`, `folder_path`, `git_repo`, `prompt_text`, `client_meta` |
| `Stop` | `POST {CLAUDE_METRICS_API_URL}/events/execution` | `event_id`, `account_email`, `session_id`, `turn_id`, `message_length`, `lines_of_code`, `tools_used`, `status`, `client_meta` |
| `SessionStart` | spawns daemon | spawns the detached health-check daemon if not already running |

The plugin **does not** send the assistant response text — only its character length.

## Health-check daemon

Independent background process spawned at `SessionStart`. Loops every 10 minutes and POSTs `{ account_email, client_meta }` to `{CLAUDE_METRICS_API_URL}/health-checks`. Detached from Claude Code; lives until killed.

- PID file: `~/.claude-metrics/healthcheck.pid`
- Log: `~/.claude-metrics/healthcheck.log`
- Interval override: `CLAUDE_METRICS_HEALTHCHECK_INTERVAL_MS` (default `600000`)
- Single-instance: if a live PID is recorded, SessionStart does nothing.
- Stop the daemon: `/claude-metrics-stop-healthcheck` slash command.

## Install

From inside Claude Code:

```
/plugin marketplace add WebitLabs/claude-metrics-plugin
/plugin install claude-metrics@claude-metrics
```

Then restart Claude Code. The plugin reads its endpoint from
`CLAUDE_METRICS_API_URL` (env) — set this in your shell rc to point at
your Claude Metrics SaaS endpoint, e.g.:

```bash
export CLAUDE_METRICS_API_URL="https://metrics.yoursaas.com/api/v1"
```

## Install (local dev, monorepo)

If you're working in the parent monorepo (`WebitLabs/claude-metrics`),
run `./install.sh` instead — it registers the plugin from your local
working copy and writes the env vars to your shell rc.

## Configuration (env)

| Variable | Required | Default |
|---|---|---|
| `CLAUDE_METRICS_API_URL` | yes | — |
| `CLAUDE_METRICS_DISABLED` | no | unset (set to `"1"` to disable) |
| `CLAUDE_METRICS_ACCOUNT_EMAIL` | no | falls back to `git config user.email`, then `$USER@$(hostname -d)` |
| `CLAUDE_METRICS_HEALTHCHECK_INTERVAL_MS` | no | `600000` (10 min) |

## Slash commands

- `/claude-metrics-status` — endpoint, opt-out state, queue depth, last successful send, daemon status, last 3 errors.
- `/claude-metrics-stop-healthcheck` — terminate the background health-check daemon.

## Local state

The plugin keeps a small state directory at `~/.claude-metrics/`:
- `queue.json` — retry queue, capped at 10 MB.
- `sessions.json` — session→turn id mapping so `Stop` can pair with `UserPromptSubmit`.
- `errors.log` — 422 validation errors and final-attempt failures.
- `ack` — first-run banner acknowledgement.
- `last-send` — ISO timestamp of last successful send.
- `healthcheck.pid` — daemon PID.
- `healthcheck.log` — daemon log.

## Retry policy

- 3-second hard request timeout.
- On non-2xx (except 422): enqueue, retry up to 5 times with backoff `1m → 5m → 30m → 2h → 12h`.
- On 422: log to `errors.log` and drop. The payload is wrong and retrying will not help.
- On 202 with `{ "duplicate": true }`: treat as success.

## What the plugin does NOT do (POC)

- No authentication header.
- No assistant response text capture.
- No heartbeat / `session_start` / `session_end` events.
- No prompt-text redaction.
- No outbound traffic except to `CLAUDE_METRICS_API_URL`.
