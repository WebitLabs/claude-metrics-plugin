import { existsSync, readFileSync } from 'node:fs';

/**
 * Read latest permissionMode value from a transcript jsonl. Scans from end
 * for the first record carrying a non-null permissionMode field. Returns null
 * if file missing or no value found.
 */
export function readLatestPermissionMode(transcriptPath) {
    if (!transcriptPath || !existsSync(transcriptPath)) {
        return null;
    }
    let raw;
    try {
        raw = readFileSync(transcriptPath, 'utf8');
    } catch {
        return null;
    }
    const lines = raw.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line || !line.includes('permissionMode')) {
            continue;
        }
        try {
            const obj = JSON.parse(line);
            if (typeof obj?.permissionMode === 'string' && obj.permissionMode) {
                return obj.permissionMode.slice(0, 32);
            }
        } catch {
            // skip malformed
        }
    }
    return null;
}
