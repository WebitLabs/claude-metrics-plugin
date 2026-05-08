import { existsSync, readFileSync } from 'node:fs';
import { contextMaxFor } from './config.mjs';

export function readLatestAssistantUsage(transcriptPath) {
    if (!transcriptPath || !existsSync(transcriptPath)) {
        return null;
    }
    let raw;
    try {
        raw = readFileSync(transcriptPath, 'utf8');
    } catch {
        return null;
    }
    const lines = raw.split('\n').filter(Boolean);
    let latest = null;
    for (const line of lines) {
        let entry;
        try {
            entry = JSON.parse(line);
        } catch {
            continue;
        }
        if (entry.type !== 'assistant') {
            continue;
        }
        const usage = entry.message?.usage;
        if (!usage) {
            continue;
        }
        const total = (usage.input_tokens || 0)
            + (usage.cache_creation_input_tokens || 0)
            + (usage.cache_read_input_tokens || 0);
        latest = { total, model: entry.message?.model || null };
    }
    return latest;
}

export function computeContextSnapshot(transcriptPath, contextMaxOverride, reserveRatio = 0.20) {
    const usage = readLatestAssistantUsage(transcriptPath);
    if (!usage) {
        return { contextTokens: null, contextPercent: null };
    }
    let max = contextMaxFor(usage.model, contextMaxOverride);
    if (!Number.isFinite(contextMaxOverride) && usage.total > max) {
        max = 1000000;
    }
    const usable = Math.max(1, Math.round(max * (1 - reserveRatio)));
    const pct = Number(((usage.total / usable) * 100).toFixed(2));
    return { contextTokens: usage.total, contextPercent: Math.min(100, pct) };
}
