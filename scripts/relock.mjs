#!/usr/bin/env node
// ============================================================================
// Regenerate both package-lock.json files with every platform's native binary.
//
// Why this exists: rollup, esbuild and @swc/core ship their native code as
// per-platform optional dependencies. npm only records the ones matching the
// machine doing the install (npm/cli#4828), so a lockfile written on an Apple
// Silicon Mac contains @rollup/rollup-darwin-arm64 and nothing else — and then
// `npm ci` on Linux CI installs a rollup with no binary and dies.
//
// `--os=linux --cpu=x64` makes npm resolve for a platform other than the host,
// which makes it record the whole optional set (darwin included). It only does
// that on a clean resolve, hence the temp directory: with node_modules present
// npm just re-describes the tree it can already see.
//
// Run this instead of `npm install` whenever dependencies change; a plain
// `npm install` will quietly narrow the lockfiles back to this machine.
// ============================================================================
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const packages = ['.', 'web'];
const root = resolve(import.meta.dirname, '..');

for (const pkg of packages) {
  const dir = join(root, pkg);
  const scratch = mkdtempSync(join(tmpdir(), 'relock-'));
  try {
    copyFileSync(join(dir, 'package.json'), join(scratch, 'package.json'));
    console.log(`relocking ${pkg === '.' ? 'root' : pkg}…`);
    execFileSync('npm', ['install', '--package-lock-only', '--os=linux', '--cpu=x64'], {
      cwd: scratch,
      stdio: 'inherit',
    });
    copyFileSync(join(scratch, 'package-lock.json'), join(dir, 'package-lock.json'));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

console.log('\nDone. Verify with: node scripts/check-lockfiles.mjs');
