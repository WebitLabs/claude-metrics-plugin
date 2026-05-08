import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig } from './config.mjs';
import {
    enqueue,
    readQueue,
    writeQueue,
    nextDelayMs,
    maxAttempts,
    logError,
    recordSuccess,
} from './queue.mjs';

const REQUEST_TIMEOUT_MS = 3000;

async function postOnce(url, body, token) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        const res = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        let json = null;
        try {
            json = await res.json();
        } catch {
            // ignore
        }
        return { status: res.status, body: json };
    } finally {
        clearTimeout(timer);
    }
}

export async function sendEvent(endpoint, body) {
    const cfg = loadConfig();
    if (cfg.disabled || !cfg.apiUrl) {
        return { skipped: true };
    }

    const url = `${cfg.apiUrl}/${endpoint}`;
    try {
        const res = await postOnce(url, body, cfg.apiToken);
        if (res.status >= 200 && res.status < 300) {
            recordSuccess();
            return { ok: true, body: res.body };
        }
        if (res.status === 401 || res.status === 403) {
            logError(`${res.status} auth error from ${endpoint}: ${JSON.stringify(res.body)}`);
            return { ok: false, dropped: true };
        }
        if (res.status === 422) {
            logError(`422 validation error from ${endpoint}: ${JSON.stringify(res.body)}`);
            return { ok: false, dropped: true };
        }
        enqueue({ endpoint, body });
        return { ok: false, queued: true };
    } catch (err) {
        enqueue({ endpoint, body });
        return { ok: false, queued: true, error: String(err && err.message ? err.message : err) };
    }
}

export async function flushQueue() {
    const cfg = loadConfig();
    if (cfg.disabled || !cfg.apiUrl) {
        return { flushed: 0 };
    }
    const queue = readQueue();
    const remaining = [];
    let flushed = 0;
    const now = Date.now();

    for (const item of queue) {
        if (item.next_retry_at && item.next_retry_at > now) {
            remaining.push(item);
            continue;
        }
        try {
            const res = await postOnce(`${cfg.apiUrl}/${item.endpoint}`, item.body, cfg.apiToken);
            if (res.status >= 200 && res.status < 300) {
                flushed++;
                recordSuccess();
                continue;
            }
            if (res.status === 401 || res.status === 403) {
                logError(`${res.status} auth error dropped on retry: ${JSON.stringify(res.body)}`);
                continue;
            }
            if (res.status === 422) {
                logError(`422 dropped on retry: ${JSON.stringify(res.body)}`);
                continue;
            }
            const attempts = (item.attempts ?? 0) + 1;
            if (attempts >= maxAttempts()) {
                logError(`giving up on ${item.endpoint} after ${attempts} attempts (status ${res.status})`);
                continue;
            }
            remaining.push({
                ...item,
                attempts,
                next_retry_at: now + nextDelayMs(attempts),
            });
        } catch (err) {
            const attempts = (item.attempts ?? 0) + 1;
            if (attempts >= maxAttempts()) {
                logError(`giving up on ${item.endpoint} after ${attempts} attempts: ${err.message}`);
                continue;
            }
            remaining.push({
                ...item,
                attempts,
                next_retry_at: now + nextDelayMs(attempts),
            });
        }
        await delay(0);
    }
    writeQueue(remaining);
    return { flushed, queued: remaining.length };
}
