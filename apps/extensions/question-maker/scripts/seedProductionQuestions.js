#!/usr/bin/env node

/**
 * Root-level runner for production seed (adds sample questions to existing courses only).
 * Run from project root: npm run seed:production
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = __dirname;
const backendDir = path.resolve(rootDir, '../app/backend');
const scriptPath = path.resolve(backendDir, 'scripts/seedProductionQuestions.js');

if (!fs.existsSync(scriptPath)) {
  console.error('❌ Script not found:', scriptPath);
  process.exit(1);
}

const originalCwd = process.cwd();
process.chdir(backendDir);

const child = spawn('node', [path.relative(backendDir, scriptPath)], {
  stdio: 'inherit',
  shell: false,
  cwd: backendDir,
  env: { ...process.env }
});

child.on('error', (err) => {
  console.error('❌ Error:', err);
  process.chdir(originalCwd);
  process.exit(1);
});

child.on('exit', (code) => {
  process.chdir(originalCwd);
  process.exit(code === 0 ? 0 : 1);
});
