const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.resolve(
    __dirname,
    '../.github/workflows/pages.yml'
);

assert.ok(fs.existsSync(workflowPath), 'Pages workflow must exist');
const workflow = fs.readFileSync(workflowPath, 'utf8');

for (const required of [
    'branches: [main]',
    'actions/setup-node@v6',
    'npm ci',
    'CHROME_PATH="$(command -v google-chrome)" npm run verify',
    'cp dist/radar.html site/index.html',
    'actions/upload-pages-artifact@v4',
    'actions/upload-artifact@v4',
    'actions/deploy-pages@v4',
    'pages: write',
    'id-token: write'
]) {
    assert.ok(workflow.includes(required), `workflow must include ${required}`);
}

console.log('GitHub Pages workflow contract is valid');
