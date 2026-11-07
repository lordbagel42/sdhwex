import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const bundle = await readFile(new URL('../dist/chrome/content.js', import.meta.url), 'utf8');
const snapshot = JSON.parse(await readFile(new URL('../data/snapshot.json', import.meta.url)));
const markup = '<main class="hardware-review"><section class="ship-review__details"><div id="original">Existing evidence</div></section><aside><form><textarea id="review">Existing draft</textarea><button>Submit</button></form></aside></main>';
function setup(path = '/admin/certification/hardware/44495', html = markup, origin = 'https://stardance.hackclub.com') {
  const dom = new JSDOM(html, { url: origin + path, runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.eval(bundle);
  const nativeClose = dom.window.close.bind(dom.window);
  dom.window.close = () => {
    dom.window.document.dispatchEvent(new dom.window.Event('turbo:before-cache'));
    nativeClose();
  };
  return dom;
}
const host = dom => dom.window.document.getElementById('build-queue-triage-card');
const card = dom => host(dom)?.shadowRoot;
const settle = () => new Promise(resolve => setTimeout(resolve, 50));
function close(dom) {
  // Suspend the observer before jsdom tears down its document; otherwise its
  // close() mutations can schedule an animation frame against a closed window.
  dom.window.document.dispatchEvent(new dom.window.Event('turbo:before-cache'));
  dom.window.close();
}

test('all 237 original records are bundled without changing their findings', () => {
  assert.equal(snapshot.projects.length, 237);
  assert.equal(new Set(snapshot.projects.map(p => p.project_id)).size, 237);
  assert.equal(snapshot.checkedAt, '2026-11-04');
  for (const project of snapshot.projects) {
    const dom = setup(`/admin/certification/hardware/${project.project_id}`);
    try {
      assert.match(card(dom).textContent, /Not a live check/);
      for (const finding of [...project.fail, ...project.warn]) assert.ok(card(dom).textContent.includes(finding));
      assert.equal(card(dom).querySelectorAll('.failures li').length, project.fail.length);
      assert.equal(card(dom).querySelectorAll('.warnings li').length, project.warn.length);
    } finally { dom.window.close(); }
  }
});

test('44495 is first in details and leaves review forms untouched', () => {
  const dom = setup();
  try {
    assert.equal(host(dom).parentElement.firstElementChild, host(dom));
    assert.match(card(dom).textContent, /3d printer live view/);
    assert.equal(card(dom).querySelectorAll('.failures li').length, 5);
    assert.equal(dom.window.document.getElementById('review').value, 'Existing draft');
    assert.equal(card(dom).querySelector('button').type, 'button');
    assert.equal(card(dom).querySelector('a').rel, 'noopener noreferrer');
  } finally { dom.window.close(); }
});

test('query strings, hashes, and trailing slash still identify project', () => {
  const dom = setup('/admin/certification/hardware/44495/?queue=build#notes');
  assert.equal(host(dom).dataset.projectId, '44495');
  dom.window.close();
});

for (const path of ['/admin/certification/hardware', '/admin/certification/hardware/44495/recordings', '/admin/certification/hardware/nope', '/projects/44495']) {
  test(`does not insert on ${path}`, () => {
    const dom = setup(path);
    assert.equal(host(dom), null);
    dom.window.close();
  });
}

test('does not run on another origin or on a page without hardware details', () => {
  for (const dom of [setup('/admin/certification/hardware/44495', markup, 'https://example.com'), setup(undefined, '<main>Login</main>')]) {
    assert.equal(host(dom), null);
    dom.window.close();
  }
});

test('unknown project is explicitly unknown, not ready', () => {
  const dom = setup('/admin/certification/hardware/999999999');
  assert.match(card(dom).textContent, /not in this 237-project snapshot/);
  assert.equal(card(dom).querySelector('.badge'), null);
  assert.equal(card(dom).querySelector('button'), null);
  dom.window.close();
});

test('ready projects show advisory and no rejection feedback button', () => {
  const dom = setup('/admin/certification/hardware/33732');
  assert.match(card(dom).textContent, /Looks ready/);
  assert.match(card(dom).textContent, /not an approval/);
  assert.equal(card(dom).querySelector('button'), null);
  dom.window.close();
});

test('copy uses snapshot feedback, never warnings, without submitting', async () => {
  const dom = setup();
  try {
    let copied;
    Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: async value => { copied = value; } } });
    card(dom).querySelector('button').click();
    await settle();
    assert.match(copied, /Your project "3d printer live view"/);
    assert.match(copied, /- no \.STEP assembly in repo/);
    assert.ok(copied.endsWith('Please refer to https://codex.hackclub.com/shipping/101/ for the full shipping guidelines.'));
    assert.ok(!copied.includes('Fix these and reship'));
    assert.match(card(dom).querySelector('[role=status]').textContent, /Copied/);
    assert.equal(dom.window.document.getElementById('review').value, 'Existing draft');
  } finally { dom.window.close(); }
});

test('denied clipboard provides selectable manual fallback', async () => {
  const dom = setup();
  try {
    Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: async () => { throw Error('Denied'); } } });
    card(dom).querySelector('button').click();
    await settle();
    const draft = card(dom).querySelector('textarea');
    assert.ok(draft.readOnly);
    assert.match(draft.value, /Here's what's missing/);
    assert.equal(draft.selectionEnd, draft.value.length);
    assert.equal(card(dom).querySelector('button').disabled, false);
  } finally { dom.window.close(); }
});

test('Turbo caching removes card; restore and repeated loads recreate once', async () => {
  const dom = setup();
  try {
    dom.window.document.dispatchEvent(new dom.window.Event('turbo:before-cache'));
    assert.equal(host(dom), null);
    await settle();
    assert.equal(host(dom), null);
    for (let i = 0; i < 3; i++) dom.window.document.dispatchEvent(new dom.window.Event('turbo:load'));
    await settle();
    assert.ok(card(dom));
    assert.equal(dom.window.document.querySelectorAll('#build-queue-triage-card').length, 1);
  } finally { dom.window.close(); }
});

test('Turbo replacement, cached light DOM and history navigation refresh correctly', async () => {
  const dom = setup();
  try {
    const column = host(dom).parentElement;
    column.innerHTML = '<section id="build-queue-triage-card" data-project-id="44495"></section>';
    await settle();
    assert.ok(card(dom));
    dom.window.history.pushState({}, '', '/admin/certification/hardware/33732');
    dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
    await settle();
    assert.match(card(dom).textContent, /Gridfinity tape dispenser/);
    dom.window.history.pushState({}, '', '/projects/44495');
    dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
    await settle();
    assert.equal(host(dom), null);
  } finally { dom.window.close(); }
});

test('URL-only pushState and navigation from a queue page are handled', async () => {
  const dom = setup('/admin/certification/hardware');
  try {
    assert.equal(host(dom), null);
    dom.window.history.pushState({}, '', '/admin/certification/hardware/44495');
    await new Promise(resolve => setTimeout(resolve, 850));
    assert.ok(card(dom));
  } finally { dom.window.close(); }
});

test('snapshot strings render as text and unsafe links are omitted', async () => {
  const source = await readFile(new URL('../src/content.js', import.meta.url), 'utf8');
  const dom = new JSDOM(markup, { url: 'https://stardance.hackclub.com/admin/certification/hardware/1', runScripts: 'outside-only', pretendToBeVisual: true });
  try {
    const malicious = { checkedAt: '2026-11-04', projects: [{ project_id: '1', title: '<img src=x onerror=alert(1)>', verdict: 'not_shipped', submitted: '2026-11-01', devlogs: 0, build_devlogs: 0, fail: ['<script>alert(1)</script>'], warn: [], repo: 'javascript:alert(1)', demo: 'data:text/html,test' }] };
    dom.window.eval(source + `\ninstallTriage(${JSON.stringify(malicious)}, '');`);
    assert.equal(card(dom).querySelectorAll('img,script,a').length, 0);
    assert.ok(card(dom).textContent.includes(malicious.projects[0].title));
  } finally { close(dom); }
});
