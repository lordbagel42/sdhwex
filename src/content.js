// Bundled locally with the snapshot and stylesheet by scripts/build.mjs.
function installTriage(buildSnapshot, cardCSS, designSnapshot) {
  'use strict';
  designSnapshot ??= { checkedAt: buildSnapshot.checkedAt, projects: [] };
  // Keep the existing host ID so cached pages and both distribution formats agree.
  const HOST_ID = 'build-queue-triage-card';
  const GUIDELINES = 'Please refer to https://codex.hackclub.com/shipping/101/ for the full shipping guidelines.';
  const TOOLS_ID = 'stardance-rejection-guidelines';
  let rejectionTools = null;
  let rejectionField = null;
  const queues = Object.fromEntries([['build', buildSnapshot], ['design', designSnapshot]].map(([stage, snapshot]) => [stage, {
    snapshot,
    projects: new Map(snapshot.projects.map(p => [p.project_id, p])),
    title: stage === 'design' ? 'Design queue triage' : 'Build queue triage',
    checkedAt: new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC'
    }).format(new Date(`${snapshot.checkedAt}T00:00:00Z`))
  }]));
  const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  let suspended = false;
  let scheduled = false;
  let currentHost = null;

  function projectID() {
    if (location.origin !== 'https://stardance.hackclub.com') return null;
    return location.pathname.match(/^\/admin\/certification\/hardware\/(\d+)\/?$/)?.[1] ?? null;
  }

  function reviewStage(id) {
    // Design funding and build certification share exactly the same URL. Prefer
    // the active-stage tag, never history entries or the project's old snapshot.
    const root = document.querySelector('.hardware-review');
    const tag = root?.querySelector('.hardware-review__header .hardware-review__tag')?.textContent.trim().toLowerCase();
    if (tag === 'design funding') return { stage: 'design', inferred: false };
    if (tag === 'build certification') return { stage: 'build', inferred: false };
    const back = root?.querySelector('.ship-review__back')?.textContent.toLowerCase() ?? '';
    if (/\bdesign queue\b/.test(back)) return { stage: 'design', inferred: false };
    if (/\bbuild queue\b/.test(back)) return { stage: 'build', inferred: false };
    const matches = Object.keys(queues).filter(stage => queues[stage].projects.has(id));
    // With no visible stage, one matching snapshot is useful but explicitly
    // labeled as inferred. An overlap is ambiguous: never guess between stages.
    return { stage: matches.length > 1 ? 'unknown' : matches[0] ?? 'build', inferred: true };
  }

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function safeLink(label, value) {
    try {
      const url = new URL(value);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
      const link = element('a', label);
      link.href = url.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      return link;
    } catch { return null; }
  }

  function feedback(p, stage) {
    return `Hey! Your project "${p.title}" isn't ready for ${stage} approval yet. Here's what's missing based on the shipping checklist:\n` +
      p.fail.map(f => '- ' + f).join('\n') +
      '\n\n' + GUIDELINES;
  }

  function syncRejectionButton(id) {
    const field = id ? document.querySelector('#hardware-permanent-rejection textarea#permanent-rejection-reason') : null;
    if (!field || !field.form) {
      document.getElementById(TOOLS_ID)?.remove();
      rejectionTools = null;
      rejectionField = null;
      return;
    }
    if (rejectionField === field && rejectionTools?.isConnected && field.nextElementSibling === rejectionTools) {
      const button = rejectionTools.querySelector('button');
      const disabled = field.disabled || field.readOnly || field.matches(':disabled');
      if (button.disabled !== disabled) button.disabled = disabled;
      return;
    }
    document.getElementById(TOOLS_ID)?.remove();
    const tools = element('div');
    tools.id = TOOLS_ID;
    tools.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0';
    const button = element('button', 'Insert shipping guidelines', 'action-btn action-btn--small action-btn--secondary');
    button.type = 'button';
    button.setAttribute('aria-controls', field.id);
    button.title = 'Insert the shipping guidelines sentence at the cursor in the justification';
    button.disabled = field.disabled || field.readOnly || field.matches(':disabled');
    const status = element('span');
    status.setAttribute('role', 'status');
    status.style.cssText = 'font-size:12px;flex-basis:100%;overflow-wrap:anywhere';
    // Prevent a mouse/touch click from moving focus out of the textarea. Keyboard
    // activation also works: textarea selectionStart/End survive tabbing away.
    button.addEventListener('pointerdown', event => {
      if (event.button === 0) event.preventDefault();
    });
    button.addEventListener('click', () => {
      if (!field.isConnected || !field.closest('#hardware-permanent-rejection') ||
          field.disabled || field.readOnly || field.matches(':disabled')) return;
      const start = field.selectionStart;
      const end = field.selectionEnd;
      if (field.maxLength >= 0 && field.value.length - (end - start) + GUIDELINES.length > field.maxLength) {
        status.textContent = 'Not enough space for the full sentence. Shorten the justification or select text to replace.';
        field.focus();
        return;
      }
      const before = new InputEvent('beforeinput', {
        bubbles: true, composed: true, cancelable: true, inputType: 'insertText', data: GUIDELINES
      });
      if (!field.dispatchEvent(before)) {
        status.textContent = 'Insertion was blocked by the page. You can paste the guidelines manually.';
        return;
      }
      field.setRangeText(GUIDELINES, start, end, 'end');
      field.focus();
      field.dispatchEvent(new InputEvent('input', {
        bubbles: true, composed: true, inputType: 'insertText', data: GUIDELINES
      }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      status.textContent = 'Guidelines inserted. Nothing was submitted.';
    });
    tools.append(button, status);
    field.after(tools);
    rejectionTools = tools;
    rejectionField = field;
  }

  function findings(root, title, items, kind) {
    if (!items.length) return;
    const section = element('section', undefined, kind);
    section.append(element('h3', `${title} (${items.length})`));
    const list = element('ul');
    for (const item of items) list.append(element('li', item));
    section.append(list);
    root.append(section);
  }

  function makeCard(id, stage, inferred) {
    const queue = queues[stage];
    const title = queue?.title ?? 'Queue triage';
    const host = element('section', undefined, 'ship-review__panel');
    host.id = HOST_ID;
    host.dataset.projectId = id;
    host.dataset.stage = stage;
    host.dataset.inferred = String(inferred);
    host.setAttribute('aria-label', `${title} for project ${id}`);
    host.style.minWidth = '0';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = element('style', cardCSS);
    const card = element('div', undefined, 'triage');
    const header = element('header');
    header.append(element('h2', title));
    card.append(header);
    if (!queue) {
      card.append(element('p', `Project #${id} appears in both snapshots, but the current review stage could not be detected. Reload the review page to show its Design funding or Build certification label. No findings are shown to avoid mixing stages.`));
      shadow.append(style, card);
      return host;
    }
    const { snapshot, checkedAt, projects } = queue;
    const source = element('p', undefined, 'source');
    source.append('Snapshot checked ');
    const time = element('time', checkedAt);
    time.dateTime = snapshot.checkedAt;
    source.append(time, ' · Not a live check');
    card.append(source);
    const p = projects.get(id);
    if (inferred && p) card.append(element('p', `Review stage not detected; showing the ${stage} snapshot matching this project ID. Confirm the review stage before using these notes.`, 'note'));
    if (!p) {
      card.append(element('p', `Project #${id} is not in this ${snapshot.projects.length}-project snapshot. This does not mean it passed or failed.`));
      card.append(element('p', `Review the current project manually. To add newer ${stage} findings, import a newer triage report and rebuild.`, 'note'));
    } else {
      header.append(element('span', p.verdict === 'ready' ? 'Looks ready' : 'Not shipped', `badge ${p.verdict === 'ready' ? 'ready' : 'failed'}`));
      card.append(element('p', `${p.title} · #${id}`, 'project'));
      const metadata = stage === 'design'
        ? `Submitted ${p.submitted} · Tier ${p.tier} · Requested ${dollars.format(p.requested)}` +
          (p.bom_total == null ? '' : ` · BOM total ${dollars.format(p.bom_total)}`)
        : `Submitted ${p.submitted} · Devlogs: ${p.build_devlogs} build / ${p.devlogs} total`;
      card.append(element('p', metadata, 'meta'));
      findings(card, 'Failed checks', p.fail, 'failures');
      findings(card, 'Warnings — verify by hand', p.warn, 'warnings');
      if (!p.fail.length) card.append(element('p', 'No automated checks failed in this snapshot. This is not an approval.', 'note'));
      const actions = element('div', undefined, 'actions');
      // The design export's `demo` field contains an amount, not a demo URL.
      const links = stage === 'design' ? [['Repository', p.repo]] : [['Repository', p.repo], ['Demo link', p.demo]];
      for (const [label, value] of links) {
        const link = safeLink(label, value);
        if (link) actions.append(link);
      }
      if (p.fail.length) {
        const copy = element('button', 'Copy feedback draft');
        copy.type = 'button';
        const status = element('span', '', 'copy-status');
        status.setAttribute('role', 'status');
        copy.addEventListener('click', async () => {
          copy.disabled = true;
          status.textContent = '';
          try {
            await navigator.clipboard.writeText(feedback(p, stage));
            status.textContent = 'Copied. Verify the findings before sending.';
          } catch {
            status.textContent = 'Clipboard unavailable. Select and copy the draft below.';
            let draft = card.querySelector('textarea');
            if (!draft) {
              draft = element('textarea');
              draft.readOnly = true;
              draft.rows = 7;
              draft.setAttribute('aria-label', 'Feedback draft — copy manually');
              draft.value = feedback(p, stage);
              card.append(draft);
            }
            draft.focus();
            draft.select();
          } finally { copy.disabled = false; }
        });
        actions.append(copy, status);
      }
      card.append(actions);
    }
    const details = element('details');
    details.append(element('summary', 'About these checks'));
    details.append(element('p', stage === 'design'
      ? 'Imported from Design Queue Triage. Repo trees, READMEs and root CSVs were checked on GitHub; tier and requested amount came from the Stardance database. Build-only requirements (demo video, build devlogs, build photo) were skipped. Firmware was required when the README or BOM named a microcontroller; PCB source when the README mentioned a PCB.'
      : 'Imported from Build Queue Triage. Repo trees, READMEs and root CSVs were checked on GitHub; demo hosts were classified; devlog phase and media counts came from the Stardance database. Firmware was required when the README or BOM named a microcontroller; PCB source when the README mentioned a PCB.'));
    details.append(element('p', stage === 'design'
      ? 'Still needs a human: full STEP assembly with electronics, design screenshots, originality, and AI-writing flags. Links, files and funding requests may have changed since the snapshot. This tool never submits or decides a review. Justification text is inserted only when you click its button.'
      : 'Still needs a human: full STEP assembly with electronics, render vs. build photos, originality, and AI-writing flags. Links, files and devlogs may have changed since the snapshot. This tool never submits or decides a review. Justification text is inserted only when you click its button.'));
    card.append(details);
    shadow.append(style, card);
    return host;
  }

  function sync() {
    if (suspended) return;
    const id = projectID();
    syncRejectionButton(id);
    // Use the exact details column from Stardance's hardware_reviews/show view.
    // Do not put findings into the decision/claim sidebar or unrelated pages.
    const container = document.querySelector('.hardware-review .ship-review__details');
    const existing = document.getElementById(HOST_ID);
    if (!id || !container) {
      existing?.remove();
      currentHost = null;
      return;
    }
    const { stage, inferred } = reviewStage(id);
    if (existing?.dataset.projectId === id && existing.dataset.stage === stage &&
        existing.dataset.inferred === String(inferred) && existing.parentElement === container && existing.shadowRoot) {
      currentHost = existing;
      return;
    }
    existing?.remove();
    currentHost = makeCard(id, stage, inferred);
    container.prepend(currentHost);
  }

  function schedule() {
    if (scheduled || suspended) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; sync(); });
  }

  const observer = new MutationObserver(records => {
    // Ignore changes inside our own card; Turbo frame/page replacements still trigger sync.
    if (records.some(record => record.type === 'attributes'
      ? record.target.matches('#hardware-permanent-rejection textarea#permanent-rejection-reason, #hardware-permanent-rejection fieldset')
      : !currentHost?.contains(record.target) && !rejectionTools?.contains(record.target))) schedule();
  });
  observer.observe(document.documentElement, {
    childList: true, characterData: true, subtree: true,
    attributes: true, attributeFilter: ['disabled', 'readonly', 'maxlength']
  });
  for (const event of ['turbo:load', 'turbo:render', 'turbo:frame-load']) {
    document.addEventListener(event, () => { suspended = false; schedule(); });
  }
  document.addEventListener('turbo:before-cache', () => {
    suspended = true;
    document.getElementById(HOST_ID)?.remove();
    document.getElementById(TOOLS_ID)?.remove();
    currentHost = null;
    rejectionTools = null;
    rejectionField = null;
  });
  window.addEventListener('popstate', schedule);
  window.addEventListener('pageshow', () => { suspended = false; schedule(); });
  // pushState has no standard event, and isolated extension scripts cannot patch
  // the page's history object. Check only the URL, without rerendering on a timer.
  let lastURL = location.href;
  window.setInterval(() => {
    if (lastURL !== location.href) { lastURL = location.href; schedule(); }
  }, 750);
  sync();
}
