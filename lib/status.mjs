#!/usr/bin/env node
import { loadConfig } from './config.mjs';
import { readQueue, readErrors, readLastSend, paths } from './queue.mjs';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

function isAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

const cfg = loadConfig();
const queue = readQueue();
const errors = readErrors(3);
const lastSend = readLastSend();
const { ackFile } = paths();

const hcPidFile = join(homedir(), '.claude-metrics', 'healthcheck.pid');
const hcLog = join(homedir(), '.claude-metrics', 'healthcheck.log');
let hcStatus = 'not running';
if (existsSync(hcPidFile)) {
    const pid = parseInt(readFileSync(hcPidFile, 'utf8').trim(), 10);
    hcStatus = isAlive(pid) ? `running (pid ${pid})` : `stale pid file (pid ${pid} not alive)`;
}

let lastHcLine = '(no log)';
if (existsSync(hcLog)) {
    const lines = readFileSync(hcLog, 'utf8').trim().split('\n');
    lastHcLine = lines[lines.length - 1] || '(empty)';
}

const lines = [
    '── Claude Metrics status ──',
    `Endpoint:        ${cfg.apiUrl || '(unset — CLAUDE_METRICS_API_URL)'}`,
    `Disabled:        ${cfg.disabled ? 'yes' : 'no'}`,
    `Account email:   ${cfg.accountEmail}`,
    `Plugin version:  ${cfg.pluginVersion}`,
    `Queue depth:     ${queue.length}`,
    `Last successful: ${lastSend || '(never)'}`,
    `First-run ack:   ${existsSync(ackFile) ? readFileSync(ackFile, 'utf8').trim() : '(not acknowledged)'}`,
    '',
    'Health-check daemon:',
    `  status:   ${hcStatus}`,
    `  last log: ${lastHcLine}`,
    '',
    'Recent errors:',
];
if (errors.length === 0) {
    lines.push('  (none)');
} else {
    for (const e of errors) {
        lines.push('  ' + e);
    }
}

if (!existsSync(ackFile)) {
    writeFileSync(ackFile, new Date().toISOString());
}

process.stdout.write(lines.join('\n') + '\n');
