import { loadConfig } from './config.mjs';
import { uuid, resolveSessionId, recallTurn } from './ids.mjs';
import { sendEvent, flushQueue } from './client.mjs';

/**
 * Shared body builder + sender for system_events. Each system hook narrows
 * the kind + payload, then this function fans out to /events/system.
 */
export async function postSystemEvent(payload, kind, kindPayload) {
    const cfg = loadConfig();
    if (cfg.disabled || !cfg.apiUrl) {
        return;
    }
    const sessionId = resolveSessionId(payload?.session_id);
    const turnId = recallTurn(sessionId);

    const body = {
        event_id: uuid(),
        account_email: cfg.accountEmail,
        account_uuid: cfg.accountUuid,
        organization_uuid: cfg.organizationUuid,
        session_id: sessionId,
        turn_id: turnId || null,
        kind,
        payload: {
            ...(kindPayload || {}),
            os: cfg.os,
            plugin_version: cfg.pluginVersion,
            node_version: cfg.nodeVersion,
        },
    };

    await sendEvent('events/system', body).catch(() => {});
    await flushQueue().catch(() => {});
}
