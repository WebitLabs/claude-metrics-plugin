import { loadConfig } from './config.mjs';
import { loadMachineMeta } from './machine.mjs';
import { loadMcpInventory } from './mcp-inventory.mjs';

export function clientMetaBase() {
    const cfg = loadConfig();
    const m = loadMachineMeta();
    const inv = loadMcpInventory();
    return {
        os: cfg.os,
        plugin_version: cfg.pluginVersion,
        node_version: cfg.nodeVersion,
        claude_code_version: cfg.claudeCodeVersion,
        machine_id_os: m.machine_id_os,
        machine_id_plugin: m.machine_id_plugin,
        hostname: m.hostname,
        os_name: m.os_name,
        os_version: m.os_version,
        arch: m.arch,
        cpu_model: m.cpu_model,
        cpu_count: m.cpu_count,
        ram_bytes: m.ram_bytes,
        local_ip: m.local_ip,
        mcp_servers: inv.mcp_servers,
        skills_registered: inv.skills_registered,
    };
}
