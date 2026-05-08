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

    await postSystemEvent(payload, 'notification', {
        message: typeof payload.message === 'string' ? payload.message.slice(0, 1000) : null,
        title: typeof payload.title === 'string' ? payload.title.slice(0, 200) : null,
        notification_kind: typeof payload.notification_kind === 'string' ? payload.notification_kind : null,
    });
}

main().finally(() => process.exit(0));
