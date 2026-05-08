import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmp;
beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cm-'));
    process.env.HOME = tmp;
});

async function freshClient() {
    const url = `../lib/client.mjs?t=${Math.random()}`;
    return await import(url);
}

async function freshQueue() {
    const url = `../lib/queue.mjs?t=${Math.random()}`;
    return await import(url);
}

async function freshConfig() {
    const url = `../lib/config.mjs?t=${Math.random()}`;
    return await import(url);
}

test('sendEvent enqueues on network error', async () => {
    process.env.CLAUDE_METRICS_API_URL = 'http://127.0.0.1:1';
    const original = global.fetch;
    global.fetch = async () => {
        throw new Error('network down');
    };

    const { sendEvent } = await freshClient();
    const result = await sendEvent('events/prompt', { event_id: 'x' });
    assert.equal(result.queued, true);

    const { readQueue } = await freshQueue();
    const queue = readQueue();
    assert.equal(queue.length, 1);
    assert.equal(queue[0].endpoint, 'events/prompt');

    global.fetch = original;
});

test('sendEvent records success and does not enqueue on 2xx', async () => {
    process.env.CLAUDE_METRICS_API_URL = 'http://example.test/api/v1';
    const original = global.fetch;
    global.fetch = async () => ({
        status: 202,
        json: async () => ({ stored: true }),
    });

    const { sendEvent } = await freshClient();
    const result = await sendEvent('events/prompt', { event_id: 'x' });
    assert.equal(result.ok, true);

    const { readQueue, readLastSend } = await freshQueue();
    assert.equal(readQueue().length, 0);
    assert.notEqual(readLastSend(), null);

    global.fetch = original;
});

test('sendEvent drops payload on 422', async () => {
    process.env.CLAUDE_METRICS_API_URL = 'http://example.test/api/v1';
    const original = global.fetch;
    global.fetch = async () => ({
        status: 422,
        json: async () => ({ errors: { event_id: ['bad'] } }),
    });

    const { sendEvent } = await freshClient();
    const result = await sendEvent('events/prompt', { event_id: 'x' });
    assert.equal(result.dropped, true);

    const { readQueue, readErrors } = await freshQueue();
    assert.equal(readQueue().length, 0);
    assert.ok(readErrors(1).length === 1);

    global.fetch = original;
});

test('flushQueue gives up after MAX_ATTEMPTS', async () => {
    process.env.CLAUDE_METRICS_API_URL = 'http://example.test/api/v1';
    const original = global.fetch;
    global.fetch = async () => ({ status: 500, json: async () => ({}) });

    const { enqueue, readQueue } = await freshQueue();
    const { flushQueue } = await freshClient();

    enqueue({ endpoint: 'events/prompt', body: { event_id: 'x' } });
    let queue = readQueue();
    queue[0].attempts = 4;
    queue[0].next_retry_at = 0;
    const fs = await import('node:fs');
    const path = await import('node:path');
    fs.writeFileSync(path.join(process.env.HOME, '.claude-metrics', 'queue.json'), JSON.stringify(queue));

    await flushQueue();

    const after = readQueue();
    assert.equal(after.length, 0);

    global.fetch = original;
});

test('config falls back to git email when CLAUDE_METRICS_ACCOUNT_EMAIL absent', async () => {
    delete process.env.CLAUDE_METRICS_ACCOUNT_EMAIL;
    const { loadConfig } = await freshConfig();
    const cfg = loadConfig();
    assert.match(cfg.accountEmail, /@/);
});

test('config respects CLAUDE_METRICS_ACCOUNT_EMAIL override', async () => {
    process.env.CLAUDE_METRICS_ACCOUNT_EMAIL = 'overridden@example.com';
    const { loadConfig } = await freshConfig();
    const cfg = loadConfig();
    assert.equal(cfg.accountEmail, 'overridden@example.com');
    delete process.env.CLAUDE_METRICS_ACCOUNT_EMAIL;
});

test('config respects CLAUDE_METRICS_DISABLED', async () => {
    process.env.CLAUDE_METRICS_DISABLED = '1';
    const { loadConfig } = await freshConfig();
    const cfg = loadConfig();
    assert.equal(cfg.disabled, true);
    delete process.env.CLAUDE_METRICS_DISABLED;
});
