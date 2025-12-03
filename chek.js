#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const IGNORES = ['node_modules', '.git', 'deploy', 'deploy.zip'];

function shouldIgnore(p) {
  return IGNORES.some(ig => p.includes(path.sep + ig + path.sep) || p.endsWith(path.sep + ig));
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (shouldIgnore(full)) continue;
    if (e.isDirectory()) files = files.concat(walk(full));
    else if (e.isFile() && full.endsWith('.js')) files.push(full);
  }
  return files;
}

function isLikelyBinary(buffer) {
  const len = Math.min(buffer.length, 1024);
  let nonPrintable = 0;
  for (let i = 0; i < len; i++) {
    const b = buffer[i];
    if (b === 0) return true;
    if (b < 9) { nonPrintable++; continue; }
    if (b > 13 && b < 32) nonPrintable++;
  }
  return (nonPrintable / Math.max(1, len)) > 0.1;
}

function checkFile(file) {
  const buf = fs.readFileSync(file);
  if (isLikelyBinary(buf)) {
    return new Error('Binary or non-text file - skipped');
  }
  const src = buf.toString('utf-8');
  try {
    new vm.Script(src, { filename: file });
    return null;
  } catch (err) {
    return err;
  }
}

function main() {
  const root = process.cwd();
  console.log('Starting project syntax check in', root);
  const files = walk(root);
  let problems = 0;
  let skipped = 0;
  for (const f of files) {
    const rel = path.relative(root, f);
    const err = checkFile(f);
    if (err) {
      if (String(err && err.message || err).toLowerCase().includes('skipped')) {
        skipped++;
        console.warn('\n[SKIP]  %s\n%s\n', rel, err.message || String(err));
        continue;
      }
      problems++;
      console.error('\n[ERROR] %s\n%s\n', rel, err.stack || err.toString());
    } else {
      console.log('[OK]   %s', rel);
    }
  }
  console.log('\nChecked %d JS files, found %d problem(s), skipped %d non-text files', files.length, problems, skipped);
  process.exit(problems > 0 ? 1 : 0);
}

main();
