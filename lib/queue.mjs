import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const MAX_BYTES = 10 * 1024 * 1024;
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000];
const MAX_ATTEMPTS = 5;

function stateDir() {
    return join(homedir(), '.claude-metrics');
}

function queueFile() {
    return join(stateDir(), 'queue.json');
}

function errorsLog() {
    return join(stateDir(), 'errors.log');
}

function ackFile() {
    return join(stateDir(), 'ack');
}

function lastSendFile() {
    return join(stateDir(), 'last-send');
}

export function ensureDir() {
    const dir = stateDir();
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
}

export function readQueue() {
    ensureDir();
    const file = queueFile();
    if (!existsSync(file)) {
        return [];
    }
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        return [];
    }
}

export function writeQueue(items) {
    ensureDir();
    const file = queueFile();
    writeFileSync(file, JSON.stringify(items));
    if (existsSync(file) && statSync(file).size > MAX_BYTES) {
        const trimmed = items.slice(Math.floor(items.length / 2));
        writeFileSync(file, JSON.stringify(trimmed));
    }
}

export function enqueue(item) {
    const queue = readQueue();
    queue.push({
        ...item,
        attempts: 0,
        next_retry_at: Date.now(),
    });
    writeQueue(queue);
}

export function nextDelayMs(attempts) {
    return BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)];
}

export function maxAttempts() {
    return MAX_ATTEMPTS;
}

export function logError(message) {
    ensureDir();
    appendFileSync(errorsLog(), `[${new Date().toISOString()}] ${message}\n`);
}

export function readErrors(lines = 3) {
    const file = errorsLog();
    if (!existsSync(file)) {
        return [];
    }
    const content = readFileSync(file, 'utf8');
    return content.trim().split('\n').slice(-lines);
}

export function recordSuccess() {
    ensureDir();
    writeFileSync(lastSendFile(), new Date().toISOString());
}

export function readLastSend() {
    const file = lastSendFile();
    if (!existsSync(file)) {
        return null;
    }
    return readFileSync(file, 'utf8').trim();
}

export function paths() {
    return {
        stateDir: stateDir(),
        queueFile: queueFile(),
        errorsLog: errorsLog(),
        ackFile: ackFile(),
        lastSendFile: lastSendFile(),
    };
}
