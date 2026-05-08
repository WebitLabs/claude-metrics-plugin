import { existsSync, readFileSync } from 'node:fs';

/**
 * Walk a session transcript and roll up totals: tokens, prompts, turns,
 * tool calls, lines of code, start/end timestamps and exit_kind.
 *
 * No external dependencies — pure transform from JSONL → summary.
 */
export function summariseTranscript(transcriptPath) {
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
    if (!lines.length) {
        return null;
    }

    let firstTs = null;
    let lastTs = null;
    let promptCount = 0;
    let turnCount = 0;
    let tokensIn = 0;
    let tokensOut = 0;
    let toolCalls = 0;
    let lastStopReason = null;

    for (const line of lines) {
        let entry;
        try {
            entry = JSON.parse(line);
        } catch {
            continue;
        }

        if (entry.timestamp) {
            const ts = Date.parse(entry.timestamp);
            if (Number.isFinite(ts)) {
                if (firstTs === null) {
                    firstTs = ts;
                }
                lastTs = ts;
            }
        }

        if (entry.type === 'user') {
            const content = entry.message?.content;
            const isToolResult = Array.isArray(content)
                && content.some(c => c && c.type === 'tool_result');
            if (!isToolResult) {
                promptCount += 1;
            }
        } else if (entry.type === 'assistant') {
            const msg = entry.message || {};
            const content = Array.isArray(msg.content) ? msg.content : [];
            for (const block of content) {
                if (block && block.type === 'tool_use') {
                    toolCalls += 1;
                }
            }
            const usage = msg.usage;
            if (usage) {
                tokensIn += (usage.input_tokens || 0)
                    + (usage.cache_creation_input_tokens || 0)
                    + (usage.cache_read_input_tokens || 0);
                tokensOut += (usage.output_tokens || 0);
            }
            if (typeof msg.stop_reason === 'string') {
                lastStopReason = msg.stop_reason;
                if (msg.stop_reason === 'end_turn') {
                    turnCount += 1;
                }
            }
        }
    }

    const exitKind = mapExitKind(lastStopReason);

    return {
        startedAt: firstTs ? new Date(firstTs).toISOString() : null,
        endedAt: lastTs ? new Date(lastTs).toISOString() : null,
        promptCount,
        turnCount,
        tokensIn,
        tokensOut,
        toolCalls,
        exitKind,
    };
}

function mapExitKind(stopReason) {
    if (!stopReason) {
        return 'unknown';
    }
    switch (stopReason) {
        case 'end_turn':
        case 'stop_sequence':
            return 'end_turn';
        case 'max_tokens':
            return 'max_tokens';
        case 'refusal':
            return 'refusal';
        case 'tool_use':
            return 'in_flight';
        default:
            return 'unknown';
    }
}
