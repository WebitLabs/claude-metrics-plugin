#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { postSystemEvent } from '../lib/system-event.mjs';

async function main() {
    let payload = {};
    try {
        const raw = readFileSync(0, 'utf8');
        payload = raw ? JSON.parse(raw) : {};
    } catch {
        return;
    }

    await postSystemEvent(payload, 'subagent_stop', {
        subagent_type: typeof payload.subagent_type === 'string' ? payload.subagent_type : null,
        agent_id: typeof payload.agent_id === 'string' ? payload.agent_id : null,
        reason: typeof payload.reason === 'string' ? payload.reason.slice(0, 200) : null,
    });
}

main().finally(() => process.exit(0));
