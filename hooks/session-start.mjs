#!/usr/bin/env node
/**
 * SessionStart hook: spawn the health-check daemon as a detached process if
 * one isn't already running.
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { loadConfig, gitRepoUrl } from '../lib/config.mjs';
import { resolveSessionId } from '../lib/ids.mjs';
import { sendEvent, flushQueue } from '../lib/client.mjs';
import { clientMetaBase } from '../lib/client-meta.mjs';
import { readSessionName } from '../lib/transcript-meta.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const daemonScript = join(here, '..', 'lib', 'healthcheck-daemon.mjs');
const pidFile = join(homedir(), '.claude-metrics', 'healthcheck.pid');

function isAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function existingPid() {
    if (!existsSync(pidFile)) {
        return null;
    }
    try {
        const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
        return Number.isInteger(pid) && pid > 0 ? pid : null;
    } catch {
        return null;
    }
}

async function postInitialSession(cfg) {
    let payload = {};
    try {
        const raw = readFileSync(0, 'utf8');
        payload = raw ? JSON.parse(raw) : {};
    } catch {
        // ignore
    }

    const sessionId = resolveSessionId(payload.session_id);
    const body = {
        session_id: sessionId,
        session_name: readSessionName(payload.transcript_path),
        account_email: cfg.accountEmail,
        account_uuid: cfg.accountUuid,
        organization_uuid: cfg.organizationUuid,
        started_at: new Date().toISOString(),
        cwd: process.cwd(),
        git_repo: gitRepoUrl(),
        exit_kind: 'active',
        client_meta: { ...clientMetaBase() },
    };

    await sendEvent('events/session', body).catch(() => {});
    await flushQueue().catch(() => {});
}

function spawnDaemon() {
    const pid = existingPid();
    if (pid && isAlive(pid)) {
        return;
    }
    const child = spawn(process.execPath, [daemonScript], {
        detached: true,
        stdio: 'ignore',
        env: process.env,
    });
    child.unref();
}

function emitSetupContext(cfg) {
    const lines = [
        'Claude Metrics plugin is installed but no API token is configured.',
        '',
        `API URL: ${cfg.apiUrl}`,
        '',
        'Ask the user for their Claude Metrics organization API token (format: cm_<48 chars>, issued from the admin panel). When the user provides the token, do all of the following:',
        '',
        '  1. Create directory ~/.claude-metrics/ if it does not exist.',
        '  2. Write the token verbatim (no trailing newline) to ~/.claude-metrics/token.',
        '  3. Run: chmod 600 ~/.claude-metrics/token',
        `  4. Verify the API is reachable: curl -fsS ${cfg.apiUrl}/health`,
        '  5. Tell the user to restart Claude Code so the plugin picks up the token.',
        '',
        'If the user does not have a token, point them at their org admin panel to issue one.',
    ];
    const out = {
        hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: lines.join('\n'),
        },
    };
    process.stdout.write(JSON.stringify(out));
}

async function main() {
    const cfg = loadConfig();
    if (cfg.disabled || !cfg.apiUrl) {
        return;
    }

    if (!cfg.apiToken) {
        emitSetupContext(cfg);
        return;
    }

    spawnDaemon();
    await postInitialSession(cfg);
}

main()
    .catch(() => {})
    .finally(() => process.exit(0));
