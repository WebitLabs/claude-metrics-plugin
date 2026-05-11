# Claude Metrics — Plugin

Captures lifecycle events from Claude Code and posts them to the Claude Metrics ingest API. All requests carry `Authorization: Bearer <CLAUDE_METRICS_API_TOKEN>` (per-organization token issued by the ingest API).

## What it sends

| Hook | Endpoint | Notable fields |
|---|---|---|
| `UserPromptSubmit` | `POST {API_URL}/events/prompt` | `event_id`, `account_email`, `session_id`, `turn_id`, `folder_path`, `git_repo`, **`prompt_text` (full)**, `model`, `effort`, `context_tokens`, `context_percent`, `is_reprompt`, `gap_ms`, `client_meta` |
| `Stop` | `POST {API_URL}/events/execution` | `event_id`, `account_email`, `session_id`, `turn_id`, **`response_text` (full)**, `tools_used`, `slash_commands_used`, `skills_activated`, `images_pasted`, `tokens_in`/`tokens_out`/`cache_read_tokens`/`cache_creation_tokens`, `thinking_tokens`, `thinking_blocks_count`, `parallel_tools_max`/`parallel_tools_avg`, `status`, `client_meta` |
| `PreToolUse` | (none — pushes tool onto in-memory stack) | n/a |
| `PostToolUse` | `POST {API_URL}/events/tool` | `event_id`, `tool_name`, `success`, `duration_ms`, `input_bytes`, `output_bytes`, `subagent_depth`, `permission_mode`, and (if `CLAUDE_METRICS_BASH_ARGS=1`) the bash command string truncated to 8000 chars |
| `Notification` / `PreCompact` / `SubagentStop` | `POST {API_URL}/events/system` | `kind`, plus kind-specific payload (truncated: messages 1000 chars, titles 200 chars, custom instructions 2000 chars) |
| `SessionStart` / `SessionEnd` | `POST {API_URL}/events/session` | session bookkeeping; SessionStart also spawns the healthcheck daemon if no live PID is recorded |

## Privacy boundary — what is and is not sent

**Sent in full:** `prompt_text` from every UserPromptSubmit, `response_text` from every Stop. No truncation, no redaction. If users may paste secrets into prompts, route this telemetry to an endpoint that is appropriate for that content classification.

**Sent opt-in:** Bash command argument strings, only when `CLAUDE_METRICS_BASH_ARGS=1` is set in the plugin's environment. Default is off; only the bash command kind (`git` / `npm` / `php` / `test` / `fs` / `net` / `docker`) is sent instead of the raw argv.

**Never sent:** thinking-block text (only `thinking_tokens` count and `thinking_blocks_count`). The API authorization token itself is sent only in the `Authorization` header, never in payloads or logs.

**Truncation:** Notification messages → 1000 chars. Notification titles → 200 chars. PreCompact custom instructions → 2000 chars. Bash argv (when enabled) → 8000 chars. Other free-form fields are sent in full.

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

| Variable | Required | Default | Notes |
|---|---|---|---|
| `CLAUDE_METRICS_API_URL` | yes | — | Base URL ending in `/api/v1` |
| `CLAUDE_METRICS_API_TOKEN` | yes | reads `~/.claude-metrics/token` if env var unset | Per-organization secret, format `cm_<48 chars>`. Issued by the Claude Metrics admin panel |
| `CLAUDE_METRICS_DISABLED` | no | unset | Set to `"1"` to disable all sends |
| `CLAUDE_METRICS_ACCOUNT_EMAIL` | no | OAuth account → `git config user.email` → `$USER@$(hostname -d)` | Falls back through the chain in order |
| `CLAUDE_METRICS_BASH_ARGS` | no | unset | Set to `"1"` to include bash command argv in tool events (truncated to 8000 chars). Default off |
| `CLAUDE_METRICS_HEALTHCHECK_INTERVAL_MS` | no | `600000` (10 min) | Healthcheck daemon loop interval |

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

## What the plugin does NOT do

- No prompt-text or response-text redaction. Content is sent as-is — see the privacy section above.
- No bash-argv capture unless `CLAUDE_METRICS_BASH_ARGS=1`.
- No thinking-text capture.
- No outbound traffic except to `CLAUDE_METRICS_API_URL`. No analytics beacons, no third-party SDKs.
