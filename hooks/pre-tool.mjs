#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { loadConfig } from '../lib/config.mjs';
import { resolveSessionId } from '../lib/ids.mjs';
import { pushPending } from '../lib/tool-stack.mjs';
import { mutateState } from '../lib/session-state.mjs';

function main() {
    const cfg = loadConfig();
    if (cfg.disabled || !cfg.apiUrl) {
        return;
    }

    let payload = {};
    try {
        const raw = readFileSync(0, 'utf8');
        payload = raw ? JSON.parse(raw) : {};
    } catch {
        return;
    }

    const sessionId = resolveSessionId(payload.session_id);
    const toolName = typeof payload.tool_name === 'string' ? payload.tool_name : null;
    if (!toolName) {
        return;
    }

    let subagentDepth = 0;
    mutateState(sessionId, (state) => {
        if (toolName === 'Agent') {
            const active = Array.isArray(state.activeAgents) ? state.activeAgents : [];
            active.push({ ts: Date.now() });
            state.activeAgents = active;
            subagentDepth = active.length;
            if (subagentDepth > (state.subagentDepthMax || 0)) {
                state.subagentDepthMax = subagentDepth;
            }
        }
        if (toolName === 'ExitPlanMode') {
            state.planModeCount = (state.planModeCount || 0) + 1;
        }
    });

    pushPending(sessionId, {
        tool: toolName,
        ts: Date.now(),
        cwd: payload.cwd || process.cwd(),
        subagentDepth: toolName === 'Agent' ? subagentDepth : null,
    });
}

try {
    main();
} catch {
    // never block tool execution
}

setTimeout(() => process.exit(0), 5).unref();
