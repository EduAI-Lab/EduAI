/** Fix remaining multiline ui/* imports → @eduai/ui */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const srcDir = path.join(frontendDir, 'src');
const QM_LOCAL = new Set(['tooltip', 'use-toast', 'DeleteConfirmationModal', 'DualRangeSlider', 'toast', 'toaster']);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'archive') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.(tsx?)$/.test(entry.name)) files.push(full);
  }
  return files;
}

const importRe =
  /import\s+(?:type\s+)?{([\s\S]*?)}\s+from\s+['"](?:@\/|\.\.?\/)+(?:components\/)?ui\/([^'"]+)['"];?\s*/g;

function migrate(content) {
  const eduai = new Set();
  const local = [];
  let changed = false;

  const without = content.replace(importRe, (_, namesBlock, mod) => {
    changed = true;
    const modClean = mod.replace(/\.tsx?$/, '');
    const names = namesBlock
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);
    if (QM_LOCAL.has(modClean)) local.push({ mod: modClean, names });
    else names.forEach((n) => eduai.add(n));
    return '';
  });

  if (!changed) return content;

  const imports = [];
  if (eduai.size) imports.push(`import { ${[...eduai].join(', ')} } from '@eduai/ui';`);
  for (const { mod, names } of local) {
    imports.push(`import { ${names.join(', ')} } from '@/components/ui/${mod}';`);
  }

  const idx = without.search(/^import\s/m);
  const merged =
    idx >= 0
      ? without.slice(0, idx) + imports.join('\n') + '\n' + without.slice(idx)
      : imports.join('\n') + '\n' + without;

  return merged.replace(/\n{3,}/g, '\n\n');
}

let n = 0;
for (const file of walk(srcDir)) {
  if (file.includes(`${path.sep}ui${path.sep}`)) continue;
  const raw = fs.readFileSync(file, 'utf8');
  if (!/(?:components\/)?ui\//.test(raw)) continue;
  const next = migrate(raw);
  if (next !== raw) {
    fs.writeFileSync(file, next);
    n++;
    console.log('fixed', path.relative(frontendDir, file));
  }
}
console.log(`Fixed ${n} files`);
