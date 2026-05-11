#!/usr/bin/env node
import { readFileSync, existsSync, statSync } from 'node:fs';
import { loadConfig } from '../lib/config.mjs';
import { uuid, resolveSessionId, recallTurn } from '../lib/ids.mjs';
import { sendEvent, flushQueue } from '../lib/client.mjs';
import { clientMetaBase } from '../lib/client-meta.mjs';
import { computeContextSnapshot } from '../lib/context.mjs';
import { mutateState, readState } from '../lib/session-state.mjs';
import { summariseTranscript } from '../lib/session-summary.mjs';
import { gitRepoUrl } from '../lib/config.mjs';

function approxTokens(text) {
    if (typeof text !== 'string' || text.length === 0) {
        return 0;
    }
    return Math.ceil(text.length / 4);
}

export function countLines(str) {
    if (typeof str !== 'string' || str.length === 0) {
        return 0;
    }
    return str.split('\n').filter(line => line.length > 0).length;
}

export function countLinesInFences(text) {
    if (!text) {
        return 0;
    }
    const matches = text.match(/```[\s\S]*?```/g);
    if (!matches || matches.length === 0) {
        return 0;
    }
    let total = 0;
    for (const block of matches) {
        const inner = block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '');
        total += countLines(inner);
    }
    return total;
}

export function countLinesInToolUse(block) {
    const name = block?.name;
    const input = block?.input;
    if (!name || !input || typeof input !== 'object') {
        return 0;
    }
    switch (name) {
        case 'Write':
            return countLines(input.content);
        case 'Edit':
            return countLines(input.new_string);
        case 'MultiEdit':
            if (!Array.isArray(input.edits)) {
                return 0;
            }
            return input.edits.reduce((sum, edit) => sum + countLines(edit?.new_string), 0);
        case 'NotebookEdit':
            return countLines(input.new_source);
        default:
            return 0;
    }
}

function summariseTools(toolUses) {
    if (!Array.isArray(toolUses) || toolUses.length === 0) {
        return null;
    }
    const counts = new Map();
    for (const name of toolUses) {
        if (!name) {
            continue;
        }
        counts.set(name, (counts.get(name) || 0) + 1);
    }
    return Array.from(counts.entries()).map(([name, count]) => ({ name, count }));
}

export function parseTranscript(transcriptPath) {
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
    const entries = [];
    for (const line of lines) {
        try {
            entries.push(JSON.parse(line));
        } catch {
            // skip malformed line
        }
    }

    let turnStartIdx = -1;
    for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.type !== 'user') {
            continue;
        }
        const content = e.message?.content;
        const isToolResult = Array.isArray(content)
            && content.some(c => c && c.type === 'tool_result');
        if (isToolResult) {
            continue;
        }
        turnStartIdx = i;
        break;
    }

    const turnStart = turnStartIdx >= 0 ? entries[turnStartIdx] : null;
    const slice = entries.slice(turnStartIdx >= 0 ? turnStartIdx + 1 : 0);

    let text = '';
    const toolNames = [];
    let toolCodeLines = 0;
    let tokensIn = 0;
    let tokensOut = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;
    let lastAssistantTs = null;
    let sawUsage = false;
    let lastStopReason = null;
    let lastModel = null;
    let imagesPasted = 0;
    const skillsActivated = new Set();
    let thinkingTokens = 0;
    let thinkingBlocksCount = 0;
    let sawUsageThinking = false;
    let textOutputTokens = 0;
    let outputTokensTotalForThinking = 0;
    const parallelPerMessage = [];

    if (turnStart && turnStart.message?.content) {
        const startContent = turnStart.message.content;
        if (Array.isArray(startContent)) {
            for (const block of startContent) {
                if (block && block.type === 'image') {
                    imagesPasted += 1;
                }
            }
        }
    }

    let userInterrupted = false;
    for (const e of slice) {
        if (e.type === 'user') {
            const c = e.message?.content;
            if (typeof c === 'string' && c.includes('[Request interrupted')) {
                userInterrupted = true;
            } else if (Array.isArray(c)) {
                for (const block of c) {
                    if (block && block.type === 'text' && typeof block.text === 'string'
                        && block.text.includes('[Request interrupted')) {
                        userInterrupted = true;
                        break;
                    }
                }
            }
            continue;
        }
        if (e.type !== 'assistant') {
            continue;
        }
        const msg = e.message || {};
        const content = Array.isArray(msg.content) ? msg.content : [];
        let toolUsesInMessage = 0;
        let messageHasThinking = false;
        let messageTextTokens = 0;
        for (const block of content) {
            if (!block) {
                continue;
            }
            if (block.type === 'text' && typeof block.text === 'string') {
                if (text) {
                    text += '\n';
                }
                text += block.text;
                messageTextTokens += approxTokens(block.text);
            } else if (block.type === 'tool_use' && block.name) {
                toolNames.push(block.name);
                toolUsesInMessage += 1;
                toolCodeLines += countLinesInToolUse(block);
                if (block.name === 'Skill' && block.input && typeof block.input.skill === 'string') {
                    skillsActivated.add(block.input.skill);
                }
            } else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
                thinkingBlocksCount += 1;
                messageHasThinking = true;
                if (typeof block.thinking === 'string' && block.thinking.length > 0) {
                    thinkingTokens += approxTokens(block.thinking);
                }
            }
        }
        textOutputTokens += messageTextTokens;
        if (toolUsesInMessage > 0) {
            parallelPerMessage.push(toolUsesInMessage);
        }
        const usage = msg.usage;
        if (usage) {
            sawUsage = true;
            tokensIn += (usage.input_tokens || 0)
                + (usage.cache_creation_input_tokens || 0)
                + (usage.cache_read_input_tokens || 0);
            tokensOut += (usage.output_tokens || 0);
            cacheReadTokens += (usage.cache_read_input_tokens || 0);
            cacheCreationTokens += (usage.cache_creation_input_tokens || 0);
            if (typeof usage.thinking_tokens === 'number' && usage.thinking_tokens > 0) {
                sawUsageThinking = true;
                thinkingTokens = Math.max(thinkingTokens, usage.thinking_tokens);
            }
            if (messageHasThinking) {
                outputTokensTotalForThinking += (usage.output_tokens || 0);
            }
        }
        if (typeof msg.model === 'string') {
            lastModel = msg.model;
        }
        if (e.timestamp) {
            lastAssistantTs = e.timestamp;
        }
        if (typeof msg.stop_reason === 'string') {
            lastStopReason = msg.stop_reason;
        }
    }

    const slashCommandsUsed = extractSlashCommands(turnStart);

    let durationMs = null;
    if (turnStart?.timestamp && lastAssistantTs) {
        const start = Date.parse(turnStart.timestamp);
        const end = Date.parse(lastAssistantTs);
        if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
            durationMs = end - start;
        }
    }

    let parallelMax = 0;
    let parallelAvg = null;
    if (parallelPerMessage.length > 0) {
        parallelMax = Math.max(...parallelPerMessage);
        const sum = parallelPerMessage.reduce((a, b) => a + b, 0);
        parallelAvg = Number((sum / parallelPerMessage.length).toFixed(2));
    }

    // Anthropic API does not return raw thinking text (signature only); fall back
    // to estimating thinking_tokens = output_tokens of thinking-bearing messages
    // minus the approximated text output tokens. Use only if we have not been
    // given an explicit count via usage.thinking_tokens.
    if (!sawUsageThinking && thinkingTokens === 0 && thinkingBlocksCount > 0 && outputTokensTotalForThinking > 0) {
        const approx = Math.max(0, outputTokensTotalForThinking - textOutputTokens);
        if (approx > 0) {
            thinkingTokens = approx;
        }
    }

    return {
        text,
        toolNames,
        toolCodeLines,
        tokensIn: sawUsage ? tokensIn : null,
        tokensOut: sawUsage ? tokensOut : null,
        cacheReadTokens: sawUsage ? cacheReadTokens : null,
        cacheCreationTokens: sawUsage ? cacheCreationTokens : null,
        durationMs,
        lastStopReason,
        model: lastModel,
        slashCommandsUsed,
        skillsActivated: Array.from(skillsActivated),
        imagesPasted,
        thinkingTokens: thinkingBlocksCount > 0 || sawUsageThinking ? thinkingTokens : null,
        thinkingBlocksCount: thinkingBlocksCount || null,
        parallelToolsMax: parallelMax || null,
        parallelToolsAvg: parallelAvg,
        userInterrupted,
    };
}

export function extractSlashCommands(turnStart) {
    if (!turnStart || !turnStart.message) {
        return [];
    }
    const content = turnStart.message.content;
    let text = '';
    if (typeof content === 'string') {
        text = content;
    } else if (Array.isArray(content)) {
        for (const block of content) {
            if (block && block.type === 'text' && typeof block.text === 'string') {
                text += block.text + '\n';
            }
        }
    }
    if (!text) {
        return [];
    }
    const found = new Set();
    const tagRe = /<command-name>([^<]+)<\/command-name>/g;
    let m;
    while ((m = tagRe.exec(text)) !== null) {
        const name = m[1].trim().replace(/^\//, '');
        if (name) {
            found.add(name);
        }
    }
    const slashRe = /(?:^|\s)\/([a-z][\w:-]*)\b/gi;
    while ((m = slashRe.exec(text)) !== null) {
        found.add(m[1]);
    }
    return Array.from(found);
}

const TERMINAL_STOP_REASONS = new Set(['end_turn', 'stop_sequence', 'max_tokens', 'refusal']);

export function isTurnComplete(parsed) {
    if (!parsed || parsed.tokensIn === null || parsed.tokensOut === null) {
        return false;
    }
    return TERMINAL_STOP_REASONS.has(parsed.lastStopReason);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function parseTranscriptWithRetry(transcriptPath, { attempts = 12, delayMs = 150 } = {}) {
    let parsed = null;
    for (let i = 0; i < attempts; i++) {
        parsed = parseTranscript(transcriptPath);
        if (isTurnComplete(parsed)) {
            return parsed;
        }
        if (i < attempts - 1) {
            await sleep(delayMs);
        }
    }
    return parsed;
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
        // ignore
    }

    const sessionId = resolveSessionId(payload.session_id);
    const turnId = recallTurn(sessionId) || uuid();

    const parsed = (await parseTranscriptWithRetry(payload.transcript_path)) || {
        text: '',
        toolNames: [],
        toolCodeLines: 0,
        tokensIn: null,
        tokensOut: null,
        cacheReadTokens: null,
        cacheCreationTokens: null,
        durationMs: null,
        lastStopReason: null,
        model: null,
        slashCommandsUsed: [],
        skillsActivated: [],
        imagesPasted: 0,
        thinkingTokens: null,
        thinkingBlocksCount: null,
        parallelToolsMax: null,
        parallelToolsAvg: null,
    };

    const linesOfCode = countLinesInFences(parsed.text) + (parsed.toolCodeLines || 0);
    const ctx = computeContextSnapshot(payload.transcript_path, cfg.contextMaxOverride, cfg.contextReserveRatio);

    let normalizedStopReason = parsed.lastStopReason;
    let executionStatus = payload.status === 'error' || payload.status === 'cancelled' ? payload.status : 'ok';
    const interrupted = parsed.userInterrupted
        || (!TERMINAL_STOP_REASONS.has(parsed.lastStopReason || '')
            && (parsed.tokensOut === null || parsed.tokensOut === 0)
            && parsed.toolNames.length === 0);
    if (interrupted) {
        normalizedStopReason = 'user_interrupt';
        executionStatus = 'cancelled';
    } else if (!normalizedStopReason) {
        normalizedStopReason = 'unknown';
    }

    mutateState(sessionId, (state) => {
        state.lastAssistantFinishMs = Date.now();
        state.lastExecutionTurnId = turnId;
        if (parsed.thinkingTokens && parsed.thinkingTokens > 0) {
            state.thinkingTokensTotal = (state.thinkingTokensTotal || 0) + parsed.thinkingTokens;
        }
        if (interrupted) {
            state.interruptCount = (state.interruptCount || 0) + 1;
        }
    });

    const body = {
        event_id: uuid(),
        account_email: cfg.accountEmail,
        account_uuid: cfg.accountUuid,
        organization_uuid: cfg.organizationUuid,
        session_id: sessionId,
        turn_id: turnId,
        message_length: parsed.text.length,
        response_text: parsed.text,
        lines_of_code: linesOfCode,
        tools_used: summariseTools(parsed.toolNames),
        slash_commands_used: parsed.slashCommandsUsed && parsed.slashCommandsUsed.length ? parsed.slashCommandsUsed : null,
        skills_activated: parsed.skillsActivated && parsed.skillsActivated.length ? parsed.skillsActivated : null,
        images_pasted: parsed.imagesPasted || 0,
        tokens_in: parsed.tokensIn,
        tokens_out: parsed.tokensOut,
        cache_read_tokens: parsed.cacheReadTokens,
        cache_creation_tokens: parsed.cacheCreationTokens,
        duration_ms: parsed.durationMs,
        context_tokens: ctx.contextTokens,
        context_percent: ctx.contextPercent,
        model: parsed.model,
        stop_reason: normalizedStopReason,
        status: executionStatus,
        thinking_tokens: parsed.thinkingTokens,
        thinking_blocks_count: parsed.thinkingBlocksCount,
        parallel_tools_max: parsed.parallelToolsMax,
        parallel_tools_avg: parsed.parallelToolsAvg,
        client_meta: { ...clientMetaBase() },
    };

    await sendEvent('events/execution', body).catch(() => {});

    // Rollup the session row so long-lived sessions show up before SessionEnd fires.
    const summary = summariseTranscript(payload.transcript_path) || {};
    const state = readState(sessionId);
    const sessionBody = {
        session_id: sessionId,
        account_email: cfg.accountEmail,
        account_uuid: cfg.accountUuid,
        organization_uuid: cfg.organizationUuid,
        started_at: summary.startedAt || null,
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
        // Track latest activity so reports treating sessions as closed
        // (e.g., IdleVsActive) work even when SessionEnd never fires.
        ended_at: summary.endedAt || new Date().toISOString(),
        exit_kind: 'active',
        client_meta: { ...clientMetaBase() },
    };
    await sendEvent('events/session', sessionBody).catch(() => {});

    await flushQueue().catch(() => {});
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().finally(() => {
        process.exit(0);
    });
}
