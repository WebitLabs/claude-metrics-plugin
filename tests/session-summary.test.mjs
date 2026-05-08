import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { summariseTranscript } from '../lib/session-summary.mjs';

function writeTranscript(entries) {
    const dir = mkdtempSync(join(tmpdir(), 'cm-sum-'));
    const path = join(dir, 'transcript.jsonl');
    writeFileSync(path, entries.map(e => JSON.stringify(e)).join('\n'));
    return path;
}

test('summariseTranscript returns null on missing path', () => {
    assert.equal(summariseTranscript(null), null);
    assert.equal(summariseTranscript('/no/such/file.jsonl'), null);
});

test('counts prompts, tool_use, and end_turn turns', () => {
    const path = writeTranscript([
        { type: 'user', message: { content: 'hello' }, timestamp: '2026-04-29T10:00:00Z' },
        {
            type: 'assistant',
            message: {
                content: [{ type: 'tool_use', name: 'Read', input: {} }],
                usage: { input_tokens: 50, output_tokens: 20 },
                stop_reason: 'tool_use',
            },
            timestamp: '2026-04-29T10:00:01Z',
        },
        { type: 'user', message: { content: [{ type: 'tool_result' }] }, timestamp: '2026-04-29T10:00:02Z' },
        {
            type: 'assistant',
            message: {
                content: [{ type: 'text', text: 'done' }],
                usage: { input_tokens: 10, output_tokens: 5 },
                stop_reason: 'end_turn',
            },
            timestamp: '2026-04-29T10:00:03Z',
        },
        { type: 'user', message: { content: 'follow up' }, timestamp: '2026-04-29T10:01:00Z' },
        {
            type: 'assistant',
            message: {
                content: [{ type: 'text', text: 'sure' }],
                usage: { input_tokens: 30, output_tokens: 8 },
                stop_reason: 'end_turn',
            },
            timestamp: '2026-04-29T10:01:05Z',
        },
    ]);

    const s = summariseTranscript(path);
    assert.equal(s.promptCount, 2);
    assert.equal(s.turnCount, 2);
    assert.equal(s.toolCalls, 1);
    assert.equal(s.tokensIn, 90);
    assert.equal(s.tokensOut, 33);
    assert.equal(s.exitKind, 'end_turn');
    assert.equal(s.startedAt, '2026-04-29T10:00:00.000Z');
    assert.equal(s.endedAt, '2026-04-29T10:01:05.000Z');
});

test('skips tool_result user entries when counting prompts', () => {
    const path = writeTranscript([
        { type: 'user', message: { content: [{ type: 'tool_result' }] }, timestamp: '2026-04-29T10:00:00Z' },
        { type: 'user', message: { content: [{ type: 'tool_result' }] }, timestamp: '2026-04-29T10:00:01Z' },
    ]);

    const s = summariseTranscript(path);
    assert.equal(s.promptCount, 0);
});

test('maps unknown stop_reason to unknown', () => {
    const path = writeTranscript([
        { type: 'user', message: { content: 'q' }, timestamp: '2026-04-29T10:00:00Z' },
        {
            type: 'assistant',
            message: {
                content: [{ type: 'text', text: 'a' }],
                usage: { input_tokens: 1, output_tokens: 1 },
                stop_reason: 'tool_use',
            },
            timestamp: '2026-04-29T10:00:01Z',
        },
    ]);

    const s = summariseTranscript(path);
    assert.equal(s.exitKind, 'in_flight');
});

test('sums cache_creation and cache_read into tokens_in', () => {
    const path = writeTranscript([
        { type: 'user', message: { content: 'q' }, timestamp: '2026-04-29T10:00:00Z' },
        {
            type: 'assistant',
            message: {
                content: [{ type: 'text', text: 'a' }],
                usage: {
                    input_tokens: 100,
                    cache_creation_input_tokens: 50,
                    cache_read_input_tokens: 200,
                    output_tokens: 25,
                },
                stop_reason: 'end_turn',
            },
            timestamp: '2026-04-29T10:00:01Z',
        },
    ]);

    const s = summariseTranscript(path);
    assert.equal(s.tokensIn, 350);
    assert.equal(s.tokensOut, 25);
});
