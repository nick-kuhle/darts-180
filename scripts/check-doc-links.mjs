import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const markdownFiles = [resolve(root, 'README.md'), ...walk(resolve(root, 'docs'))].filter((file) =>
  file.endsWith('.md'),
);
const broken = [];

for (const file of markdownFiles) {
  const markdown = readFileSync(file, 'utf8');
  for (const match of markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const rawTarget = match[1]?.trim() ?? '';
    const target = rawTarget.split(/[?#]/, 1)[0];
    if (
      target === '' ||
      target.startsWith('http://') ||
      target.startsWith('https://') ||
      target.startsWith('mailto:') ||
      target.startsWith('<')
    ) {
      continue;
    }
    const destination = resolve(dirname(file), target);
    if (!existsSync(destination)) {
      broken.push(`${relative(root, file)} → ${rawTarget}`);
    }
  }
}

if (broken.length > 0) {
  console.error(
    'Broken relative documentation links:\n' + broken.map((item) => `- ${item}`).join('\n'),
  );
  process.exit(1);
}

console.log(`Documentation link check passed (${markdownFiles.length} Markdown files).`);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path) : statSync(path).isFile() ? [path] : [];
  });
}
