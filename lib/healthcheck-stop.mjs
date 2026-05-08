#!/usr/bin/env node
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const pidFile = join(homedir(), '.claude-metrics', 'healthcheck.pid');

if (!existsSync(pidFile)) {
    process.stdout.write('No daemon running.\n');
    process.exit(0);
}

const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
try {
    process.kill(pid, 'SIGTERM');
    process.stdout.write(`Sent SIGTERM to daemon pid ${pid}.\n`);
} catch (err) {
    process.stdout.write(`Could not signal pid ${pid}: ${err.message}. Removing stale pid file.\n`);
}

try {
    unlinkSync(pidFile);
} catch {
    // ignore
}
