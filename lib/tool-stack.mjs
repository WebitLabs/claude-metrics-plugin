/**
 * Tiny per-session stack of pending tool calls.
 *
 * PreToolUse pushes { tool, ts_ms }; PostToolUse pops the most-recent
 * matching tool_name. Stored as JSON files per session under
 * ~/.claude-metrics/tool-stack/{sessionId}.json.
 *
 * Hooks fire serially per session, so file-level locking isn't needed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const stateDir = join(homedir(), '.claude-metrics', 'tool-stack');

function ensureDir() {
    if (!existsSync(stateDir)) {
        mkdirSync(stateDir, { recursive: true });
    }
}

function fileFor(sessionId) {
    const safe = String(sessionId || 'fallback').replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(stateDir, `${safe}.json`);
}

function readStack(sessionId) {
    const file = fileFor(sessionId);
    if (!existsSync(file)) {
        return [];
    }
    try {
        const data = JSON.parse(readFileSync(file, 'utf8'));
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

function writeStack(sessionId, stack) {
    ensureDir();
    const file = fileFor(sessionId);
    if (stack.length === 0) {
        try { unlinkSync(file); } catch {}
        return;
    }
    writeFileSync(file, JSON.stringify(stack));
}

export function pushPending(sessionId, entry) {
    const stack = readStack(sessionId);
    stack.push(entry);
    if (stack.length > 64) {
        stack.shift();
    }
    writeStack(sessionId, stack);
}

export function popPending(sessionId, toolName) {
    const stack = readStack(sessionId);
    for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i] && stack[i].tool === toolName) {
            const [hit] = stack.splice(i, 1);
            writeStack(sessionId, stack);
            return hit;
        }
    }
    return null;
}

export function clearStack(sessionId) {
    writeStack(sessionId, []);
}
