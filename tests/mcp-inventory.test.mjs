import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('reads MCP servers from ~/.claude.json', async () => {
    const home = mkdtempSync(join(tmpdir(), 'cmi-'));
    process.env.HOME = home;
    writeFileSync(join(home, '.claude.json'), JSON.stringify({
        mcpServers: { context7: {}, firecrawl: {} },
    }));

    const { loadMcpInventory, _resetForTests } = await import(`../lib/mcp-inventory.mjs?t=${Date.now()}`);
    _resetForTests();

    const inv = loadMcpInventory();
    const names = inv.mcp_servers.map(s => s.name).sort();
    assert.deepEqual(names, ['context7', 'firecrawl']);

    rmSync(home, { recursive: true, force: true });
});

test('returns empty array when ~/.claude.json is missing', async () => {
    const home = mkdtempSync(join(tmpdir(), 'cmi-'));
    process.env.HOME = home;

    const { loadMcpInventory, _resetForTests } = await import(`../lib/mcp-inventory.mjs?t=${Date.now()}`);
    _resetForTests();

    const inv = loadMcpInventory();
    assert.deepEqual(inv.mcp_servers, []);

    rmSync(home, { recursive: true, force: true });
});

test('enumerates skill directories under ~/.claude/skills/', async () => {
    const home = mkdtempSync(join(tmpdir(), 'cmi-'));
    process.env.HOME = home;
    mkdirSync(join(home, '.claude', 'skills', 'foo'), { recursive: true });
    mkdirSync(join(home, '.claude', 'skills', 'bar'), { recursive: true });

    const { loadMcpInventory, _resetForTests } = await import(`../lib/mcp-inventory.mjs?t=${Date.now()}`);
    _resetForTests();

    const inv = loadMcpInventory();
    const names = inv.skills_registered.map(s => s.name).sort();
    assert.ok(names.includes('foo'));
    assert.ok(names.includes('bar'));

    rmSync(home, { recursive: true, force: true });
});
