/**
 * Per-session mutable state for behavior signals.
 *
 * Stored as JSON under ~/.claude-metrics/session-state/{sessionId}.json.
 * Hooks fire serially per session, so file-level locking isn't needed.
 *
 * Tracks:
 *   lastAssistantFinishMs     timestamp of most recent Stop hook
 *   planModeCount             # of ExitPlanMode tool invocations
 *   planApprovalCount         # of those approved (success=true)
 *   subagentDepthMax          deepest Agent nesting observed
 *   compactionCount           # of PreCompact firings
 *   thinkingTokensTotal       Σ thinking tokens across executions
 *   thinkingCostUsdTotal      Σ thinking cost
 *   interruptCount            # of executions ending with user_interrupt
 *   repromptCount             # of prompts where gap < threshold
 *   permissionDeniedCount     PreToolUse blocks / user denies
 *   hookBlockedCount          PostToolUse hook blocks
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const stateDir = join(homedir(), '.claude-metrics', 'session-state');

function ensureDir() {
    if (!existsSync(stateDir)) {
        mkdirSync(stateDir, { recursive: true });
    }
}

function fileFor(sessionId) {
    const safe = String(sessionId || 'fallback').replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(stateDir, `${safe}.json`);
}

const DEFAULT_STATE = {
    lastAssistantFinishMs: null,
    planModeCount: 0,
    planApprovalCount: 0,
    subagentDepthMax: 0,
    compactionCount: 0,
    thinkingTokensTotal: 0,
    thinkingCostUsdTotal: 0,
    interruptCount: 0,
    repromptCount: 0,
    permissionDeniedCount: 0,
    hookBlockedCount: 0,
    activeAgents: [],
};

export function readState(sessionId) {
    const file = fileFor(sessionId);
    if (!existsSync(file)) {
        return { ...DEFAULT_STATE };
    }
    try {
        const data = JSON.parse(readFileSync(file, 'utf8'));
        return { ...DEFAULT_STATE, ...data };
    } catch {
        return { ...DEFAULT_STATE };
    }
}

export function writeState(sessionId, state) {
    ensureDir();
    writeFileSync(fileFor(sessionId), JSON.stringify(state));
}

export function mutateState(sessionId, fn) {
    const state = readState(sessionId);
    fn(state);
    writeState(sessionId, state);
    return state;
}

export function clearState(sessionId) {
    const file = fileFor(sessionId);
    try { unlinkSync(file); } catch {}
}
