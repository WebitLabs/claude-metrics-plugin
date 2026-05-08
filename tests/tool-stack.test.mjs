import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.HOME = mkdtempSync(join(tmpdir(), 'cm-stack-'));

const { pushPending, popPending, clearStack } = await import('../lib/tool-stack.mjs');

test('pop returns null when stack empty', () => {
    assert.equal(popPending('sess-empty', 'Read'), null);
});

test('push then pop matches by tool_name', () => {
    const sid = 'sess-1';
    pushPending(sid, { tool: 'Read', ts: 100, cwd: '/x' });
    pushPending(sid, { tool: 'Edit', ts: 200, cwd: '/x' });

    const popped = popPending(sid, 'Read');
    assert.equal(popped.tool, 'Read');
    assert.equal(popped.ts, 100);

    const popped2 = popPending(sid, 'Edit');
    assert.equal(popped2.ts, 200);

    assert.equal(popPending(sid, 'Read'), null);
});

test('LIFO order for repeated tool', () => {
    const sid = 'sess-2';
    pushPending(sid, { tool: 'Bash', ts: 1, cwd: '/x' });
    pushPending(sid, { tool: 'Bash', ts: 2, cwd: '/x' });

    assert.equal(popPending(sid, 'Bash').ts, 2);
    assert.equal(popPending(sid, 'Bash').ts, 1);
});

test('clearStack removes all pending', () => {
    const sid = 'sess-3';
    pushPending(sid, { tool: 'Read', ts: 1, cwd: '/x' });
    clearStack(sid);
    assert.equal(popPending(sid, 'Read'), null);
});
