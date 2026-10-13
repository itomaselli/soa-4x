#!/usr/bin/env node
// Screenshots of the interface for review, at real resolutions, driven through Chrome's DevTools Protocol.
// Needs the dev server running (npm run dev) and Google Chrome installed. Loads a save into the page's autosave,
// walks through the views and writes PNGs. It also reports console errors, failed requests and pages wider than
// the window (horizontal scroll).
//
//   node scripts/capture-ui.mjs [save.json] [out-dir]
//   (defaults: tests/fixtures/review-economy.json, docs/revamp/capturas)

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_BASE = process.env.BIKER4X_URL ?? "http://localhost:5173/";
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const save = readFileSync(process.argv[2] ?? "tests/fixtures/review-economy.json", "utf8");
const outDir = process.argv[3] ?? "docs/revamp/capturas";
mkdirSync(outDir, { recursive: true });

const PORT = 9333;
const profile = mkdtempSync(join(tmpdir(), "biker4x-capture-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--hide-scrollbars", "--force-device-scale-factor=1", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome still starting.
    }
    await sleep(200);
  }
  throw new Error("Chrome no respondió");
}

const ws = new WebSocket(await target());
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let nextId = 1;
const pending = new Map();
const problems = [];
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === "Runtime.exceptionThrown") {
    problems.push(`JS: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
    problems.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  } else if (msg.method === "Network.loadingFailed") {
    problems.push(`carga fallida: ${msg.params.errorText}`);
  } else if (msg.method === "Network.responseReceived" && msg.params.response.status >= 400) {
    problems.push(`HTTP ${msg.params.response.status}: ${msg.params.response.url}`);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
const js = async (expression) => {
  const r = await send("Runtime.evaluate", { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

await send("Runtime.enable");
await send("Network.enable");
await send("Page.enable");

async function open(width, height) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: URL_BASE });
  await sleep(1500);
  await js(`localStorage.setItem("biker4x.autosave", ${JSON.stringify(save)}); localStorage.setItem("biker4x.renderMode", "tiles");`);
  await send("Page.reload");
  await sleep(2000);
}

const report = [];
async function shot(name) {
  await sleep(400);
  const overflow = await js(`return document.documentElement.scrollWidth - window.innerWidth;`);
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(data, "base64"));
  report.push(`${name}.png${overflow > 0 ? `  ⚠ desborde horizontal de ${overflow}px` : ""}`);
}

const helpers = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const nav = async (label) => { [...document.querySelectorAll(".nav-tab")].find((b) => b.textContent === label).click(); await wait(250); };
  const click = async (sel, text) => { const el = [...document.querySelectorAll(sel)].find((e) => !text || e.textContent.includes(text)); if (!el) throw new Error("no encontré " + sel + " " + (text ?? "")); el.click(); await wait(250); };
  const choose = async (sel, value) => { const el = document.querySelector(sel); el.value = value; el.dispatchEvent(new Event("change")); await wait(200); };
`;
const step = (code) => js(`${helpers}\n${code}`);

// ---------- 1920 × 1080: every view ----------
await open(1920, 1080);
await shot("1920-01-condado");
await step(`await click("#inspector button", "Entrar al distrito"); const c = document.querySelector("#map-host canvas"); const r = c.getBoundingClientRect(); const s = r.width / 800; for (const t of ["pointerdown","pointerup"]) c.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: r.left + (11*16) * s, clientY: r.top + (12*16) * s, pointerId: 1, pointerType: "mouse", isPrimary: true }));`);
await shot("1920-02-distrito-lote");
await step(`await nav("Club"); const rows = document.querySelectorAll("table.members tbody tr"); for (const [i, task] of [[1, "task_retail"], [2, "task_work_garage"], [3, "task_gun_run"]]) { const sel = document.querySelectorAll("table.members tbody tr")[i].querySelector("select"); sel.value = task; sel.dispatchEvent(new Event("change")); await wait(150); }`);
await shot("1920-03-club");
await step(`await click(".hq-summary button", "Ver ficha");`);
await shot("1920-04-sede");
await step(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await wait(200); await nav("Mesa"); await choose(".council-col select", "promote"); const member = document.querySelectorAll(".council-col select")[1]; member.value = member.options[member.options.length - 1].value; member.dispatchEvent(new Event("change")); await wait(200); const rank = document.querySelectorAll(".council-col select")[2]; if (rank.options.length > 1) { rank.value = rank.options[1].value; rank.dispatchEvent(new Event("change")); await wait(200); } await click(".council-col button.primary-outline");`);
await shot("1920-05-mesa");
for (const [i, chain] of ["Motos", "Marihuana", "Cocaína", "Armas"].entries()) {
  await step(`await nav("Negocios"); await click(".segmented button", "${chain}"); window.scrollTo(0, 0); document.querySelector("#panel").scrollTo(0, 0);`);
  await shot(`1920-0${6 + i}-negocios-${chain.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "")}`);
}
await step(`await click(".segmented button", "Cocaína"); await click(".chain-node", "Cartel"); `);
await shot("1920-10-negocios-cartel");
await step(`const panel = [...document.querySelectorAll(".panel-card")].find((p) => p.textContent.includes("Lavado")); panel.scrollIntoView(); const num = panel.querySelector("input[type=number]"); num.value = num.max; num.dispatchEvent(new Event("change")); await wait(250); [...document.querySelectorAll(".panel-card")].find((p) => p.textContent.includes("Lavado")).scrollIntoView();`);
await shot("1920-11-negocios-lavado");
await step(`await click(".header-actions button.primary");`);
await shot("1920-12-revisar-semana");
await step(`document.getElementById("confirm-resolve").click(); await wait(500);`);
await shot("1920-13-informe");

// ---------- Smaller windows: main views ----------
for (const [w, h] of [[1366, 768], [1024, 768], [768, 1024]]) {
  await open(w, h);
  await shot(`${w}-01-condado`);
  await step(`await nav("Club");`);
  await shot(`${w}-02-club`);
  await step(`await nav("Mesa");`);
  await shot(`${w}-03-mesa`);
  await step(`await nav("Negocios");`);
  await shot(`${w}-04-negocios`);
}

ws.close();
chrome.kill();
writeFileSync(join(outDir, "LEEME.txt"), [`Capturas de ${URL_BASE} con ${process.argv[2] ?? "tests/fixtures/review-economy.json"}`, ...report, "", problems.length ? "Problemas:" : "Sin errores de JS ni cargas fallidas.", ...problems].join("\n") + "\n");
console.log(report.join("\n"));
console.log(problems.length ? `PROBLEMAS:\n${problems.join("\n")}` : "Sin errores de JS ni cargas fallidas.");
