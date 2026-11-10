import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const [url, w, out, sel] = process.argv.slice(2);
const PORT = 9400 + Math.floor(Math.random() * 300);
const UD = `C:\\Users\\Public\\_tmp_shot\\ud${PORT}`;
mkdirSync(UD, { recursive: true });

const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + UD,
  '--window-size=' + w + ',1000', 'about:blank',
], { stdio: 'ignore' });

let list;
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    list = await r.json();
    if (list.some((t) => t.type === 'page')) break;
  } catch { /* not up yet */ }
  await sleep(250);
}
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok) => ws.addEventListener('open', ok, { once: true }));

let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((ok) => {
  const n = ++id;
  pending.set(n, ok);
  ws.send(JSON.stringify({ id: n, method, params }));
});

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: +w, height: 1000, deviceScaleFactor: 1, mobile: +w < 700 });
await send('Page.navigate', { url });
await sleep(2500);

// 真实滚动一次：先到目标位置，再微调，确保入场动画的观察者被触发
if (sel) {
  await send('Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return 'no-target';
      const y = el.getBoundingClientRect().top + window.scrollY - 130;
      window.scrollTo(0, Math.max(0, y - 60));
      return 'y=' + Math.round(y);
    })()`, returnByValue: true,
  });
  await sleep(300);
  await send('Runtime.evaluate', {
    expression: `window.scrollTo(0, ${0} + window.scrollY + 60);
      window.dispatchEvent(new Event('scroll')); 'ok'`, returnByValue: true,
  });
  await sleep(900);
}

const res = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
writeFileSync(out, Buffer.from(res.result.data, 'base64'));

const info = await send('Runtime.evaluate', {
  expression: `(() => {
    const el = document.querySelector(${JSON.stringify(sel || 'body')});
    const b = el && el.getBoundingClientRect();
    const btn = el && el.querySelector('.btn');
    const br = btn && btn.getBoundingClientRect();
    const cs = btn && getComputedStyle(btn);
    return {
      scrollY: Math.round(window.scrollY),
      card: b && { t: Math.round(b.top), h: Math.round(b.height), w: Math.round(b.width) },
      btn: br && { t: Math.round(br.top - b.top), l: Math.round(br.left - b.left), w: Math.round(br.width), h: Math.round(br.height), border: cs.borderColor, color: cs.color },
      docW: document.documentElement.scrollWidth,
      viewW: window.innerWidth,
    };
  })()`, returnByValue: true,
});
console.log(JSON.stringify(info.result.result.value));

ws.close();
edge.kill();
process.exit(0);
