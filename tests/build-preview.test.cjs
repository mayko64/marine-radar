const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(ROOT, '.test-tmp-preview');
const TOOL = path.join(ROOT, 'tools/build.ts');
const TSX = path.join(ROOT, 'node_modules/.bin/tsx');
const candidate = Buffer.from('<!doctype html><title>Preview</title>\n');
const candidateHash = crypto.createHash('sha256').update(candidate).digest('hex');

fs.rmSync(FIXTURE, { recursive: true, force: true });
fs.mkdirSync(path.join(FIXTURE, 'config'), { recursive: true });
fs.mkdirSync(path.join(FIXTURE, 'src'), { recursive: true });
fs.writeFileSync(path.join(FIXTURE, 'src/candidate.html'), candidate);
fs.writeFileSync(
    path.join(FIXTURE, 'config/assembly.json'),
    JSON.stringify({
        output: 'dist/radar.html',
        bytes: 1,
        sha256: '0'.repeat(64),
        fragments: ['src/candidate.html']
    })
);

try {
    const strict = spawnSync(TSX, [TOOL], {
        cwd: FIXTURE,
        encoding: 'utf8'
    });
    assert.notEqual(strict.status, 0, 'strict build must reject changed output');
    assert.equal(
        fs.existsSync(path.join(FIXTURE, 'dist/radar.html')),
        false,
        'strict build must not publish an unapproved artifact'
    );

    const preview = spawnSync(TSX, [TOOL, '--preview'], {
        cwd: FIXTURE,
        encoding: 'utf8'
    });
    assert.equal(preview.status, 0, preview.stderr);
    assert.deepEqual(
        fs.readFileSync(path.join(FIXTURE, 'dist/radar.html')),
        candidate
    );
    assert.match(preview.stdout, new RegExp(`bytes: ${candidate.length}`));
    assert.match(preview.stdout, new RegExp(`sha256: ${candidateHash}`));
} finally {
    fs.rmSync(FIXTURE, { recursive: true, force: true });
}

console.log('Preview build emits an inspectable unapproved artifact');
