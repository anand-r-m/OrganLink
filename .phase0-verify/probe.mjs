let id = 0;
const pending = new Map();
let ws;
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evalJs(expression) {
  const res = await send('Runtime.evaluate', {
    expression: `(() => { ${expression} })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? 'eval error');
  return res.result.value;
}

const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = targets.find((t) => t.type === 'page');
ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
const logs = [];
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    logs.push(`[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    logs.push(`[exception] ${msg.params.exceptionDetails.exception?.description}`);
  }
};
await send('Page.enable');
await send('Runtime.enable');

await send('Page.navigate', { url: 'http://localhost:5173/login' });
await sleep(1200);
await evalJs(`localStorage.setItem('organlink.auth','true'); return true;`);
await send('Page.navigate', { url: 'http://localhost:5173/__phase0-smoke' });
await sleep(3000);

console.log('buttons on page:', JSON.stringify(await evalJs(`
  return [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).slice(0, 20);
`)));

console.log('click result:', JSON.stringify(await evalJs(`
  const b = [...document.querySelectorAll('button')].find((n) => n.textContent.trim() === 'Open modal');
  if (!b) return 'button not found';
  b.click();
  return { clicked: true, disabled: b.disabled, tag: b.tagName };
`)));

for (let i = 1; i <= 12; i += 1) {
  await sleep(500);
  const state = await evalJs(`
    return {
      modalRoot: !!document.querySelector('.mantine-Modal-root'),
      content: !!document.querySelector('.form-modal__content'),
      overlay: !!document.querySelector('.mantine-Modal-overlay'),
      bodyHasModalText: document.body.innerText.includes('Smoke modal'),
    };
  `);
  console.log(`t+${i * 500}ms`, JSON.stringify(state));
  if (state.content) break;
}

console.log('console logs:', logs.length ? logs.join('\n') : '(none)');
process.exit(0);
