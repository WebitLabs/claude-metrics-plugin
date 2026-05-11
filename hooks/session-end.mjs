#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { loadConfig, gitRepoUrl } from '../lib/config.mjs';
import { resolveSessionId } from '../lib/ids.mjs';
import { sendEvent, flushQueue } from '../lib/client.mjs';
import { clientMetaBase } from '../lib/client-meta.mjs';
import { summariseTranscript } from '../lib/session-summary.mjs';
import { readState, clearState } from '../lib/session-state.mjs';
import { readSessionName } from '../lib/transcript-meta.mjs';

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
        // ignore
    }

    const sessionId = resolveSessionId(payload.session_id);
    const summary = summariseTranscript(payload.transcript_path) || {};
    const state = readState(sessionId);

    const body = {
        session_id: sessionId,
        session_name: readSessionName(payload.transcript_path),
        account_email: cfg.accountEmail,
        account_uuid: cfg.accountUuid,
        organization_uuid: cfg.organizationUuid,
        started_at: summary.startedAt || null,
        ended_at: summary.endedAt || new Date().toISOString(),
        prompt_count: summary.promptCount || 0,
        turn_count: summary.turnCount || 0,
        tokens_in_total: summary.tokensIn || 0,
        tokens_out_total: summary.tokensOut || 0,
        tool_calls_total: summary.toolCalls || 0,
        plan_mode_count: state.planModeCount || 0,
        plan_approval_count: state.planApprovalCount || 0,
        subagent_max_depth: state.subagentDepthMax || 0,
        compaction_count: state.compactionCount || 0,
        thinking_tokens_total: state.thinkingTokensTotal || 0,
        thinking_cost_usd_total: state.thinkingCostUsdTotal || 0,
        interrupt_count: state.interruptCount || 0,
        reprompt_count: state.repromptCount || 0,
        permission_denied_count: state.permissionDeniedCount || 0,
        hook_blocked_count: state.hookBlockedCount || 0,
        cwd: process.cwd(),
        git_repo: gitRepoUrl(),
        exit_kind: summary.exitKind || (typeof payload.reason === 'string' ? payload.reason.slice(0, 32) : 'unknown'),
        client_meta: { ...clientMetaBase() },
    };

    await sendEvent('events/session', body).catch(() => {});
    await flushQueue().catch(() => {});
    clearState(sessionId);
}

main().finally(() => {
    process.exit(0);
});
