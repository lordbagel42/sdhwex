import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const bundle = await readFile(new URL('../dist/chrome/content.js', import.meta.url), 'utf8');
const design = JSON.parse(await readFile(new URL('../data/design-snapshot.json', import.meta.url)));
const build = JSON.parse(await readFile(new URL('../data/snapshot.json', import.meta.url)));
const source = await readFile(new URL('../src/content.js', import.meta.url), 'utf8');
const guidelines = 'Please refer to https://codex.hackclub.com/shipping/101/ for the full shipping guidelines.';
const wait = () => new Promise(resolve => setTimeout(resolve, 50));
const host = dom => dom.window.document.getElementById('build-queue-triage-card');
const card = dom => host(dom).shadowRoot;
function setup(id, stage = 'Design funding', script = bundle) {
  const dom = new JSDOM(`<main class="hardware-review"><header class="hardware-review__header"><span class="hardware-review__tag"></span></header><section class="ship-review__details"></section><form><textarea id="review">Existing draft</textarea></form></main>`, {
    url: `https://stardance.hackclub.com/admin/certification/hardware/${id}`,
    runScripts: 'outside-only', pretendToBeVisual: true
  });
  dom.window.document.querySelector('.hardware-review__tag').textContent = stage;
  dom.window.eval(script);
  return dom;
}
function close(dom) {
  dom.window.document.dispatchEvent(new dom.window.Event('turbo:before-cache'));
  dom.window.close();
}

test('all 175 design records render verbatim, with funding data and without build metadata/demo links', () => {
  assert.equal(design.projects.length, 175);
  assert.equal(new Set(design.projects.map(p => p.project_id)).size, 175);
  assert.equal(design.checkedAt, '2026-11-04');
  for (const project of design.projects) {
    const dom = setup(project.project_id);
    try {
      assert.equal(host(dom).dataset.stage, 'design');
      assert.equal(card(dom).querySelector('h2').textContent, 'Design queue triage');
      assert.equal(card(dom).querySelector('.project').textContent, `${project.title} · #${project.project_id}`);
      assert.deepEqual([...card(dom).querySelectorAll('.failures li')].map(li => li.textContent), project.fail);
      assert.deepEqual([...card(dom).querySelectorAll('.warnings li')].map(li => li.textContent), project.warn);
      const meta = card(dom).querySelector('.meta').textContent;
      assert.ok(meta.includes(`Tier ${project.tier}`));
      assert.ok(meta.includes(new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(project.requested)));
      assert.ok(!meta.includes('Devlogs') && !meta.includes('undefined') && !meta.includes('NaN'));
      assert.ok(![...card(dom).querySelectorAll('a')].some(a => a.textContent === 'Demo link'));
      assert.ok(card(dom).querySelector('details').textContent.includes('Build-only requirements (demo video, build devlogs, build photo) were skipped.'));
      assert.equal(card(dom).querySelectorAll('button').length, project.fail.length ? 1 : 0);
    } finally { close(dom); }
  }
});

test('design feedback uses design approval and exact requested Codex ending, never warnings', async () => {
  const project = design.projects.find(p => p.fail.length && p.warn.length);
  const dom = setup(project.project_id);
  try {
    let copied;
    Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: async text => { copied = text; } } });
    card(dom).querySelector('button').click();
    await wait();
    assert.equal(copied, `Hey! Your project "${project.title}" isn't ready for design approval yet. Here's what's missing based on the shipping checklist:\n` + project.fail.map(f => '- ' + f).join('\n') + '\n\n' + guidelines);
    for (const warning of project.warn) assert.ok(!copied.includes(warning));
    assert.equal(dom.window.document.getElementById('review').value, 'Existing draft');
  } finally { close(dom); }
});

test('design manual-copy fallback also uses new guidelines', async () => {
  const dom = setup('55399');
  try {
    card(dom).querySelector('button').click();
    await wait();
    const text = card(dom).querySelector('textarea').value;
    assert.ok(text.endsWith(guidelines));
    assert.ok(!text.includes('Fix these') && !text.includes('resubmit for funding'));
  } finally { close(dom); }
});

test('the live review stage wins over membership in the other snapshot', async () => {
  for (const [id, label, expectedCount] of [['44495', 'Design funding', 175], ['55399', 'Build certification', 237]]) {
    const dom = setup(id, label);
    try {
      assert.match(card(dom).textContent, new RegExp(`not in this ${expectedCount}-project snapshot`));
      assert.equal(card(dom).querySelectorAll('.failures li, .badge, button').length, 0);
    } finally { close(dom); }
  }
});

test('same-URL active stage updates replace the card once, including characterData changes', async () => {
  const dom = setup('55399');
  try {
    const tag = dom.window.document.querySelector('.hardware-review__tag');
    tag.firstChild.data = 'Build certification';
    await wait();
    assert.equal(host(dom).dataset.stage, 'build');
    assert.equal(card(dom).querySelectorAll('.failures li').length, 0);
    tag.textContent = 'Design funding';
    await wait();
    assert.equal(host(dom).dataset.stage, 'design');
    assert.equal(card(dom).querySelectorAll('.failures li').length, 2);
    assert.equal(dom.window.document.querySelectorAll('#build-queue-triage-card').length, 1);
  } finally { close(dom); }
});

test('missing stage falls back to unique membership with explicit warning; back link is preferred', async () => {
  const dom = setup('55399', '');
  try {
    assert.equal(host(dom).dataset.stage, 'design');
    assert.match(card(dom).textContent, /Review stage not detected/);
    const back = dom.window.document.createElement('a');
    back.className = 'ship-review__back';
    back.textContent = '← back to build queue';
    dom.window.document.querySelector('.hardware-review').prepend(back);
    await wait();
    assert.equal(host(dom).dataset.stage, 'build');
    assert.equal(card(dom).querySelectorAll('.failures li').length, 0);
  } finally { close(dom); }
});

test('ambiguous overlapping IDs never mix stages; explicit active tag resolves ambiguity', async () => {
  const overlapping = { ...design, projects: [{ ...design.projects[2], project_id: '44495' }] };
  const script = source + `\ninstallTriage(${JSON.stringify(build)}, '', ${JSON.stringify(overlapping)});`;
  const dom = setup('44495', '', script);
  try {
    assert.equal(host(dom).dataset.stage, 'unknown');
    assert.match(card(dom).textContent, /appears in both snapshots/);
    assert.equal(card(dom).querySelectorAll('.failures li, .badge, button').length, 0);
    dom.window.document.querySelector('.hardware-review__tag').textContent = 'Design funding';
    await wait();
    assert.equal(host(dom).dataset.stage, 'design');
    assert.equal(card(dom).querySelectorAll('.failures li').length, 2);
  } finally { close(dom); }
});

test('unknown design project shows design snapshot count and no verdict', () => {
  const dom = setup('999999999');
  try {
    assert.match(card(dom).textContent, /Design queue triage/);
    assert.match(card(dom).textContent, /not in this 175-project snapshot/);
    assert.equal(card(dom).querySelector('.badge'), null);
  } finally { close(dom); }
});

test('design card survives Turbo caching, navigation to build projects, and return', async () => {
  const dom = setup('55399');
  try {
    dom.window.document.dispatchEvent(new dom.window.Event('turbo:before-cache'));
    assert.equal(host(dom), null);
    dom.window.document.dispatchEvent(new dom.window.Event('turbo:load'));
    await wait();
    assert.equal(host(dom).dataset.stage, 'design');
    dom.window.history.pushState({}, '', '/admin/certification/hardware/44495');
    dom.window.document.querySelector('.hardware-review__tag').textContent = 'Build certification';
    await wait();
    assert.equal(host(dom).dataset.stage, 'build');
    assert.equal(card(dom).querySelectorAll('.failures li').length, 5);
  } finally { close(dom); }
});

test('Chrome and userscript bundles are identical apart from metadata', async () => {
  const user = await readFile(new URL('../dist/stardance-triage.user.js', import.meta.url), 'utf8');
  assert.ok(user.endsWith(bundle));
  assert.ok(!bundle.includes('Fix these and reship'));
  assert.ok(bundle.includes(guidelines));
});
