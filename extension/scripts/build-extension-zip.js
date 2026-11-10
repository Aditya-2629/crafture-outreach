#!/usr/bin/env node
/**
 * OutFox — Production Extension Zip Packager
 * Packages a clean, production-ready zip without devDependencies or tests.
 */

import { readFileSync, mkdirSync, cpSync, rmSync, existsSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const extRoot = resolve(__dirname, '..');
const distDir = resolve(extRoot, 'dist');
const stagingDir = resolve(distDir, 'staging');

const manifestPath = join(extRoot, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const version = manifest.version || '1.0.0';
const zipName = `OutFox-v${version}.zip`;
const zipPath = join(distDir, zipName);

console.log(`\n📦 Packaging OutFox v${version}...`);

// 1. Prepare clean dist and staging
if (existsSync(stagingDir)) rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });
mkdirSync(distDir, { recursive: true });

// 2. Production assets to copy
const copyItems = ['manifest.json', 'src', 'sequences', 'icons'];

copyItems.forEach((item) => {
  const src = join(extRoot, item);
  const dest = join(stagingDir, item);
  if (existsSync(src)) {
    cpSync(src, dest, {
      recursive: true,
      filter: (source) => {
        const basename = source.split(/[\\/]/).pop();
        if (basename.endsWith('.test.js')) return false;
        if (basename === 'tests' || basename === '.DS_Store' || basename === 'Thumbs.db') return false;
        return true;
      },
    });
  }
});

// 3. Compress using system native utility (cross-platform)
try {
  if (existsSync(zipPath)) rmSync(zipPath, { force: true });

  if (process.platform === 'win32') {
    const psCmd = `powershell -NoProfile -Command "Compress-Archive -Path '${stagingDir}\\*' -DestinationPath '${zipPath}' -Force"`;
    execSync(psCmd, { stdio: 'inherit' });
  } else {
    execSync(`cd "${stagingDir}" && zip -r -q "${zipPath}" .`, { stdio: 'inherit' });
  }

  // Clean staging
  rmSync(stagingDir, { recursive: true, force: true });

  const stats = statSync(zipPath);
  const sizeKb = (stats.size / 1024).toFixed(1);

  console.log(`\n✅ Production extension package created successfully!`);
  console.log(`   File: ${zipPath}`);
  console.log(`   Size: ${sizeKb} KB\n`);
} catch (e) {
  console.error('\n❌ Packaging failed:', e.message);
  process.exit(1);
}

