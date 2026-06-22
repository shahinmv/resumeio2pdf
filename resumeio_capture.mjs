#!/usr/bin/env node
/*
 * resume.io multi-page downloader — canvas loophole, with TEXT + LINKS
 * -------------------------------------------------------------------
 * resume.io paywalls the full PDF and the free image endpoint only serves
 * page 1. But the editor renders EVERY page client-side into <canvas>
 * elements. This tool:
 *   1. reads those canvases over the Chrome DevTools Protocol (all pages),
 *   2. OCRs each page (tesseract) to add a selectable/searchable text layer,
 *   3. pulls the resume's link URLs from its own API and adds clickable
 *      /Link annotations on the matching words (e.g. Github, LinkedIn),
 *   4. assembles a multi-page PDF.
 *
 * Output: ~180 DPI page images + invisible OCR text + clickable links.
 * (The crisp *vector* PDF is resume.io's paid export; the free render caps
 *  at ~180 DPI and higher device-scale factors render black.)
 *
 * REQUIREMENTS: Node 21+ , tesseract on PATH (brew install tesseract).
 *
 * QUALITY: capture matches the browser's device-scale-factor. For ~270 DPI add
 *   --force-device-scale-factor=3 to the launch command below. Do NOT go higher
 *   (factor 4-5 makes resume.io's renderer output a black canvas).
 *
 * USAGE
 *   1. "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *        --user-data-dir="$HOME/.resumeio-dl" --remote-debugging-port=9222 \
 *        --force-device-scale-factor=3 "https://resume.io/app"
 *   2. Log in, open the resume editor (…/app/resumes/<id>/edit) so the live
 *      preview + page counter ("1 / 2") is visible.
 *   3. node resumeio_capture.mjs ./out.pdf
 */
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.CDP || 'http://localhost:9222';
const OUT = process.argv[2] || './resume.pdf';
const TESS = process.env.TESSERACT || 'tesseract';
const PW = 595.32; // A4 width, pt
const sleep = ms => new Promise(r => setTimeout(r, ms));
const WORK = mkdtempSync(join(tmpdir(), 'resumeio-'));

function cdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl); let id = 0; const pending = new Map();
    ws.addEventListener('open', () => resolve(api));
    ws.addEventListener('error', e => reject(new Error('ws: ' + (e.message || e.type))));
    ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
    const api = { send: (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }), close: () => ws.close() };
  });
}
const list = async () => (await (await fetch(BASE + '/json/list')).json());

// ---- connect to the editor ----
const t = (await list()).find(x => x.type === 'page' && /resume\.io\/app\/resumes\/\d+\/edit/.test(x.url)) || (await list()).find(x => x.type === 'page' && /resume\.io/.test(x.url));
if (!t) { console.error('Open the resume editor (…/app/resumes/<id>/edit) first.'); process.exit(1); }
const resumeId = (t.url.match(/resumes\/(\d+)/) || [])[1];
const c = await cdp(t.webSocketDebuggerUrl);
await c.send('Runtime.enable');
// The editor must be the FOREGROUND tab — Chrome pauses canvas rendering in
// backgrounded tabs, so page changes wouldn't render. Bring it to front.
await c.send('Page.enable');
try { await c.send('Page.bringToFront'); } catch {}
await sleep(400);
const ev = async (e, awaitPromise = false) => (await c.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise })).result.value;

// ---- link URLs from the resume's own API ----
let linkUrls = [];
if (resumeId) {
  try {
    const raw = await ev(`fetch('/api/app/resumes/${resumeId}',{credentials:'include'}).then(r=>r.json()).then(j=>{const u=[];const w=o=>{if(o&&typeof o==='object')for(const k in o){const v=o[k];if(typeof v==='string'&&/^https?:\\/\\//.test(v)&&!/s3\\.resume|resume\\.io\\/uploads|profile_picture/.test(v))u.push(v);else w(v);}};w(j);return JSON.stringify([...new Set(u)]);})`, true);
    linkUrls = JSON.parse(raw || '[]');
  } catch {}
}
const domainCore = u => { try { return new URL(u).hostname.replace(/^www\./, '').split('.')[0].toLowerCase(); } catch { return ''; } };
const linkFor = word => { const w = word.toLowerCase().replace(/[^a-z0-9]/g, ''); return linkUrls.find(u => { const d = domainCore(u); return d && (w.includes(d) || d.includes(w)) && w.length > 2; }); };
console.log('resume', resumeId, '| link URLs:', linkUrls);

// ---- capture every page from the preview canvases ----
// Counter ("1 / N") tells us the page count; if absent we cap and stop when no
// new page appears. Selectors are the editor UI (same across all templates),
// with a fallback to any large canvas in case resume.io renames test ids.
const counterTxt = await ev(`document.querySelector('[data-testid=preview-page-counter]')?.textContent`);
const M = counterTxt ? (parseInt(counterTxt.split('/')[1]) || 1) : 25;
console.log('pages:', counterTxt ? M : '(no counter — auto-detecting)');
await ev(`(()=>{const p=document.querySelector('[data-testid=preview-previous-page-button]');let n=0;while(p&&!p.disabled&&n++<25)p.click();})()`);
await sleep(1800);
const grab = `(() => { let cs=[...document.querySelectorAll('[data-testid=pdf-preview] canvas')]; if(!cs.length) cs=[...document.querySelectorAll('canvas')].filter(c=>c.width>300&&c.height>300); return JSON.stringify(cs.map(cv=>{const d=cv.toDataURL('image/jpeg',0.95);return {len:d.length,data:d,w:cv.width,h:cv.height};})); })()`;
const curPage = `(()=>{const e=document.querySelector('[data-testid=preview-page-counter]');return e?parseInt(e.textContent.split('/')[0])||0:0;})()`;
const clickNext = `document.querySelector('[data-testid=preview-next-page-button]')?.click()`;
const pages = []; let prev = '';
for (let i = 1; i <= M; i++) {
  // advance to page i, confirming via the page counter (re-click if the editor was slow to respond)
  if (i > 1) { for (let nav = 0; nav < 12; nav++) { if (await ev(curPage) >= i) break; await ev(clickNext); await sleep(900); } }
  // wait for the freshly-rendered, non-blank canvas (different from the previous captured page)
  let pick = null;
  for (let tries = 0; tries < 40; tries++) { await sleep(500); const cand = JSON.parse(await ev(grab)).filter(o => o.len > 100000 && o.data !== prev); if (cand.length) { cand.sort((a, b) => b.len - a.len); pick = cand[0]; break; } }
  if (!pick) { if (i === 1) console.error('page 1: could not capture — is the résumé preview visible in the editor?'); break; }
  prev = pick.data;
  const jpg = join(WORK, `p${i}.jpg`);
  writeFileSync(jpg, Buffer.from(pick.data.split(',')[1], 'base64'));
  pages.push({ jpg, w: pick.w, h: pick.h });
  console.log(`captured page ${i} (${pick.w}x${pick.h})`);
}
c.close();
if (!pages.length) process.exit(1);

// ---- OCR each page -> word boxes ----
const esc = s => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[^\x20-\x7e]/g, '');
for (const pg of pages) {
  const base = pg.jpg.replace(/\.jpg$/, '');
  try { execFileSync(TESS, [pg.jpg, base, '-l', 'eng', 'tsv'], { stdio: 'ignore' }); } catch (e) { console.error('tesseract failed — is it installed? (brew install tesseract)'); process.exit(1); }
  pg.words = readFileSync(base + '.tsv', 'utf8').split('\n').slice(1).map(l => l.split('\t')).filter(f => f.length >= 12 && parseFloat(f[10]) >= 0 && f[11] && f[11].trim()).map(f => ({ left: +f[6], top: +f[7], width: +f[8], height: +f[9], text: f[11] }));
}

// ---- assemble PDF (image + invisible text + link annots) ----
let num = 0; const next = () => ++num;
const CAT = next(), PAGES = next(), FONT = next(); const pageNums = []; const late = [];
for (const pg of pages) {
  const scale = PW / pg.w, PH = pg.h * scale;
  let cs = `q ${PW.toFixed(2)} 0 0 ${PH.toFixed(2)} 0 0 cm /Im Do Q\nBT 3 Tr\n`;
  for (const wd of pg.words) {
    const size = Math.max(1, wd.height * scale), x = wd.left * scale, y = PH - (wd.top + wd.height) * scale + size * 0.18;
    const natW = wd.text.length * size * 0.5 || 1, tz = Math.min(2000, Math.max(10, (wd.width * scale / natW) * 100));
    cs += `/F1 ${size.toFixed(2)} Tf ${tz.toFixed(1)} Tz 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${esc(wd.text)}) Tj\n`;
  }
  cs += 'ET\n';
  const annots = [];
  for (const wd of pg.words) { const url = linkFor(wd.text); if (!url) continue; const x1 = wd.left * scale, y1 = PH - (wd.top + wd.height) * scale, x2 = (wd.left + wd.width) * scale, y2 = PH - wd.top * scale; const an = next(); annots.push(an); late.push({ num: an, parts: [`<< /Type /Annot /Subtype /Link /Rect [${x1.toFixed(2)} ${y1.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)}] /Border [0 0 0] /A << /S /URI /URI (${url}) >> >>`] }); }
  const jpeg = readFileSync(pg.jpg), imN = next(), coN = next(), pgN = next(); pageNums.push(pgN);
  late.push({ num: imN, parts: [`<< /Type /XObject /Subtype /Image /Width ${pg.w} /Height ${pg.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, `\nendstream`] });
  const csb = Buffer.from(cs, 'latin1');
  late.push({ num: coN, parts: [`<< /Length ${csb.length} >>\nstream\n`, csb, `\nendstream`] });
  late.push({ num: pgN, parts: [`<< /Type /Page /Parent ${PAGES} 0 R /MediaBox [0 0 ${PW.toFixed(2)} ${PH.toFixed(2)}] /Resources << /XObject << /Im ${imN} 0 R >> /Font << /F1 ${FONT} 0 R >> >> /Contents ${coN} 0 R /Annots [${annots.map(a => a + ' 0 R').join(' ')}] >>`] });
}
const objs = [{ num: CAT, parts: [`<< /Type /Catalog /Pages ${PAGES} 0 R >>`] }, { num: PAGES, parts: [`<< /Type /Pages /Kids [${pageNums.map(n => n + ' 0 R').join(' ')}] /Count ${pageNums.length} >>`] }, { num: FONT, parts: [`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`] }, ...late].sort((a, b) => a.num - b.num);
const chunks = []; let off = 0; const xref = {};
const push = b => { const buf = Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1'); chunks.push(buf); off += buf.length; };
push('%PDF-1.7\n%\xff\xff\xff\xff\n');
for (const o of objs) { xref[o.num] = off; push(`${o.num} 0 obj\n`); o.parts.forEach(push); push('\nendobj\n'); }
const xo = off, total = num + 1;
let xr = `xref\n0 ${total}\n0000000000 65535 f \n`; for (let i = 1; i < total; i++) xr += String(xref[i] || 0).padStart(10, '0') + ' 00000 n \n';
push(xr); push(`trailer\n<< /Size ${total} /Root ${CAT} 0 R >>\nstartxref\n${xo}\n%%EOF`);
writeFileSync(OUT, Buffer.concat(chunks));
const nLinks = pages.reduce((a, p) => a + p.words.filter(w => linkFor(w.text)).length, 0);
console.log(`\n✅ ${OUT} — ${pages.length} page(s), text layer + ${nLinks} clickable link(s), ${Buffer.concat(chunks).length} bytes`);
