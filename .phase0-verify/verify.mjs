// Temporary Phase 0 verification driver. Uses Chrome over CDP with Node
// built-ins only. Deleted after verification.
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:5173';
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const results = [];
const consoleMessages = [];
let id = 0;
const pending = new Map();
let ws;

function send(method, params = {}) {
  const msgId = ++id;
  return new Promise((resolve, reject) => {
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evalJs(expression) {
  const res = await send('Runtime.evaluate', {
    expression: `(() => { ${expression} })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.exceptionDetails) {
    throw new Error(`eval failed: ${JSON.stringify(res.exceptionDetails.exception?.description ?? res.exceptionDetails)}`);
  }
  return res.result.value;
}

async function waitFor(expression, { timeout = 8000, label = expression } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await evalJs(`return !!(${expression});`)) return true;
    } catch {
      /* page mid-navigation */
    }
    await sleep(100);
  }
  throw new Error(`timeout waiting for: ${label}`);
}

async function goto(path) {
  await send('Page.navigate', { url: `${BASE}${path}` });
  await sleep(600);
  await waitFor(`document.querySelector('#root') && document.querySelector('#root').children.length > 0`, {
    label: `#root content after navigating to ${path}`,
  });
  await sleep(250);
}

const url = () => evalJs('return location.pathname;');

async function screenshot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  const file = `${SHOTS}${name}.png`;
  writeFileSync(file, Buffer.from(data, 'base64'));
  return file;
}

async function clickText(selector, text) {
  const ok = await evalJs(`
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const target = nodes.find((n) => n.textContent.trim() === ${JSON.stringify(text)});
    if (!target) return false;
    target.click();
    return true;
  `);
  if (!ok) throw new Error(`could not find ${selector} with text "${text}"`);
  await sleep(450);
}

async function setInput(selector, value) {
  const ok = await evalJs(`
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  `);
  if (!ok) throw new Error(`input not found: ${selector}`);
  await sleep(120);
}

async function pressEnter(selector) {
  await evalJs(`document.querySelector(${JSON.stringify(selector)}).focus(); return true;`);
  for (const type of ['keyDown', 'char', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type,
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
      text: '\r',
      unmodifiedText: '\r',
    });
  }
  await sleep(600);
}

function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`);
}

async function main() {
  const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const page = targets.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(msg.params.type)) {
      consoleMessages.push(
        `[console.${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ')}`,
      );
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleMessages.push(`[exception] ${msg.params.exceptionDetails.exception?.description ?? 'unknown'}`);
    }
    if (msg.method === 'Log.entryAdded' && ['error', 'warning'].includes(msg.params.entry.level)) {
      consoleMessages.push(`[log.${msg.params.entry.level}] ${msg.params.entry.text}`);
    }
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');

  // start from a clean, logged-out session
  await goto('/login');
  await evalJs(`localStorage.clear(); return true;`);

  // 1 — protected route redirects when unauthenticated
  await goto('/dashboard');
  const c1 = await url();
  record('1. /dashboard redirects to /login when logged out', c1 === '/login', `final path: ${c1}`);

  const loginShape = await evalJs(`
    const t = document.body.innerText;
    return {
      logo: t.includes('OrganLink'),
      subtitle: t.includes('Transplant Operations Hub'),
      inputs: document.querySelectorAll('input').length,
      button: !!document.querySelector('button[type=submit]'),
    };
  `);
  record(
    '1b. login card renders documented content',
    loginShape.logo && loginShape.subtitle && loginShape.inputs >= 2 && loginShape.button,
    JSON.stringify(loginShape),
  );

  // 2 — bad credentials + Enter key submission
  await setInput('input[autocomplete=username]', 'wrong');
  await setInput('input[autocomplete=current-password]', 'wrong');
  await pressEnter('input[autocomplete=current-password]');
  const c2Path = await url();
  const c2Err = await evalJs(`
    const el = document.querySelector('[role=alert]');
    return el ? el.textContent.trim() : null;
  `);
  record(
    '2. Enter key submits; bad credentials show error',
    c2Path === '/login' && c2Err === 'Invalid credentials',
    `path: ${c2Path}, error text: ${JSON.stringify(c2Err)}`,
  );

  // 3 — admin/admin reaches /dashboard
  await setInput('input[autocomplete=username]', 'admin');
  await setInput('input[autocomplete=current-password]', 'admin');
  await clickText('button[type=submit]', 'Sign In');
  await sleep(500);
  const c3Path = await url();
  const shell = await evalJs(`
    return {
      logo: document.querySelector('.app-sidebar__logo')?.textContent.trim(),
      nav: [...document.querySelectorAll('.nav-item')].map((n) => n.textContent.trim()),
      avatar: document.querySelector('.app-avatar')?.textContent.trim(),
      user: document.querySelector('.app-user')?.textContent.trim(),
      breadcrumb: document.querySelector('.app-breadcrumb')?.textContent.trim(),
    };
  `);
  const expectedNav = [
    'Dashboard',
    'Donor Registry',
    'Recipient Waitlist',
    'Matching Console',
    'Offer Workflow',
    'Transport',
    'Reports',
    'Settings',
  ];
  record(
    '3. admin/admin logs in and renders AppShell',
    c3Path === '/dashboard' &&
      shell.logo === 'OrganLink' &&
      JSON.stringify(shell.nav) === JSON.stringify(expectedNav) &&
      shell.avatar === 'A' &&
      shell.user === 'AAdmin',
    `path: ${c3Path}, ${JSON.stringify(shell)}`,
  );
  const shot3 = await screenshot('dashboard');

  // 4 — every sidebar route
  const expectedRoutes = [
    ['Dashboard', '/dashboard', 'Dashboard', 'Dashboard'],
    ['Donor Registry', '/donors', 'Donor Registry', 'Donor Registry'],
    ['Recipient Waitlist', '/recipients', 'Recipient Waitlist', 'Recipient Waitlist'],
    ['Matching Console', '/matching', 'Matching Console', 'Matching Console'],
    ['Offer Workflow', '/offers', 'Offer Workflow', 'Offer Workflow'],
    ['Transport', '/transport', 'Logistics & Viability Tracking', 'Transport'],
    ['Reports', '/reports', 'Analytics & Compliance', 'Reports'],
    ['Settings', '/settings', 'System Configuration', 'Settings'],
  ];
  const navRows = [];
  let navOk = true;
  for (const [label, path, breadcrumb, heading] of expectedRoutes) {
    await clickText('.nav-item', label);
    const observed = await evalJs(`
      return {
        path: location.pathname,
        breadcrumb: document.querySelector('.app-breadcrumb')?.textContent.trim(),
        heading: document.querySelector('.app-content h2')?.textContent.trim(),
        activeNav: document.querySelector('.nav-item.active')?.textContent.trim(),
      };
    `);
    const ok =
      observed.path === path &&
      observed.breadcrumb === breadcrumb &&
      observed.heading === heading &&
      observed.activeNav === label;
    navOk = navOk && ok;
    navRows.push(`${ok ? 'ok' : 'BAD'} ${label} -> ${observed.path} | breadcrumb "${observed.breadcrumb}" | heading "${observed.heading}" | active "${observed.activeNav}"`);
  }
  record('4. all 8 sidebar routes navigate correctly', navOk, `\n      ${navRows.join('\n      ')}`);

  // 5 — shared components + mock data render
  await goto('/__phase0-smoke');
  await waitFor(`document.querySelectorAll('.stat-card').length === 4`, { label: '4 stat cards' });
  const smoke = await evalJs(`
    const text = document.body.innerText;
    return {
      counts: document.querySelector('[data-testid=mock-counts]')?.textContent.trim(),
      statCards: document.querySelectorAll('.stat-card').length,
      badges: [...document.querySelectorAll('.badge')].map((b) => b.textContent.trim() + ':' + [...b.classList].filter((c) => c.startsWith('badge-')).join('')),
      tables: document.querySelectorAll('.data-table-paper').length,
      rows: document.querySelectorAll('.data-table-row').length,
      headCells: document.querySelectorAll('.data-table-head-cell').length,
      search: !!document.querySelector('[aria-label="Search table"]'),
      searchIsInset: getComputedStyle(document.querySelector('[aria-label="Search table"]')).boxShadow.includes('inset'),
      pagination: !!document.querySelector('.data-table-paper .mrt-table-pagination'),
      paginationIsNeu: getComputedStyle(
        document.querySelector('.data-table-paper .mrt-table-pagination button:not([data-active])'),
      ).boxShadow.includes('rgb'),
      headCellStyle: (() => {
        const cs = getComputedStyle(document.querySelector('.data-table-head-cell'));
        return cs.textTransform + '/' + cs.fontSize + '/' + cs.letterSpacing;
      })(),
      emptyState: text.includes('No records found'),
      monoCell: !!document.querySelector('.data-table-row .mono'),
    };
  `);
  record(
    '5. shared components + mock data render',
    smoke.statCards === 4 &&
      smoke.tables === 2 &&
      smoke.rows > 0 &&
      smoke.search &&
      smoke.searchIsInset &&
      smoke.pagination &&
      smoke.paginationIsNeu &&
      smoke.emptyState &&
      smoke.monoCell &&
      smoke.badges.length === 6 + 10,
    JSON.stringify(smoke),
  );
  const shot5 = await screenshot('smoke');

  // 6 — FormModal opens and closes
  await clickText('button', 'Open modal');
  await waitFor(`document.querySelector('.form-modal__content')`, { label: 'modal content' });
  await sleep(300);
  const modalOpen = await evalJs(`
    const content = document.querySelector('.form-modal__content');
    if (!content) return null;
    const input = document.querySelector('.form-modal__body input');
    const cs = input ? getComputedStyle(input) : null;
    return {
      title: document.querySelector('.mantine-Modal-title')?.textContent.trim(),
      hasInput: !!input,
      inputHeight: cs?.height,
      inputShadow: cs?.boxShadow.includes('inset'),
      buttons: [...content.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean),
    };
  `);
  const shot6 = await screenshot('modal');
  await clickText('.form-modal__content button', 'Cancel');
  await waitFor(`!document.querySelector('.form-modal__content')`, { label: 'modal closed' });
  const modalClosed = await evalJs(`return !document.querySelector('.form-modal__content');`);
  record(
    '6. FormModal opens with neu-inset inputs and closes on Cancel',
    !!modalOpen && modalOpen.hasInput && modalOpen.inputShadow && modalClosed,
    `${JSON.stringify(modalOpen)}, closed: ${modalClosed}`,
  );

  // 7 — session survives reload
  await goto('/dashboard');
  const c7 = await url();
  record('7. session persists across reload', c7 === '/dashboard', `final path: ${c7}`);

  // 8 — logout
  await evalJs(`document.querySelector('.app-user').click(); return true;`);
  await waitFor(
    `[...document.querySelectorAll('.mantine-Menu-item')].some((i) => i.textContent.trim() === 'Log out')`,
    { label: 'Log out menu item' },
  );
  const menuVisible = await evalJs(`return document.body.innerText.includes('Log out');`);
  await clickText('.mantine-Menu-item', 'Log out');
  await sleep(600);
  const c8 = await url();
  const stored = await evalJs(`return localStorage.getItem('organlink.auth');`);
  record(
    '8. logout returns to /login and clears storage',
    menuVisible && c8 === '/login' && stored === null,
    `menu shown: ${menuVisible}, final path: ${c8}, localStorage: ${JSON.stringify(stored)}`,
  );

  // 9 — protected route after logout
  await goto('/donors');
  const c9 = await url();
  record('9. /donors redirects to /login when logged out', c9 === '/login', `final path: ${c9}`);

  // 10 — unknown route
  await goto('/some-unknown-route');
  const c10 = await url();
  record('10. unknown route redirects to /login', c10 === '/login', `final path: ${c10}`);

  console.log('\n--- screenshots ---');
  console.log([shot3, shot5, shot6].join('\n'));

  console.log('\n--- console errors/warnings ---');
  console.log(consoleMessages.length ? [...new Set(consoleMessages)].join('\n') : '(none)');

  const failed = results.filter((r) => !r.pass);
  console.log(`\n--- ${results.length - failed.length}/${results.length} checks passed ---`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('DRIVER ERROR:', err);
  console.log('console messages so far:', consoleMessages.join('\n'));
  process.exit(2);
});
