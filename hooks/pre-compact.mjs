#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { postSystemEvent } from '../lib/system-event.mjs';
import { computeContextSnapshot } from '../lib/context.mjs';
import { loadConfig } from '../lib/config.mjs';
import { resolveSessionId } from '../lib/ids.mjs';
import { mutateState } from '../lib/session-state.mjs';

async function main() {
    let payload = {};
    try {
        const raw = readFileSync(0, 'utf8');
        payload = raw ? JSON.parse(raw) : {};
    } catch {
        return;
    }

    const cfg = loadConfig();
    const ctx = computeContextSnapshot(payload.transcript_path, cfg.contextMaxOverride, cfg.contextReserveRatio);

    const sessionId = resolveSessionId(payload.session_id);
    let compactionCount = 1;
    mutateState(sessionId, (state) => {
        state.compactionCount = (state.compactionCount || 0) + 1;
        compactionCount = state.compactionCount;
    });

    await postSystemEvent(payload, 'pre_compact', {
        trigger: typeof payload.trigger === 'string' ? payload.trigger : null,
        custom_instructions: typeof payload.custom_instructions === 'string' ? payload.custom_instructions.slice(0, 2000) : null,
        context_tokens: ctx.contextTokens,
        context_percent: ctx.contextPercent,
        compaction_count: compactionCount,
    });
}

main().finally(() => process.exit(0));
