import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

let tmp;
beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cm-hc-'));
});

function startServer() {
    const hits = [];
    const server = createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => {
            body += chunk;
        });
        req.on('end', () => {
            try {
                hits.push({ url: req.url, body: body ? JSON.parse(body) : null });
            } catch {
                hits.push({ url: req.url, body });
            }
            res.writeHead(202, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ id: hits.length, received_at: new Date().toISOString() }));
        });
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            resolve({ server, port, hits });
        });
    });
}

test('daemon posts to /health-checks at the configured interval', async () => {
    const { server, port, hits } = await startServer();
    const daemonPath = new URL('../lib/healthcheck-daemon.mjs', import.meta.url).pathname;

    const child = spawn(process.execPath, [daemonPath], {
        env: {
            ...process.env,
            HOME: tmp,
            CLAUDE_METRICS_API_URL: `http://127.0.0.1:${port}/api/v1`,
            CLAUDE_METRICS_ACCOUNT_EMAIL: 'daemon-test@example.com',
            CLAUDE_METRICS_HEALTHCHECK_INTERVAL_MS: '120',
            CLAUDE_METRICS_DISABLED: '0',
        },
        stdio: 'ignore',
    });

    await delay(500);

    child.kill('SIGTERM');
    await new Promise((resolve) => child.on('exit', resolve));
    server.close();

    assert.ok(hits.length >= 2, `expected >=2 hits, got ${hits.length}`);
    for (const hit of hits) {
        assert.equal(hit.url, '/api/v1/health-checks');
        assert.equal(hit.body.account_email, 'daemon-test@example.com');
        assert.ok(hit.body.client_meta);
        assert.ok(hit.body.client_meta.sent_at);
    }
});

test('SessionStart hook spawns daemon and writes PID file', async () => {
    const { server, port } = await startServer();
    const hookPath = new URL('../hooks/session-start.mjs', import.meta.url).pathname;

    const child = spawn(process.execPath, [hookPath], {
        env: {
            ...process.env,
            HOME: tmp,
            CLAUDE_METRICS_API_URL: `http://127.0.0.1:${port}/api/v1`,
            CLAUDE_METRICS_ACCOUNT_EMAIL: 'hook-test@example.com',
            CLAUDE_METRICS_HEALTHCHECK_INTERVAL_MS: '120',
        },
        stdio: 'ignore',
    });
    await new Promise((resolve) => child.on('exit', resolve));

    await delay(400);

    const pidFile = join(tmp, '.claude-metrics', 'healthcheck.pid');
    assert.ok(existsSync(pidFile), 'pid file should exist after SessionStart');

    const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
    assert.ok(pid > 0);

    try {
        process.kill(pid, 'SIGTERM');
    } catch {
        // ignore
    }
    await delay(100);
    server.close();
});
