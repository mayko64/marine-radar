const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const config = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'config/assembly.json'), 'utf8')
);
const generatedPath = path.join(ROOT, 'dist/radar.html');

assert.ok(fs.existsSync(generatedPath), 'dist/radar.html must exist');
const generated = fs.readFileSync(generatedPath);

function hash(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

assert.deepEqual(
    Object.keys(config).sort(),
    ['bytes', 'fragments', 'output', 'sha256'],
    'assembly config must contain only source-owned build fields'
);
assert.equal(generated.length, config.bytes);
assert.equal(hash(generated), config.sha256);
console.log('Generated radar matches the source-owned output contract');
