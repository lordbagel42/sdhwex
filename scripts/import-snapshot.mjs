import { readFile, writeFile, mkdir } from 'node:fs/promises';

// Parse JSON only; never execute scripts from an imported HTML file.
const [path, checkedAt, stage = 'build'] = process.argv.slice(2);
if (!path || !['build', 'design'].includes(stage) || !/^\d{4}-\d{2}-\d{2}$/.test(checkedAt ?? '') ||
    !Number.isFinite(Date.parse(checkedAt)) || new Date(checkedAt).toISOString().slice(0, 10) !== checkedAt) {
  throw new Error('Usage: npm run import -- /path/to/triage.html-or.json YYYY-MM-DD [build|design]');
}
const input = await readFile(path, 'utf8');
let projects;
if (path.toLowerCase().endsWith('.json')) {
  projects = JSON.parse(input);
} else {
  const match = input.match(/const DATA\s*=\s*(\[[\s\S]*?\]);\s*(?:\r?\n|const KEYS)/);
  if (!match) throw new Error('Could not find the DATA JSON array.');
  projects = JSON.parse(match[1]);
}
if (!Array.isArray(projects) || !projects.length) throw new Error('Empty or invalid project data.');
const ids = new Set();
for (const p of projects) {
  if (!/^\d+$/.test(p.project_id) || ids.has(p.project_id) ||
      !['ready', 'not_shipped'].includes(p.verdict) ||
      !['title', 'submitted', 'repo', 'review_url'].every(k => typeof p[k] === 'string') ||
      !['fail', 'warn'].every(k => Array.isArray(p[k]) && p[k].every(v => typeof v === 'string')) ||
      (stage === 'build'
        ? typeof p.demo !== 'string' || !['devlogs', 'build_devlogs'].every(k => Number.isSafeInteger(p[k]) && p[k] >= 0)
        : (p.ship_id !== undefined && !/^\d+$/.test(p.ship_id)) ||
          (p.demo !== undefined && typeof p.demo !== 'string') || typeof p.tier !== 'string' ||
          !Number.isFinite(p.requested) || p.requested < 0 ||
          !(p.bom_total == null || (Number.isFinite(p.bom_total) && p.bom_total >= 0)))) {
    throw new Error(`Invalid or duplicate record: ${p.project_id}`);
  }
  ids.add(p.project_id);
}
await mkdir(new URL('../data/', import.meta.url), { recursive: true });
const destination = stage === 'design' ? '../data/design-snapshot.json' : '../data/snapshot.json';
await writeFile(new URL(destination, import.meta.url), JSON.stringify({ checkedAt, projects }, null, 2) + '\n');
console.log(`Imported ${projects.length} ${stage} projects, checked ${checkedAt}. Run npm run build next.`);
