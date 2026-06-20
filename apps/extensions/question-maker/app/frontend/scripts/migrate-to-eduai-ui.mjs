/**
 * One-time migration: consolidate QM local ui/* imports onto @eduai/ui.
 * Keeps QM-only widgets (tooltip, use-toast, DeleteConfirmationModal, DualRangeSlider).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const srcDir = path.join(frontendDir, 'src');

const QM_LOCAL = new Set([
  'tooltip',
  'use-toast',
  'DeleteConfirmationModal',
  'DualRangeSlider',
  'toast',
  'toaster',
]);

const UI_IMPORT_RE =
  /import\s+(?:type\s+)?{([^}]+)}\s+from\s+['"](?:@\/components\/ui\/|\.\.\/)+(?:ui\/|components\/ui\/)([^'"]+)['"];?\s*\n/g;

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'archive') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.(tsx?)$/.test(entry.name)) files.push(full);
  }
  return files;
}

function migrateFile(filePath) {
  if (filePath.includes(`${path.sep}ui${path.sep}`)) return false;

  let content = fs.readFileSync(filePath, 'utf8');
  const eduai = new Map();
  const local = new Map();

  let match;
  const re = new RegExp(UI_IMPORT_RE.source, 'g');
  while ((match = re.exec(content)) !== null) {
    const names = match[1]
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);
    const module = match[2].replace(/\.tsx?$/, '');
    const bucket = QM_LOCAL.has(module) ? local : eduai;
    for (const name of names) {
      const alias = name.match(/^(\w+)\s+as\s+(\w+)$/);
      if (alias) bucket.set(alias[2], alias[1]);
      else bucket.set(name, name);
    }
  }

  if (eduai.size === 0 && local.size === 0) return false;

  content = content.replace(UI_IMPORT_RE, '');

  const newImports = [];
  if (eduai.size > 0) {
    const names = [...eduai.entries()].map(([k, v]) => (k === v ? k : `${v} as ${k}`));
    newImports.push(`import { ${names.join(', ')} } from '@eduai/ui';`);
  }
  for (const [mod, names] of groupByModule(local)) {
    newImports.push(
      `import { ${names.join(', ')} } from '@/components/ui/${mod}';`,
    );
  }

  const importBlock = `${newImports.join('\n')}\n`;
  const firstImport = content.search(/^import\s/m);
  if (firstImport >= 0) {
    content = content.slice(0, firstImport) + importBlock + content.slice(firstImport);
  } else {
    content = importBlock + content;
  }

  content = content.replace(/\n{3,}/g, '\n\n');
  fs.writeFileSync(filePath, content);
  return true;
}

function groupByModule(local) {
  const byMod = new Map();
  for (const [imported, original] of local) {
    // reverse lookup module from name - we stored in local map without module key
    // re-parse isn't needed; use-toast and tooltip are unique modules
  }
  return local;
}

// Simpler second pass: group local imports by scanning original content
function migrateFileV2(filePath) {
  if (filePath.includes(`${path.sep}ui${path.sep}`)) return false;

  let content = fs.readFileSync(filePath, 'utf8');
  const eduaiNames = new Set();
  const localImports = [];

  const lines = content.split('\n');
  const kept = [];

  for (const line of lines) {
    const m = line.match(
      /^import\s+(?:type\s+)?{([^}]+)}\s+from\s+['"](?:@\/|\.\.?\/)+(?:components\/)?ui\/([^'"]+)['"];?\s*$/,
    );
    if (!m) {
      kept.push(line);
      continue;
    }
    const names = m[1].split(',').map((n) => n.trim()).filter(Boolean);
    const mod = m[2].replace(/\.tsx?$/, '');
    if (QM_LOCAL.has(mod)) {
      localImports.push({ mod, names });
    } else {
      for (const n of names) eduaiNames.add(n);
    }
  }

  if (eduaiNames.size === 0 && localImports.length === 0) return false;

  const newLines = [];
  if (eduaiNames.size > 0) {
    newLines.push(`import { ${[...eduaiNames].join(', ')} } from '@eduai/ui';`);
  }
  for (const { mod, names } of localImports) {
    newLines.push(`import { ${names.join(', ')} } from '@/components/ui/${mod}';`);
  }

  const firstImportIdx = kept.findIndex((l) => l.startsWith('import '));
  if (firstImportIdx >= 0) {
    kept.splice(firstImportIdx, 0, ...newLines, '');
  } else {
    kept.unshift(...newLines, '');
  }

  fs.writeFileSync(filePath, kept.join('\n'));
  return true;
}

let count = 0;
for (const file of walk(srcDir)) {
  if (migrateFileV2(file)) {
    count++;
    console.log('migrated', path.relative(frontendDir, file));
  }
}
console.log(`Done: ${count} files`);
