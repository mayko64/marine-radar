import {
  loadConfig,
  readFragments,
  resolveInsideRoot,
  sha256,
  writeAtomically
} from './assembly.js';

const root = process.cwd();
const config = await loadConfig(root);
const outputPath = resolveInsideRoot(root, config.output);
const assembled = await readFragments(root, config.fragments);
const actualHash = sha256(assembled);
const preview = process.argv.includes('--preview');
const approved =
  assembled.byteLength === config.bytes &&
  actualHash === config.sha256;

if (!approved && !preview) {
  throw new Error('Assembled source does not match the approved output contract');
}

await writeAtomically(outputPath, assembled);

if (approved) {
  console.log(`Built ${config.output} (${assembled.byteLength} bytes)`);
} else {
  console.log(
    `Previewed unapproved ${config.output}\n` +
    `bytes: ${assembled.byteLength}\n` +
    `sha256: ${actualHash}`
  );
}
