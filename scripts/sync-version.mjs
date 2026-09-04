#!/usr/bin/env node
/**
 * Rewrite src/version.ts from the version field in package.json.
 *
 * Wired to the npm `version` lifecycle script so `npm version <bump>` keeps the
 * runtime constant and the manifest in lockstep. Fails loudly if package.json
 * has no usable version.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = join(root, 'package.json');
const versionPath = join(root, 'src', 'version.ts');

const manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
const version = manifest.version;

if (typeof version !== 'string' || version.trim() === '') {
  throw new Error(
    `Cannot sync version: package.json has no usable "version" field (received ${JSON.stringify(version)}).`,
  );
}

const contents = `/**
 * Single source of truth for the SDK version at runtime.
 *
 * Generated from package.json by \`scripts/sync-version.mjs\`, which runs from
 * the npm \`version\` lifecycle script. Do not edit by hand.
 */

export const SDK_VERSION = '${version}';
`;

writeFileSync(versionPath, contents);
console.log(`src/version.ts synced to ${version}`);
