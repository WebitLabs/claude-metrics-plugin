import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    countLines,
    countLinesInFences,
    countLinesInToolUse,
    parseTranscript,
    isTurnComplete,
    extractSlashCommands,
} from '../hooks/stop.mjs';

test('countLines ignores blank lines', () => {
    assert.equal(countLines('a\n\nb\n'), 2);
    assert.equal(countLines(''), 0);
    assert.equal(countLines(null), 0);
});

test('countLinesInFences sums lines across fenced blocks', () => {
    const text = 'intro\n```js\nconst a = 1;\nconst b = 2;\n```\nmid\n```\nx\n```';
    assert.equal(countLinesInFences(text), 3);
});

test('countLinesInFences returns 0 when no fences', () => {
    assert.equal(countLinesInFences('just prose, no code'), 0);
});

test('countLinesInToolUse counts Write content', () => {
    const block = { type: 'tool_use', name: 'Write', input: { content: 'a\nb\nc' } };
    assert.equal(countLinesInToolUse(block), 3);
});

test('countLinesInToolUse counts Edit new_string', () => {
    const block = { type: 'tool_use', name: 'Edit', input: { new_string: 'a\nb' } };
    assert.equal(countLinesInToolUse(block), 2);
});

test('countLinesInToolUse sums MultiEdit edits', () => {
    const block = {
        type: 'tool_use',
        name: 'MultiEdit',
        input: { edits: [{ new_string: 'a\nb' }, { new_string: 'c\nd\ne' }] },
    };
    assert.equal(countLinesInToolUse(block), 5);
});

test('countLinesInToolUse ignores read-only tools', () => {
    assert.equal(countLinesInToolUse({ type: 'tool_use', name: 'Read', input: { file_path: '/tmp/x' } }), 0);
    assert.equal(countLinesInToolUse({ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }), 0);
});

test('parseTranscript captures tool-mediated code lines', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cm-'));
    const path = join(tmp, 'transcript.jsonl');
    const lines = [
        { type: 'user', message: { content: 'do the thing' }, timestamp: '2026-04-29T08:00:00Z' },
        {
            type: 'assistant',
            message: {
                content: [
                    { type: 'tool_use', name: 'Write', input: { content: 'one\ntwo\nthree' } },
                    { type: 'tool_use', name: 'Edit', input: { new_string: 'a\nb' } },
                ],
                usage: { input_tokens: 100, output_tokens: 20 },
            },
            timestamp: '2026-04-29T08:00:05Z',
        },
    ];
    writeFileSync(path, lines.map(l => JSON.stringify(l)).join('\n'));

    const parsed = parseTranscript(path);
    assert.equal(parsed.toolCodeLines, 5);
    assert.deepEqual(parsed.toolNames, ['Write', 'Edit']);
    assert.equal(parsed.tokensOut, 20);
    assert.equal(parsed.durationMs, 5000);
});

test('parseTranscript records last assistant stop_reason', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cm-'));
    const path = join(tmp, 'transcript.jsonl');
    const lines = [
        { type: 'user', message: { content: 'q' }, timestamp: '2026-04-29T08:00:00Z' },
        {
            type: 'assistant',
            message: {
                content: [{ type: 'tool_use', name: 'Read', input: {} }],
                usage: { input_tokens: 10, output_tokens: 5 },
                stop_reason: 'tool_use',
            },
            timestamp: '2026-04-29T08:00:01Z',
        },
        { type: 'user', message: { content: [{ type: 'tool_result' }] }, timestamp: '2026-04-29T08:00:02Z' },
        {
            type: 'assistant',
            message: {
                content: [{ type: 'text', text: 'done' }],
                usage: { input_tokens: 20, output_tokens: 1 },
                stop_reason: 'end_turn',
            },
            timestamp: '2026-04-29T08:00:03Z',
        },
    ];
    writeFileSync(path, lines.map(l => JSON.stringify(l)).join('\n'));

    const parsed = parseTranscript(path);
    assert.equal(parsed.lastStopReason, 'end_turn');
    assert.equal(parsed.text, 'done');
    assert.equal(isTurnComplete(parsed), true);
});

test('isTurnComplete is false when last stop_reason is tool_use (in-flight)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cm-'));
    const path = join(tmp, 'transcript.jsonl');
    const lines = [
        { type: 'user', message: { content: 'q' }, timestamp: '2026-04-29T08:00:00Z' },
        {
            type: 'assistant',
            message: {
                content: [{ type: 'tool_use', name: 'Read', input: {} }],
                usage: { input_tokens: 10, output_tokens: 5 },
                stop_reason: 'tool_use',
            },
            timestamp: '2026-04-29T08:00:01Z',
        },
    ];
    writeFileSync(path, lines.map(l => JSON.stringify(l)).join('\n'));

    const parsed = parseTranscript(path);
    assert.equal(parsed.lastStopReason, 'tool_use');
    assert.equal(isTurnComplete(parsed), false);
});

test('isTurnComplete handles null/missing parsed', () => {
    assert.equal(isTurnComplete(null), false);
    assert.equal(isTurnComplete({ tokensIn: null, tokensOut: null, lastStopReason: 'end_turn' }), false);
});

test('extractSlashCommands captures <command-name> tags', () => {
    const turnStart = {
        message: {
            content: '<command-name>caveman</command-name>\nhi <command-name>/gsd:do</command-name>',
        },
    };
    const out = extractSlashCommands(turnStart);
    assert.deepEqual(out.sort(), ['caveman', 'gsd:do']);
});

test('extractSlashCommands captures inline /slash invocations', () => {
    const turnStart = {
        message: {
            content: 'please /loop and then /caveman:compress this',
        },
    };
    const out = extractSlashCommands(turnStart);
    assert.deepEqual(out.sort(), ['caveman:compress', 'loop']);
});

test('extractSlashCommands returns empty when none', () => {
    assert.deepEqual(extractSlashCommands(null), []);
    assert.deepEqual(extractSlashCommands({}), []);
    assert.deepEqual(extractSlashCommands({ message: { content: 'just text' } }), []);
});

test('parseTranscript extracts cache token splits and Skill activations', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cm-'));
    const path = join(tmp, 'transcript.jsonl');
    const lines = [
        { type: 'user', message: { content: 'q' }, timestamp: '2026-04-29T08:00:00Z' },
        {
            type: 'assistant',
            message: {
                content: [
                    { type: 'tool_use', name: 'Skill', input: { skill: 'laravel-best-practices' } },
                    { type: 'text', text: 'ok' },
                ],
                usage: {
                    input_tokens: 100,
                    cache_creation_input_tokens: 50,
                    cache_read_input_tokens: 200,
                    output_tokens: 25,
                },
                stop_reason: 'end_turn',
                model: 'claude-opus-4-7',
            },
            timestamp: '2026-04-29T08:00:01Z',
        },
    ];
    writeFileSync(path, lines.map(l => JSON.stringify(l)).join('\n'));

    const parsed = parseTranscript(path);
    assert.equal(parsed.cacheReadTokens, 200);
    assert.equal(parsed.cacheCreationTokens, 50);
    assert.equal(parsed.model, 'claude-opus-4-7');
    assert.deepEqual(parsed.skillsActivated, ['laravel-best-practices']);
});
