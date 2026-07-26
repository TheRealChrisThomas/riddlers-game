#!/usr/bin/env node
// ============================================================================
// Fail fast if a lockfile is missing the native binaries Linux CI needs.
//
// Without this, the symptom is a rollup or @swc stack trace several minutes
// into a CI run that reads like a broken dependency rather than what it is:
// a lockfile written on a Mac. See scripts/relock.mjs for the fix.
// ============================================================================
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REQUIRED = {
  'package-lock.json': [
    '@esbuild/linux-x64', // tsx
    '@swc/core-linux-x64-gnu', // the Temporal worker bundles TS workflows with swc
  ],
  'web/package-lock.json': [
    '@rollup/rollup-linux-x64-gnu', // vite build
    '@esbuild/linux-x64', // vite dev/transform
  ],
};

const root = resolve(import.meta.dirname, '..');
let missing = 0;

for (const [file, packages] of Object.entries(REQUIRED)) {
  const lock = JSON.parse(readFileSync(resolve(root, file), 'utf8'));
  for (const pkg of packages) {
    if (!lock.packages?.[`node_modules/${pkg}`]) {
      console.error(`✗ ${file} is missing ${pkg}`);
      missing++;
    }
  }
}

if (missing) {
  console.error(
    `\n${missing} native binar${missing === 1 ? 'y is' : 'ies are'} absent from the lockfiles — ` +
      'this is npm/cli#4828 and it will break Linux CI.\nRun `npm run lock` and commit the result.',
  );
  process.exit(1);
}

console.log('✓ lockfiles carry the native binaries Linux needs');
