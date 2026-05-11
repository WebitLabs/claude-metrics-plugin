---
description: Configure the Claude Metrics plugin — set API token (and optionally API URL).
allowed-tools: Bash, Read, Write
---

Walk the user through configuring the Claude Metrics plugin.

## Step 1 — show current status

Run and report the output:

!`node "${CLAUDE_PLUGIN_ROOT}/lib/status.mjs"`

## Step 2 — collect the API token

Ask the user for their Claude Metrics organization API token. Tell them:

- Format: `cm_` followed by 48 alphanumeric characters
- Where to get it: their Claude Metrics admin panel → Organizations → "Rotate token" or "View"
- One token per organization; everyone in the org shares it

If the user does not have one, stop here and tell them to ask their org admin to issue one.

## Step 3 — save the token

When the user pastes a token that starts with `cm_`:

1. Ensure directory exists: `mkdir -p ~/.claude-metrics`
2. Write the token verbatim (no trailing newline, no whitespace) to `~/.claude-metrics/token` using the Write tool
3. Restrict permissions: `chmod 600 ~/.claude-metrics/token`

Do not echo the token back in chat after saving — treat it like a password.

## Step 4 — optional: custom API URL

Ask whether they want to point at a custom API URL.

- Default (no action needed): `http://127.0.0.1:8000/api/v1` (local Laravel dev server)
- Custom: tell them to add `export CLAUDE_METRICS_API_URL="https://metrics.example.com/api/v1"` to their shell rc (`~/.zshrc` or `~/.bashrc`) and `exec $SHELL` to reload

## Step 5 — verify reachability

Run a healthcheck against the configured URL. If the user did not set a custom URL, use the default:

!`curl -fsS "${CLAUDE_METRICS_API_URL:-http://127.0.0.1:8000/api/v1}/health" || echo "API not reachable"`

If unreachable, tell the user to start the Laravel server (`composer run dev`) or fix the URL.

## Step 6 — finish

Tell the user to restart Claude Code so the SessionStart hook picks up the token. After restart, telemetry will flow on the next prompt.
