import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, cpus, hostname, networkInterfaces, platform, release, totalmem, homedir } from 'node:os';
import { join } from 'node:path';

let cache = null;

export function loadMachineMeta() {
    if (cache) {
        return cache;
    }
    cache = {
        machine_id_os: readOsMachineId(),
        machine_id_plugin: readOrCreatePluginMachineId(),
        hostname: process.env.CLAUDE_METRICS_NO_HOSTNAME ? null : safeHostname(),
        os_name: platform(),
        os_version: release(),
        arch: arch(),
        cpu_model: process.env.CLAUDE_METRICS_NO_HARDWARE ? null : (cpus()[0]?.model ?? null),
        cpu_count: process.env.CLAUDE_METRICS_NO_HARDWARE ? null : cpus().length,
        ram_bytes: process.env.CLAUDE_METRICS_NO_HARDWARE ? null : totalmem(),
        local_ip: primaryLocalIp(),
    };
    return cache;
}

export function _resetMachineMetaCacheForTests() {
    cache = null;
}

function readOsMachineId() {
    if (process.env.CLAUDE_METRICS_NO_MACHINE_ID) {
        return null;
    }
    try {
        if (platform() === 'darwin') {
            const out = execSync('ioreg -rd1 -c IOPlatformExpertDevice', {
                stdio: ['ignore', 'pipe', 'ignore'],
                timeout: 2000,
            }).toString();
            const m = out.match(/IOPlatformUUID"\s*=\s*"([^"]+)"/);
            return m?.[1] ?? null;
        }
        if (platform() === 'linux') {
            for (const path of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
                try {
                    const value = readFileSync(path, 'utf8').trim();
                    if (value) {
                        return value;
                    }
                } catch {
                    // try next
                }
            }
            return null;
        }
        if (platform() === 'win32') {
            const out = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', {
                stdio: ['ignore', 'pipe', 'ignore'],
                timeout: 2000,
            }).toString();
            const m = out.match(/MachineGuid\s+REG_SZ\s+([\w-]+)/i);
            return m?.[1] ?? null;
        }
    } catch {
        // swallow
    }
    return null;
}

function readOrCreatePluginMachineId() {
    const dir = join(homedir(), '.claude-metrics');
    const file = join(dir, 'machine.json');
    try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        if (parsed && typeof parsed.id === 'string' && parsed.id) {
            return parsed.id;
        }
    } catch {
        // file missing or unreadable
    }
    try {
        mkdirSync(dir, { recursive: true });
        const id = randomUUID();
        writeFileSync(file, JSON.stringify({ id }), { mode: 0o600 });
        return id;
    } catch {
        return null;
    }
}

function safeHostname() {
    try {
        return hostname();
    } catch {
        return null;
    }
}

function primaryLocalIp() {
    try {
        for (const ifaces of Object.values(networkInterfaces())) {
            for (const iface of ifaces ?? []) {
                if (!iface.internal && iface.family === 'IPv4') {
                    return iface.address;
                }
            }
        }
    } catch {
        // ignore
    }
    return null;
}
