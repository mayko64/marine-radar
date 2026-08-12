const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
    path.join(__dirname, 'radar.browser.test.cjs'),
    'utf8'
);

assert.match(
    source,
    /function removeProfile\(\) \{[\s\S]*maxRetries:\s*10[\s\S]*retryDelay:\s*100/,
    'browser profile cleanup must retry transient ENOTEMPTY failures'
);
assert.doesNotMatch(
    source,
    /fs\.rmSync\(PROFILE,\s*\{\s*recursive:\s*true,\s*force:\s*true\s*\}\)/,
    'all browser profile cleanup must use the retrying helper'
);
assert.match(
    source,
    /spawn\(CHROME,\s*args,\s*\{[\s\S]*detached:\s*process\.platform !== 'win32'/,
    'Chrome must run in a dedicated process group on Unix'
);
assert.match(
    source,
    /process\.kill\(-child\.pid,\s*signal\)/,
    'browser cleanup must terminate the complete Chrome process group'
);

console.log('Browser harness retries transient profile cleanup races');
