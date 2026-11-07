import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const bundle = await readFile(new URL('../dist/chrome/content.js', import.meta.url), 'utf8');
const text = 'Please refer to https://codex.hackclub.com/shipping/101/ for the full shipping guidelines.';
const popup = '<dialog id="hardware-permanent-rejection"><form><label for="permanent-rejection-reason">Justification (required)</label><textarea id="permanent-rejection-reason" name="reason" maxlength="10000"></textarea><div><button type="submit">Permanently reject</button></div></form></dialog>';
const tools = dom => dom.window.document.getElementById('stardance-rejection-guidelines');
const field = dom => dom.window.document.getElementById('permanent-rejection-reason');
const button = dom => tools(dom).querySelector('button');
const wait = () => new Promise(resolve => setTimeout(resolve, 50));
function setup(path = '/admin/certification/hardware/44495', html = popup) {
  const dom = new JSDOM(`<main class="hardware-review"><section class="ship-review__details"></section>${html}<textarea id="unrelated">Untouched</textarea></main>`, {
    url: 'https://stardance.hackclub.com' + path, runScripts: 'outside-only', pretendToBeVisual: true
  });
  dom.window.eval(bundle);
  return dom;
}
function close(dom) {
  dom.window.document.dispatchEvent(new dom.window.Event('turbo:before-cache'));
  dom.window.close();
}

for (const position of [0, 7, 14]) {
  test(`inserts exact text at cursor ${position}, preserving surrounding text and moving caret to end`, () => {
    const dom = setup();
    try {
      const area = field(dom);
      area.value = 'Before. After.';
      area.focus();
      area.setSelectionRange(position, position);
      button(dom).focus(); // Keyboard users tab away from the textarea.
      button(dom).click();
      assert.equal(area.value, 'Before. After.'.slice(0, position) + text + 'Before. After.'.slice(position));
      assert.equal(area.selectionStart, position + text.length);
      assert.equal(area.selectionEnd, position + text.length);
      assert.equal(dom.window.document.activeElement, area);
      assert.equal(dom.window.document.getElementById('unrelated').value, 'Untouched');
      assert.match(tools(dom).textContent, /Nothing was submitted/);
    } finally { close(dom); }
  });
}

test('inserts into empty justification and replaces only selected text', () => {
  const dom = setup();
  try {
    button(dom).click();
    assert.equal(field(dom).value, text);
    field(dom).value = 'Keep REPLACE this.';
    field(dom).setSelectionRange(5, 12);
    button(dom).click();
    assert.equal(field(dom).value, 'Keep ' + text + ' this.');
  } finally { close(dom); }
});

test('mouse activation preserves focus; input/change notify the page but never submit', () => {
  const dom = setup();
  try {
    const area = field(dom);
    let submissions = 0;
    const events = [];
    area.form.addEventListener('submit', event => { submissions++; event.preventDefault(); });
    for (const name of ['beforeinput', 'input', 'change']) area.form.addEventListener(name, event => events.push(event));
    const down = new dom.window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
    button(dom).dispatchEvent(down);
    assert.ok(down.defaultPrevented);
    assert.equal(button(dom).type, 'button');
    assert.equal(button(dom).getAttribute('aria-controls'), area.id);
    button(dom).click();
    assert.equal(submissions, 0);
    assert.deepEqual(events.map(e => e.type), ['beforeinput', 'input', 'change']);
    assert.equal(events[1].data, text);
    assert.equal(events[1].inputType, 'insertText');
  } finally { close(dom); }
});

test('honors maxlength without truncating or deleting existing text; selection can free enough space', () => {
  const dom = setup();
  try {
    const area = field(dom);
    area.maxLength = text.length;
    area.value = 'Keep';
    area.setSelectionRange(2, 2);
    button(dom).click();
    assert.equal(area.value, 'Keep');
    assert.equal(area.selectionStart, 2);
    assert.match(tools(dom).textContent, /Not enough space/);
    area.setSelectionRange(0, 4);
    button(dom).click();
    assert.equal(area.value, text);
  } finally { close(dom); }
});

test('respects beforeinput cancellation', () => {
  const dom = setup();
  try {
    field(dom).value = 'Keep';
    field(dom).addEventListener('beforeinput', event => event.preventDefault());
    button(dom).click();
    assert.equal(field(dom).value, 'Keep');
    assert.match(tools(dom).textContent, /blocked by the page/);
  } finally { close(dom); }
});

test('readonly, disabled, and disabled fieldsets prevent editing; reenable updates the button', async () => {
  const dom = setup();
  try {
    for (const attribute of ['readonly', 'disabled']) {
      field(dom).setAttribute(attribute, '');
      await wait();
      assert.ok(button(dom).disabled);
      button(dom).click();
      assert.equal(field(dom).value, '');
      field(dom).removeAttribute(attribute);
      await wait();
      assert.equal(button(dom).disabled, false);
    }
    const group = dom.window.document.createElement('fieldset');
    field(dom).before(group);
    group.append(field(dom));
    group.disabled = true;
    await wait();
    assert.ok(button(dom).disabled);
    group.disabled = false;
    await wait();
    assert.equal(button(dom).disabled, false);
  } finally { close(dom); }
});

test('only the exact permanent-rejection popup is enhanced, not unrelated forms or routes', () => {
  for (const [path, html] of [
    ['/projects/44495', popup],
    ['/admin/certification/hardware/44495', popup.replace('hardware-permanent-rejection', 'fraud-report')],
    ['/admin/certification/hardware/44495', popup.replace('permanent-rejection-reason', 'other-reason').replace('id="permanent-rejection-reason"', 'id="other-reason"')],
    ['/admin/certification/hardware/44495', popup.replace('<form>', '').replace('</form>', '')]
  ]) {
    const dom = setup(path, html);
    try { assert.equal(tools(dom), null); } finally { close(dom); }
  }
});

test('dynamic popup insertion, rerenders and Turbo caches leave one working button', async () => {
  const dom = setup(undefined, '');
  try {
    dom.window.document.querySelector('main').insertAdjacentHTML('beforeend', popup);
    await wait();
    field(dom).value = 'Draft';
    dom.window.document.dispatchEvent(new dom.window.Event('turbo:render'));
    await wait();
    assert.equal(dom.window.document.querySelectorAll('#stardance-rejection-guidelines').length, 1);
    assert.equal(field(dom).value, 'Draft');
    dom.window.document.dispatchEvent(new dom.window.Event('turbo:before-cache'));
    assert.equal(tools(dom), null);
    dom.window.document.dispatchEvent(new dom.window.Event('turbo:load'));
    await wait();
    button(dom).click();
    assert.equal(field(dom).value, 'Draft' + text);
    dom.window.document.querySelector('dialog').outerHTML = popup;
    await wait();
    assert.equal(dom.window.document.querySelectorAll('#stardance-rejection-guidelines').length, 1);
    button(dom).click();
    assert.equal(field(dom).value, text);
  } finally { close(dom); }
});

test('works for unknown projects too, and navigating away removes the enhancement', async () => {
  const dom = setup('/admin/certification/hardware/999999999');
  try {
    assert.ok(tools(dom));
    dom.window.history.pushState({}, '', '/projects/999999999');
    dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
    await wait();
    assert.equal(tools(dom), null);
  } finally { close(dom); }
});
