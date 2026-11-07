// Remote input is JSON only. It is never interpreted as HTML or JavaScript.
export function validateRemoteData(data) {
  const text = value => typeof value === 'string' && value.length <= 20000;
  const list = value => Array.isArray(value) && value.length <= 1000 && value.every(text);
  if (!data || data.schemaVersion !== 1 || !text(data.guidelines) || !data.guidelines.trim())
    throw new Error('Unsupported triage feed');
  for (const stage of ['build', 'design']) {
    const snapshot = data[stage];
    const date = snapshot?.checkedAt;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date + 'T00:00:00Z')) ||
        new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date ||
        !Array.isArray(snapshot.projects) || snapshot.projects.length > 10000)
      throw new Error('Invalid snapshot');
    const ids = new Set();
    for (const p of snapshot.projects) {
      if (!p || typeof p.project_id !== 'string' || !/^\d+$/.test(p.project_id) ||
          ids.has(p.project_id) || !text(p.title) || !text(p.submitted) ||
          !['ready', 'not_shipped'].includes(p.verdict) || !list(p.fail) || !list(p.warn))
        throw new Error('Invalid project');
      for (const key of ['repo', 'demo'])
        if (p[key] != null && !text(p[key])) throw new Error('Invalid link');
      if (stage === 'design') {
        if (!text(p.tier) || !Number.isFinite(p.requested) || p.requested < 0 ||
            (p.bom_total != null && (!Number.isFinite(p.bom_total) || p.bom_total < 0)))
          throw new Error('Invalid funding');
      } else if (![p.devlogs, p.build_devlogs].every(n => Number.isInteger(n) && n >= 0)) {
        throw new Error('Invalid devlogs');
      }
      ids.add(p.project_id);
    }
  }
  return data;
}
