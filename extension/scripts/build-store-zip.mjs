#!/usr/bin/env node
/**
 * Crafture Network — Microsoft Edge / Chrome Web Store Zip Builder
 * Builds a clean, compliant store package without modifying the working extension/manifest.json.
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  cpSync,
  rmSync,
  existsSync,
  statSync,
} from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));

// Resolve extension directory and repository root
const extRoot = existsSync(join(scriptDir, '..', 'manifest.json'))
  ? resolve(scriptDir, '..')
  : resolve(scriptDir, '..', 'extension');

const repoRoot = existsSync(join(scriptDir, '..', 'extension', 'manifest.json'))
  ? resolve(scriptDir, '..')
  : resolve(extRoot, '..');

const distStoreDir = resolve(repoRoot, 'dist-store');
const stagingDir = resolve(distStoreDir, 'staging');
const repoZipPath = resolve(repoRoot, 'crafture-network-store.zip');
const distZipPath = resolve(distStoreDir, 'crafture-network-store.zip');
const legacyRepoZipPath = resolve(repoRoot, 'crafture-network-store.zip');
const legacyDistZipPath = resolve(distStoreDir, 'crafture-network-store.zip');

console.log('\nBuilding Crafture Network Store Package (Edge / Chrome Web Store)...');
console.log(`   Extension: ${extRoot}`);
console.log(`   Repo Root: ${repoRoot}`);

// 1. Clean staging & output directories
if (existsSync(stagingDir)) rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });
mkdirSync(distStoreDir, { recursive: true });

// 2. Stage production assets (strictly excluding tests, node_modules, keys, packages, etc.)
const copyItems = ['manifest.json', 'icons', 'src', 'sequences'];

function isExcluded(filePath) {
  const norm = filePath.replace(/\\/g, '/');
  const base = norm.split('/').pop();
  if (
    base === 'node_modules' ||
    base === 'tests' ||
    base === 'package.json' ||
    base === 'package-lock.json' ||
    base === 'vitest.config.js' ||
    base === '.DS_Store' ||
    base === 'Thumbs.db'
  ) {
    return true;
  }
  if (
    base.endsWith('.test.js') ||
    base.endsWith('.pem') ||
    base.endsWith('.crx')
  ) {
    return true;
  }
  if (norm.includes('/node_modules/') || norm.includes('/tests/')) {
    return true;
  }
  return false;
}

for (const item of copyItems) {
  const src = join(extRoot, item);
  const dest = join(stagingDir, item);
  if (!existsSync(src)) continue;

  const stat = statSync(src);
  if (stat.isDirectory()) {
    cpSync(src, dest, {
      recursive: true,
      filter: (source) => !isExcluded(source),
    });
  } else if (!isExcluded(src)) {
    cpSync(src, dest);
  }
}

// 3. Transform the STAGED copy of manifest.json ONLY
const stagedManifestPath = join(stagingDir, 'manifest.json');
if (!existsSync(stagedManifestPath)) {
  throw new Error(`Failed to stage manifest.json at ${stagedManifestPath}`);
}

const originalManifestContent = readFileSync(join(extRoot, 'manifest.json'), 'utf8');
const manifest = JSON.parse(readFileSync(stagedManifestPath, 'utf8'));

// 3a. Remove the "key" field
delete manifest.key;

// 3b. Remove redundant permissions already in host_permissions, as well as wildcards from optional_host_permissions
if (Array.isArray(manifest.optional_host_permissions)) {
  const hostSet = new Set(manifest.host_permissions || []);
  manifest.optional_host_permissions = manifest.optional_host_permissions.filter(
    (perm) => !hostSet.has(perm) && perm !== 'https://*/*' && perm !== 'http://*/*',
  );
}

// 3c. Narrow web_accessible_resources[0].matches from ["<all_urls>"] to ["https://www.linkedin.com/*"]
if (Array.isArray(manifest.web_accessible_resources) && manifest.web_accessible_resources[0]) {
  if (Array.isArray(manifest.web_accessible_resources[0].matches)) {
    manifest.web_accessible_resources[0].matches = manifest.web_accessible_resources[0].matches.map((m) =>
      m === '<all_urls>' ? 'https://www.linkedin.com/*' : m,
    );
  }
}

// Write the transformed manifest to staging ONLY
writeFileSync(stagedManifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

// Assert working extension/manifest.json is untouched
const currentManifestContent = readFileSync(join(extRoot, 'manifest.json'), 'utf8');
if (currentManifestContent !== originalManifestContent) {
  throw new Error('Working extension/manifest.json was modified! Aborting.');
}

// 4. Compress staged folder so manifest.json is at the ROOT of the zip
try {
  if (existsSync(distZipPath)) rmSync(distZipPath, { force: true });
  if (existsSync(repoZipPath)) rmSync(repoZipPath, { force: true });

  if (process.platform === 'win32') {
    const psCmd = `powershell -NoProfile -Command "Compress-Archive -Path '${stagingDir}\\*' -DestinationPath '${distZipPath}' -Force"`;
    execSync(psCmd, { stdio: 'inherit' });
  } else {
    execSync(`cd "${stagingDir}" && zip -r -q "${distZipPath}" .`, { stdio: 'inherit' });
  }

  // Copy to repo root crafture-network-store.zip and keep fallback copy
  cpSync(distZipPath, repoZipPath, { force: true });
  try {
    cpSync(distZipPath, legacyRepoZipPath, { force: true });
    cpSync(distZipPath, legacyDistZipPath, { force: true });
  } catch {}

  // 5. Clean up temporary staging directory
  rmSync(stagingDir, { recursive: true, force: true });

  const stats = statSync(repoZipPath);
  const sizeKb = (stats.size / 1024).toFixed(1);

  console.log(`\nStore package created successfully!`);
  console.log(`   Repo Root Zip: ${repoZipPath}`);
  console.log(`   Dist Store Zip: ${distZipPath}`);
  console.log(`   Size: ${sizeKb} KB\n`);
} catch (e) {
  console.error('\nPackaging failed:', e.message);
  process.exit(1);
}
