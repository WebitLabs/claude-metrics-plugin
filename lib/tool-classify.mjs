import { isAbsolute, relative, sep } from 'node:path';

const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const NETWORK_TOOLS = new Set(['WebFetch', 'WebSearch']);

const BASH_KIND_PATTERNS = [
    { kind: 'git', re: /^git(\s|$)/ },
    { kind: 'composer', re: /^composer(\s|$)/ },
    { kind: 'npm', re: /^(npm|npx|yarn|pnpm|bun)(\s|$)/ },
    { kind: 'php', re: /^php(\s|$)/ },
    { kind: 'test', re: /(^|[\s\/])(pest|phpunit|jest|vitest|mocha)(\s|$)/ },
    { kind: 'artisan', re: /^php\s+artisan(\s|$)/ },
    { kind: 'fs', re: /^(ls|cd|pwd|find|grep|cat|head|tail|mkdir|rm|cp|mv|chmod|touch)(\s|$)/ },
    { kind: 'net', re: /^(curl|wget|ping)(\s|$)/ },
    { kind: 'docker', re: /^docker(\s|$)/ },
    { kind: 'gh', re: /^gh(\s|$)/ },
];

export function classifyBash(command) {
    if (typeof command !== 'string') {
        return 'other';
    }
    const trimmed = command.trim();
    if (!trimmed) {
        return 'other';
    }
    for (const { kind, re } of BASH_KIND_PATTERNS) {
        if (re.test(trimmed)) {
            return kind;
        }
    }
    return 'other';
}

export function relativizePath(p, cwd) {
    if (typeof p !== 'string' || !p) {
        return null;
    }
    if (!isAbsolute(p) || !cwd) {
        return p;
    }
    const r = relative(cwd, p);
    if (!r) {
        return '.';
    }
    if (r.startsWith('..'+sep) || r === '..') {
        return p;
    }
    return r;
}

export function inferFilePath(toolName, toolInput, cwd) {
    if (!toolInput || typeof toolInput !== 'object') {
        return null;
    }
    if (!FILE_TOOLS.has(toolName)) {
        return null;
    }
    const raw = toolInput.file_path || toolInput.notebook_path || toolInput.path;
    return relativizePath(raw, cwd);
}

export function inferSubagentType(toolInput) {
    if (!toolInput || typeof toolInput !== 'object') {
        return null;
    }
    const t = toolInput.subagent_type;
    return typeof t === 'string' && t ? t.slice(0, 64) : null;
}

export function classifySuccess(toolResponse) {
    if (toolResponse == null) {
        return { success: true, errorClass: null };
    }
    if (typeof toolResponse !== 'object') {
        return { success: true, errorClass: null };
    }
    if (toolResponse.is_error === true || toolResponse.isError === true) {
        return { success: false, errorClass: pickErrorClass(toolResponse) };
    }
    if (toolResponse.interrupted === true) {
        return { success: false, errorClass: 'interrupted' };
    }
    if (typeof toolResponse.exit_code === 'number' && toolResponse.exit_code !== 0) {
        return { success: false, errorClass: 'exit_nonzero' };
    }
    return { success: true, errorClass: null };
}

function pickErrorClass(resp) {
    const msg = typeof resp.error === 'string'
        ? resp.error
        : (typeof resp.message === 'string' ? resp.message : null);
    if (!msg) {
        return 'error';
    }
    const lower = msg.toLowerCase();
    if (lower.includes('old_string') || lower.includes('not found in')) {
        return 'old_string_not_found';
    }
    if (lower.includes('permission denied')) {
        return 'permission_denied';
    }
    if (lower.includes('timed out') || lower.includes('timeout')) {
        return 'timeout';
    }
    if (lower.includes('not found') || lower.includes('enoent')) {
        return 'not_found';
    }
    return 'error';
}

export function bytesOf(value) {
    if (value == null) {
        return 0;
    }
    if (typeof value === 'string') {
        return Buffer.byteLength(value, 'utf8');
    }
    try {
        return Buffer.byteLength(JSON.stringify(value), 'utf8');
    } catch {
        return 0;
    }
}

export function isNetworkTool(toolName) {
    return NETWORK_TOOLS.has(toolName);
}

/**
 * Inspect tool_response for permission/hook block markers.
 *
 * @returns {{outcome: 'allowed'|'denied_user'|'blocked_hook', reason: string|null}}
 */
export function classifyPermission(toolResponse) {
    if (!toolResponse || typeof toolResponse !== 'object') {
        return { outcome: 'allowed', reason: null };
    }
    const msg = typeof toolResponse.error === 'string'
        ? toolResponse.error
        : (typeof toolResponse.message === 'string' ? toolResponse.message : '');
    const lower = msg.toLowerCase();

    if (lower.includes('blocked by hook') || lower.includes('hook blocked') || lower.includes('posttooluse hook')) {
        return { outcome: 'blocked_hook', reason: msg.slice(0, 128) };
    }
    if (lower.includes('user denied') || lower.includes('denied by user') || lower.includes('permission denied') || lower.includes('not allowed')) {
        return { outcome: 'denied_user', reason: msg.slice(0, 128) };
    }
    return { outcome: 'allowed', reason: null };
}
