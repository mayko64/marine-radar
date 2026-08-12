const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const config = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'config/assembly.json'), 'utf8')
);
const runtimeFragments = config.fragments.filter(fragment =>
    fragment.startsWith('src/radar/')
);

assert.ok(runtimeFragments.length > 0, 'runtime fragments must be configured');
assert.ok(
    runtimeFragments.every(fragment => fragment.endsWith('.js')),
    'byte-preserved legacy runtime fragments must use .js extensions'
);

const document = Buffer.concat(
    config.fragments.map(fragment =>
        fs.readFileSync(path.join(ROOT, fragment))
    )
).toString('utf8');
const scriptMatch = document.match(/<script>\n([\s\S]*)<\/script>/);

assert.ok(scriptMatch, 'assembled document must contain one inline script');
assert.doesNotThrow(
    () => new vm.Script(scriptMatch[1], { filename: 'radar-runtime.js' }),
    'assembled runtime must be valid sloppy-mode browser JavaScript'
);

console.log('Radar runtime source syntax is valid');
