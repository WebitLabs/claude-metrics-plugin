#!/usr/bin/env node
/**
 * Standalone health-check daemon.
 *
 * Loops every CLAUDE_METRICS_HEALTHCHECK_INTERVAL_MS (default 600_000 = 10 min) and
 * POSTs { account_email } to {CLAUDE_METRICS_API_URL}/health-checks.
 *
 * Independent of the prompt/stop hooks: spawned detached at SessionStart, exits
 * when its own PID file is removed or replaced.
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig } from './config.mjs';
import { clientMetaBase } from './client-meta.mjs';

const stateDir = join(homedir(), '.claude-metrics');
const pidFile = join(stateDir, 'healthcheck.pid');
const logFile = join(stateDir, 'healthcheck.log');
const REQUEST_TIMEOUT_MS = 5000;
const INTERVAL_MS = parseInt(process.env.CLAUDE_METRICS_HEALTHCHECK_INTERVAL_MS || '600000', 10);

function ensureDir() {
    if (!existsSync(stateDir)) {
        mkdirSync(stateDir, { recursive: true });
    }
}

function log(line) {
    ensureDir();
    appendFileSync(logFile, `[${new Date().toISOString()}] ${line}\n`);
}

function ownsPidFile() {
    if (!existsSync(pidFile)) {
        return false;
    }
    const recorded = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
    return recorded === process.pid;
}

function claimPidFile() {
    ensureDir();
    writeFileSync(pidFile, String(process.pid));
}

function releasePidFile() {
    if (ownsPidFile()) {
        try {
            unlinkSync(pidFile);
        } catch {
            // ignore
        }
    }
}

async function postOnce(url, body, token) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        const res = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        return { status: res.status };
    } finally {
        clearTimeout(timer);
    }
}

async function tick(cfg) {
    const url = `${cfg.apiUrl}/health-checks`;
    const body = {
        account_email: cfg.accountEmail,
        account_uuid: cfg.accountUuid,
        organization_uuid: cfg.organizationUuid,
        client_meta: { ...clientMetaBase(), sent_at: new Date().toISOString() },
    };
    try {
        const { status } = await postOnce(url, body, cfg.apiToken);
        if (status >= 200 && status < 300) {
            log(`ok ${status}`);
        } else {
            log(`non-2xx ${status}`);
        }
    } catch (err) {
        log(`error ${err && err.message ? err.message : err}`);
    }
}

async function main() {
    const cfg = loadConfig();
    if (cfg.disabled || !cfg.apiUrl) {
        log('disabled or no CLAUDE_METRICS_API_URL — exiting');
        return;
    }

    claimPidFile();
    log(`daemon up, pid=${process.pid}, interval=${INTERVAL_MS}ms, email=${cfg.accountEmail}`);

    const stop = () => {
        log('signal — exiting');
        releasePidFile();
        process.exit(0);
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);

    while (ownsPidFile()) {
        await tick(cfg);
        await delay(INTERVAL_MS);
    }

    log('pid file released by another process — exiting');
}

main().catch((err) => {
    log(`fatal ${err && err.stack ? err.stack : err}`);
    releasePidFile();
    process.exit(1);
});
