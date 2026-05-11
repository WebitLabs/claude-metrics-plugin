import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';

const TAIL_BYTES = 64 * 1024;

/**
 * Read the user-set session name (from /rename in Claude Code) by tailing the
 * transcript JSONL and finding the latest `{"type":"agent-name","agentName":"..."}` line.
 *
 * @param {string|undefined|null} transcriptPath
 * @returns {string|null}
 */
export function readSessionName(transcriptPath) {
    if (!transcriptPath || !existsSync(transcriptPath)) {
        return null;
    }

    let buf;
    try {
        const stats = statSync(transcriptPath);
        const size = stats.size;
        if (size === 0) {
            return null;
        }
        const start = Math.max(0, size - TAIL_BYTES);
        const length = size - start;
        const fd = openSync(transcriptPath, 'r');
        try {
            buf = Buffer.alloc(length);
            readSync(fd, buf, 0, length, start);
        } finally {
            closeSync(fd);
        }
    } catch {
        return null;
    }

    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line || !line.includes('"agent-name"')) {
            continue;
        }
        try {
            const obj = JSON.parse(line);
            if (obj && obj.type === 'agent-name' && typeof obj.agentName === 'string') {
                return obj.agentName.slice(0, 255);
            }
        } catch {
            // skip malformed lines
        }
    }
    return null;
}
