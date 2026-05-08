import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir, hostname, userInfo } from 'node:os';
import { join } from 'node:path';

let cached = null;

function readApiToken() {
    const fromEnv = (process.env.CLAUDE_METRICS_API_TOKEN || '').trim();
    if (fromEnv) {
        return fromEnv;
    }
    try {
        const raw = readFileSync(join(homedir(), '.claude-metrics', 'token'), 'utf8').trim();
        return raw || '';
    } catch {
        return '';
    }
}

function claudeOAuth() {
    try {
        const raw = readFileSync(join(homedir(), '.claude.json'), 'utf8');
        const data = JSON.parse(raw);
        const acc = data?.oauthAccount;
        if (!acc) {
            return null;
        }
        return {
            email: acc.emailAddress || null,
            accountUuid: acc.accountUuid || null,
            organizationUuid: acc.organizationUuid || null,
        };
    } catch {
        return null;
    }
}

function gitConfigEmail() {
    try {
        const out = execSync('git config --get user.email', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
        return out || null;
    } catch {
        return null;
    }
}

function fallbackEmail() {
    const user = userInfo().username || 'unknown';
    let host;
    try {
        host = hostname();
    } catch {
        host = 'localhost';
    }
    const domain = host.includes('.') ? host.split('.').slice(1).join('.') : host;
    return `${user}@${domain || 'localhost'}`;
}

export function loadConfig() {
    if (cached) {
        return cached;
    }
    const apiUrl = (process.env.CLAUDE_METRICS_API_URL || '').replace(/\/+$/, '');
    const apiToken = readApiToken();
    const disabled = process.env.CLAUDE_METRICS_DISABLED === '1';
    const oauth = claudeOAuth();
    const accountEmail =
        process.env.CLAUDE_METRICS_ACCOUNT_EMAIL ||
        oauth?.email ||
        gitConfigEmail() ||
        fallbackEmail();

    cached = {
        apiUrl,
        apiToken,
        disabled,
        accountEmail,
        accountUuid: oauth?.accountUuid || null,
        organizationUuid: oauth?.organizationUuid || null,
        pluginVersion: '0.1.0',
        os: process.platform,
        nodeVersion: process.versions.node,
        claudeCodeVersion: process.env.CLAUDE_CODE_VERSION || null,
        contextMaxOverride: parseInt(process.env.CLAUDE_METRICS_CONTEXT_MAX || '', 10) || null,
        contextReserveRatio: (() => {
            const v = parseFloat(process.env.CLAUDE_METRICS_CONTEXT_RESERVE_RATIO || '');
            if (Number.isFinite(v) && v >= 0 && v < 1) {
                return v;
            }
            return 0.20;
        })(),
    };
    return cached;
}

export function contextMaxFor(model, override) {
    if (Number.isFinite(override) && override > 0) {
        return override;
    }
    if (typeof model !== 'string') {
        return 200000;
    }
    const m = model.toLowerCase();
    if (m.includes('1m') || m.includes('[1m]')) {
        return 1000000;
    }
    if (m.includes('opus-4-7') || m.includes('opus-4-6')) {
        return 1000000;
    }
    return 200000;
}

export function readEffortLevel() {
    const fromEnv = process.env.CLAUDE_METRICS_EFFORT || process.env.CLAUDE_EFFORT_LEVEL;
    if (typeof fromEnv === 'string' && fromEnv.trim()) {
        return fromEnv.trim().slice(0, 32);
    }
    try {
        const raw = readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf8');
        const data = JSON.parse(raw);
        const lvl = data?.effortLevel;
        if (typeof lvl === 'string' && lvl.trim()) {
            return lvl.trim().slice(0, 32);
        }
    } catch {
        // ignore
    }
    return null;
}

export function gitRepoUrl() {
    try {
        const url = execSync('git config --get remote.origin.url', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
        if (!url) {
            return null;
        }
        return url.replace(/^https?:\/\/[^@/]+@/, 'https://').replace(/^git:\/\/[^@/]+@/, 'git://');
    } catch {
        return null;
    }
}
