import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('loadMachineMeta returns expected shape', async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'cmm-'));
    process.env.HOME = tmpHome;
    delete process.env.CLAUDE_METRICS_NO_HARDWARE;
    delete process.env.CLAUDE_METRICS_NO_HOSTNAME;
    delete process.env.CLAUDE_METRICS_NO_MACHINE_ID;

    const { loadMachineMeta, _resetMachineMetaCacheForTests } = await import(`../lib/machine.mjs?t=${Date.now()}`);
    _resetMachineMetaCacheForTests();

    const m = loadMachineMeta();

    assert.ok(typeof m.machine_id_plugin === 'string' && m.machine_id_plugin.length >= 32);
    assert.ok(typeof m.os_name === 'string');
    assert.ok(typeof m.arch === 'string');
    assert.ok(m.cpu_count === null || typeof m.cpu_count === 'number');
    assert.ok(m.ram_bytes === null || typeof m.ram_bytes === 'number');

    rmSync(tmpHome, { recursive: true, force: true });
});

test('CLAUDE_METRICS_NO_HARDWARE zeroes hardware fields', async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'cmm-'));
    process.env.HOME = tmpHome;
    process.env.CLAUDE_METRICS_NO_HARDWARE = '1';

    const { loadMachineMeta, _resetMachineMetaCacheForTests } = await import(`../lib/machine.mjs?t=${Date.now()}`);
    _resetMachineMetaCacheForTests();

    const m = loadMachineMeta();
    assert.equal(m.cpu_model, null);
    assert.equal(m.cpu_count, null);
    assert.equal(m.ram_bytes, null);

    delete process.env.CLAUDE_METRICS_NO_HARDWARE;
    rmSync(tmpHome, { recursive: true, force: true });
});

test('plugin UUID persists across calls and file has mode 0600', async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'cmm-'));
    process.env.HOME = tmpHome;
    delete process.env.CLAUDE_METRICS_NO_HARDWARE;

    const { loadMachineMeta, _resetMachineMetaCacheForTests } = await import(`../lib/machine.mjs?t=${Date.now()}`);
    _resetMachineMetaCacheForTests();
    const first = loadMachineMeta();

    _resetMachineMetaCacheForTests();
    const second = loadMachineMeta();

    assert.equal(first.machine_id_plugin, second.machine_id_plugin);

    const file = join(tmpHome, '.claude-metrics', 'machine.json');
    assert.ok(existsSync(file));
    if (process.platform !== 'win32') {
        const mode = statSync(file).mode & 0o777;
        assert.equal(mode, 0o600);
    }

    rmSync(tmpHome, { recursive: true, force: true });
});
