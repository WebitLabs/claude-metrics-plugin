import { readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

let cache = null;

export function loadMcpInventory() {
    if (cache) {
        return cache;
    }
    cache = {
        mcp_servers: readMcpServers(),
        skills_registered: readSkills(),
    };
    return cache;
}

export function _resetForTests() {
    cache = null;
}

function readMcpServers() {
    const out = [];
    out.push(...readMcpFrom(join(homedir(), '.claude.json'), 'user'));

    const cwd = process.cwd();
    if (cwd) {
        out.push(...readMcpFrom(join(cwd, '.mcp.json'), 'project'));
    }

    return dedupeByScopeAndName(out);
}

function readMcpFrom(filePath, scope) {
    try {
        const data = JSON.parse(readFileSync(filePath, 'utf8'));
        const servers = data?.mcpServers;
        if (!servers || typeof servers !== 'object') {
            return [];
        }
        return Object.keys(servers).map(name => ({ name, scope }));
    } catch {
        return [];
    }
}

function readSkills() {
    const out = [];
    out.push(...readSkillsFrom(join(homedir(), '.claude', 'skills'), 'user'));
    const cwd = process.cwd();
    if (cwd) {
        out.push(...readSkillsFrom(join(cwd, '.claude', 'skills'), 'project'));
    }
    return dedupeByScopeAndName(out);
}

function readSkillsFrom(dir, scope) {
    try {
        return readdirSync(dir)
            .filter(name => {
                try {
                    return statSync(join(dir, name)).isDirectory();
                } catch {
                    return false;
                }
            })
            .map(name => ({ name, scope }));
    } catch {
        return [];
    }
}

function dedupeByScopeAndName(rows) {
    const seen = new Set();
    const out = [];
    for (const row of rows) {
        const key = `${row.scope}:${row.name}`;
        if (!seen.has(key)) {
            seen.add(key);
            out.push(row);
        }
    }
    return out;
}
