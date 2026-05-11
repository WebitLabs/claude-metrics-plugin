#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { loadConfig } from '../lib/config.mjs';
import { uuid, resolveSessionId, recallTurn } from '../lib/ids.mjs';
import { sendEvent, flushQueue } from '../lib/client.mjs';
import { clientMetaBase } from '../lib/client-meta.mjs';
import { popPending } from '../lib/tool-stack.mjs';
import {
    classifyBash,
    classifySuccess,
    classifyPermission,
    inferFilePath,
    inferSubagentType,
    bytesOf,
} from '../lib/tool-classify.mjs';
import { mutateState } from '../lib/session-state.mjs';
import { readLatestPermissionMode } from '../lib/permission-mode.mjs';

function bashCommand(toolInput) {
    if (!toolInput || typeof toolInput !== 'object') {
        return null;
    }
    return typeof toolInput.command === 'string' ? toolInput.command : null;
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
        process.exit(0);
    }

    const toolName = typeof payload.tool_name === 'string' ? payload.tool_name : null;
    if (!toolName) {
        process.exit(0);
    }

    const sessionId = resolveSessionId(payload.session_id);
    const turnId = recallTurn(sessionId);
    const pending = popPending(sessionId, toolName);
    const now = Date.now();
    const durationMs = pending ? Math.max(0, now - pending.ts) : null;
    const cwd = pending?.cwd || payload.cwd || process.cwd();

    const toolInput = payload.tool_input;
    const toolResponse = payload.tool_response;
    const { success, errorClass } = classifySuccess(toolResponse);
    const { outcome: permissionOutcome, reason: hookBlockReason } = classifyPermission(toolResponse);

    const filePath = inferFilePath(toolName, toolInput, cwd);
    const subagentType = inferSubagentType(toolInput);
    const permissionMode = typeof payload.permission_mode === 'string' && payload.permission_mode
        ? payload.permission_mode.slice(0, 32)
        : readLatestPermissionMode(payload.transcript_path);

    mutateState(sessionId, (state) => {
        if (toolName === 'Agent') {
            const active = Array.isArray(state.activeAgents) ? state.activeAgents : [];
            active.pop();
            state.activeAgents = active;
        }
        if (toolName === 'ExitPlanMode' && success) {
            state.planApprovalCount = (state.planApprovalCount || 0) + 1;
        }
        if (permissionOutcome === 'denied_user') {
            state.permissionDeniedCount = (state.permissionDeniedCount || 0) + 1;
        }
        if (permissionOutcome === 'blocked_hook') {
            state.hookBlockedCount = (state.hookBlockedCount || 0) + 1;
        }
    });

    let bashCmd = null;
    let bashKind = null;
    if (toolName === 'Bash') {
        const cmd = bashCommand(toolInput);
        bashKind = classifyBash(cmd);
        if (process.env.CLAUDE_METRICS_BASH_ARGS === '1') {
            bashCmd = cmd ? cmd.slice(0, 8000) : null;
        }
    }

    const body = {
        event_id: uuid(),
        account_email: cfg.accountEmail,
        account_uuid: cfg.accountUuid,
        organization_uuid: cfg.organizationUuid,
        session_id: sessionId,
        turn_id: turnId || null,
        tool_name: toolName,
        success,
        duration_ms: durationMs,
        error_class: errorClass,
        file_path: filePath,
        bash_command_kind: bashKind,
        bash_command: bashCmd,
        input_bytes: bytesOf(toolInput),
        output_bytes: bytesOf(toolResponse),
        subagent_type: subagentType,
        subagent_depth: pending?.subagentDepth ?? null,
        permission_outcome: permissionOutcome,
        hook_block_reason: hookBlockReason,
        permission_mode: permissionMode,
        client_meta: { ...clientMetaBase() },
    };

    await sendEvent('events/tool', body).catch(() => {});
    await flushQueue().catch(() => {});
}

main().finally(() => {
    process.exit(0);
});
