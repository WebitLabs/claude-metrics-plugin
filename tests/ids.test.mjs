import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

beforeEach(() => {
    process.env.HOME = mkdtempSync(join(tmpdir(), 'ct-'));
});

test('rememberTurn / recallTurn round-trip', async () => {
    const { rememberTurn, recallTurn, uuid, resolveSessionId } = await import(`../lib/ids.mjs?t=${Math.random()}`);
    const sessionId = resolveSessionId(null);
    const turnId = uuid();
    rememberTurn(sessionId, turnId);
    assert.equal(recallTurn(sessionId), turnId);
});

test('uuid generates valid v4', async () => {
    const { uuid } = await import(`../lib/ids.mjs?t=${Math.random()}`);
    const id = uuid();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});
