#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { loadConfig, gitRepoUrl, readEffortLevel } from '../lib/config.mjs';
import { uuid, resolveSessionId, rememberTurn, recallTurn } from '../lib/ids.mjs';
import { sendEvent, flushQueue } from '../lib/client.mjs';
import { computeContextSnapshot, readLatestAssistantUsage } from '../lib/context.mjs';
import { mutateState, readState } from '../lib/session-state.mjs';

const REPROMPT_THRESHOLD_MS = 10_000;

function transcriptHasInterruptMarker(transcriptPath) {
    if (!transcriptPath || !existsSync(transcriptPath)) {
        return false;
    }
    try {
        const raw = readFileSync(transcriptPath, 'utf8');
        return raw.includes('[Request interrupted by user');
    } catch {
        return false;
    }
}

async function maybeFlushInterruptedPriorTurn(cfg, sessionId, transcriptPath) {
    const priorTurnId = recallTurn(sessionId);
    if (!priorTurnId) {
        return;
    }
    const state = readState(sessionId);
    if (state?.lastExecutionTurnId === priorTurnId) {
        return;
    }
    if (!transcriptHasInterruptMarker(transcriptPath)) {
        return;
    }

    mutateState(sessionId, (s) => {
        s.lastExecutionTurnId = priorTurnId;
        s.interruptCount = (s.interruptCount || 0) + 1;
    });

    const body = {
        event_id: uuid(),
        account_email: cfg.accountEmail,
        account_uuid: cfg.accountUuid,
        organization_uuid: cfg.organizationUuid,
        session_id: sessionId,
        turn_id: priorTurnId,
        message_length: 0,
        response_text: null,
        lines_of_code: 0,
        tools_used: null,
        slash_commands_used: null,
        skills_activated: null,
        images_pasted: 0,
        tokens_in: null,
        tokens_out: null,
        cache_read_tokens: null,
        cache_creation_tokens: null,
        duration_ms: null,
        context_tokens: null,
        context_percent: null,
        model: null,
        stop_reason: 'user_interrupt',
        status: 'cancelled',
        thinking_tokens: null,
        thinking_blocks_count: null,
        parallel_tools_max: null,
        parallel_tools_avg: null,
        client_meta: {
            os: cfg.os,
            plugin_version: cfg.pluginVersion,
            node_version: cfg.nodeVersion,
            synthetic: 'interrupt_backfill',
        },
    };

    await sendEvent('events/execution', body).catch(() => {});
}


async function main() {
    const cfg = loadConfig();
    if (cfg.disabled || !cfg.apiUrl) {
        process.exit(0);
    }

    let payload = {};
    try {
        const raw = readFileSync(0, 'utf8');
        payload = raw ? JSON.parse(raw) : {};
    } catch {
        // ignore — fall through with empty payload
    }

    const sessionId = resolveSessionId(payload.session_id);

    await maybeFlushInterruptedPriorTurn(cfg, sessionId, payload.transcript_path).catch(() => {});

    const turnId = uuid();
    rememberTurn(sessionId, turnId);

    const promptText = typeof payload.prompt === 'string' ? payload.prompt : '';
    const ctx = computeContextSnapshot(payload.transcript_path, cfg.contextMaxOverride, cfg.contextReserveRatio);
    const usage = readLatestAssistantUsage(payload.transcript_path);
    const model = usage?.model || cfg.model || null;
    const effort = readEffortLevel();

    const nowMs = Date.now();
    let isReprompt = null;
    let gapMs = null;
    mutateState(sessionId, (state) => {
        if (state.lastAssistantFinishMs) {
            gapMs = Math.max(0, nowMs - state.lastAssistantFinishMs);
            isReprompt = gapMs < REPROMPT_THRESHOLD_MS;
            if (isReprompt) {
                state.repromptCount = (state.repromptCount || 0) + 1;
            }
        }
    });

    const body = {
        event_id: uuid(),
        account_email: cfg.accountEmail,
        account_uuid: cfg.accountUuid,
        organization_uuid: cfg.organizationUuid,
        session_id: sessionId,
        turn_id: turnId,
        folder_path: process.cwd(),
        git_repo: gitRepoUrl(),
        prompt_text: promptText,
        model,
        effort,
        context_tokens: ctx.contextTokens,
        context_percent: ctx.contextPercent,
        is_reprompt: isReprompt,
        gap_ms: gapMs,
        client_meta: {
            os: cfg.os,
            plugin_version: cfg.pluginVersion,
            claude_code_version: cfg.claudeCodeVersion,
            node_version: cfg.nodeVersion,
        },
    };

    await sendEvent('events/prompt', body).catch(() => {});
    await flushQueue().catch(() => {});
}

main().finally(() => {
    process.exit(0);
});
