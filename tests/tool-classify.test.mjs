import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    classifyBash,
    relativizePath,
    inferFilePath,
    inferSubagentType,
    classifySuccess,
    bytesOf,
} from '../lib/tool-classify.mjs';

test('classifyBash maps git', () => {
    assert.equal(classifyBash('git status'), 'git');
    assert.equal(classifyBash('  git diff HEAD'), 'git');
});

test('classifyBash maps npm family', () => {
    assert.equal(classifyBash('npm install'), 'npm');
    assert.equal(classifyBash('pnpm run build'), 'npm');
    assert.equal(classifyBash('npx vite'), 'npm');
});

test('classifyBash maps test runners', () => {
    assert.equal(classifyBash('vendor/bin/pest tests/Unit'), 'test');
    assert.equal(classifyBash('npx jest --watch'), 'npm');
});

test('classifyBash maps fs commands', () => {
    assert.equal(classifyBash('ls -la'), 'fs');
    assert.equal(classifyBash('grep -R foo .'), 'fs');
});

test('classifyBash falls back to other', () => {
    assert.equal(classifyBash('weirdcmd --flag'), 'other');
    assert.equal(classifyBash(''), 'other');
    assert.equal(classifyBash(null), 'other');
});

test('relativizePath turns absolute under cwd into relative', () => {
    assert.equal(relativizePath('/Users/x/proj/app/User.php', '/Users/x/proj'), 'app/User.php');
    assert.equal(relativizePath('/Users/x/proj', '/Users/x/proj'), '.');
});

test('relativizePath leaves absolute outside cwd alone', () => {
    assert.equal(relativizePath('/etc/hosts', '/Users/x/proj'), '/etc/hosts');
});

test('relativizePath keeps relative input as-is', () => {
    assert.equal(relativizePath('app/User.php', '/Users/x/proj'), 'app/User.php');
});

test('inferFilePath only extracts for file tools', () => {
    assert.equal(
        inferFilePath('Read', { file_path: '/p/a/b.php' }, '/p'),
        'a/b.php',
    );
    assert.equal(inferFilePath('Bash', { command: 'ls' }, '/p'), null);
});

test('inferSubagentType reads tool_input.subagent_type', () => {
    assert.equal(inferSubagentType({ subagent_type: 'Explore' }), 'Explore');
    assert.equal(inferSubagentType({}), null);
    assert.equal(inferSubagentType(null), null);
});

test('classifySuccess detects is_error / interrupted / exit_code', () => {
    assert.deepEqual(classifySuccess(null), { success: true, errorClass: null });
    assert.deepEqual(classifySuccess({ is_error: true, error: 'old_string not found in file' }), {
        success: false,
        errorClass: 'old_string_not_found',
    });
    assert.deepEqual(classifySuccess({ interrupted: true }), { success: false, errorClass: 'interrupted' });
    assert.deepEqual(classifySuccess({ exit_code: 1 }), { success: false, errorClass: 'exit_nonzero' });
    assert.deepEqual(classifySuccess({ exit_code: 0 }), { success: true, errorClass: null });
    assert.deepEqual(classifySuccess({ is_error: true, error: 'permission denied' }), {
        success: false,
        errorClass: 'permission_denied',
    });
});

test('bytesOf measures strings + objects', () => {
    assert.equal(bytesOf('abc'), 3);
    assert.equal(bytesOf({ a: 1 }), 7);
    assert.equal(bytesOf(null), 0);
});
