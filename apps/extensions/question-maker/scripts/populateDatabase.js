#!/usr/bin/env node

/**
 * Root-level script to populate the database
 * This script can be run from the project root directory
 * 
 * Usage: npm run populate
 * 
 * This script properly handles paths with spaces (e.g., "UBCO Courses")
 * by changing to the backend directory and using a relative path.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Get absolute paths to avoid issues with spaces in directory names
const rootDir = __dirname;
const backendDir = path.resolve(rootDir, '../app/backend');
const backendScriptPath = path.resolve(backendDir, 'scripts/populateDatabase.js');

// Verify the script exists
if (!fs.existsSync(backendScriptPath)) {
  console.error(`❌ Error: Script not found at ${backendScriptPath}`);
  process.exit(1);
}

console.log('🚀 Starting database population script...');
console.log(`📁 Backend directory: ${backendDir}`);
console.log(`📄 Script path: ${backendScriptPath}\n`);

// Save original working directory
const originalCwd = process.cwd();

// Change to backend directory to avoid path issues with spaces
process.chdir(backendDir);

// Use relative path from backend directory
const scriptRelativePath = path.relative(backendDir, backendScriptPath);

// Run the backend populate script
// Using shell: false with relative path to avoid path parsing issues
const child = spawn('node', [scriptRelativePath], {
  stdio: 'inherit',
  shell: false,
  cwd: backendDir,
  env: { ...process.env }
});

child.on('error', (error) => {
  console.error('❌ Error running populate script:', error);
  // Restore original working directory
  process.chdir(originalCwd);
  process.exit(1);
});

child.on('exit', (code) => {
  // Restore original working directory
  process.chdir(originalCwd);
  
  if (code === 0) {
    console.log('\n✅ Database population completed successfully!');
  } else {
    console.error(`\n❌ Script exited with code ${code}`);
    process.exit(code);
  }
});

