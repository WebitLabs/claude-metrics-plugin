import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const stateDir = join(homedir(), '.claude-metrics');
const sessionFile = join(stateDir, 'sessions.json');

function ensureDir() {
    if (!existsSync(stateDir)) {
        mkdirSync(stateDir, { recursive: true });
    }
}

function readSessions() {
    ensureDir();
    if (!existsSync(sessionFile)) {
        return {};
    }
    try {
        return JSON.parse(readFileSync(sessionFile, 'utf8'));
    } catch {
        return {};
    }
}

function writeSessions(state) {
    ensureDir();
    writeFileSync(sessionFile, JSON.stringify(state, null, 2));
}

export function uuid() {
    return randomUUID();
}

export function resolveSessionId(claudeSessionId) {
    if (claudeSessionId) {
        return claudeSessionId;
    }
    const state = readSessions();
    if (!state.__fallback) {
        state.__fallback = uuid();
        writeSessions(state);
    }
    return state.__fallback;
}

export function rememberTurn(sessionId, turnId) {
    const state = readSessions();
    state[sessionId] = { turn_id: turnId, ts: Date.now() };
    writeSessions(state);
}

export function recallTurn(sessionId) {
    const state = readSessions();
    const entry = state[sessionId];
    if (!entry) {
        return null;
    }
    return entry.turn_id ?? null;
}
