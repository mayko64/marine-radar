import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface AssemblyConfig {
  output: string;
  sha256: string;
  bytes: number;
  fragments: string[];
}

export function sha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.every(item => typeof item === 'string');
}

export function resolveInsideRoot(root: string, value: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, value);
  const relative = path.relative(resolvedRoot, resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes project root: ${value}`);
  }

  return resolved;
}

export async function loadConfig(root: string): Promise<AssemblyConfig> {
  const raw: unknown = JSON.parse(
    await readFile(path.join(root, 'config/assembly.json'), 'utf8')
  );

  if (!isRecord(raw)) {
    throw new Error('config/assembly.json does not match AssemblyConfig');
  }

  if (
    typeof raw.output !== 'string' ||
    typeof raw.sha256 !== 'string' ||
    typeof raw.bytes !== 'number' ||
    !isStringArray(raw.fragments)
  ) {
    throw new Error('config/assembly.json contains invalid field types');
  }

  return {
    output: raw.output,
    sha256: raw.sha256,
    bytes: raw.bytes,
    fragments: raw.fragments
  };
}

export async function readFragments(
  root: string,
  fragments: readonly string[]
): Promise<Buffer> {
  const parts = await Promise.all(
    fragments.map(fragment => readFile(resolveInsideRoot(root, fragment)))
  );
  return Buffer.concat(parts);
}

export async function writeAtomically(
  destination: string,
  content: Uint8Array
): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;

  try {
    await writeFile(temporary, content);
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}
