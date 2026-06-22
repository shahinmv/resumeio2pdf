#!/usr/bin/env node
/*
 * resume.io  ->  industry-standard TRUE-VECTOR PDF (free, no paywall)
 * ------------------------------------------------------------------
 * resume.io's paid export is a server-generated vector PDF; its in-browser
 * preview is a WebGL/WASM raster (no vector text to scrape). This tool takes
 * the legitimate route: it reads YOUR resume's structured data from your
 * authenticated session and re-typesets it as a faithful, London-style HTML
 * page, then lets Chrome render it to a real vector PDF.
 *
 * GENERAL: data-driven. Renders every resume.io section type in the resume's
 * own sectionsOrder, honours custom section titles, accent colour, month-hidden
 * dates, profile summary, and custom sections — for any account's resume.
 *
 * Output: true vector, embedded CID-TrueType font (Tinos = metric-identical to
 * Times New Roman, the London template's font; open-licensed), selectable text,
 * clickable links, tagged (ATS/accessibility friendly). Photos are omitted
 * (ATS-friendly, layout-stable). Layout/type calibrated to resume.io's London.
 *
 * REQUIREMENTS: Node 21+. Chrome must have internet (for the web font).
 * USAGE:
 *   1. "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *        --user-data-dir="$HOME/.resumeio-dl" --remote-debugging-port=9222 \
 *        "https://resume.io/app"
 *   2. Log in and open the resume (…/app/resumes/<id>/edit) as the active tab.
 *   3. node resumeio_vector.mjs ./resume.pdf
 */
import { writeFileSync } from 'node:fs';
const BASE = process.env.CDP || 'http://localhost:9222';
const ARGS = process.argv.slice(2);
const OUT = ARGS.find(a => !a.startsWith('--')) || './resume.pdf';
// --font="<Google Font>" to match other templates (default Tinos = Times New Roman).
// e.g. --font="Arimo" (Arial), --font="Gelasio" (Georgia), --font="Lato", "Merriweather".
const FONT = ((ARGS.find(a => a.startsWith('--font=')) || '').split('=')[1] || 'Tinos').replace(/['"]/g, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl); let id = 0; const pending = new Map();
    ws.addEventListener('open', () => resolve(api));
    ws.addEventListener('error', e => reject(new Error('ws: ' + (e.message || e.type))));
    ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
    const api = { send: (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }), close: () => ws.close() };
  });
}
const list = async () => (await (await fetch(BASE + '/json/list')).json());

// ---------- fetch resume data from the authenticated session ----------
const tab = (await list()).find(x => x.type === 'page' && /resume\.io\/app\/resumes\/\d+/.test(x.url)) || (await list()).find(x => x.type === 'page' && /resume\.io/.test(x.url));
if (!tab) { console.error('Open your resume on resume.io first.'); process.exit(1); }
let id = (tab.url.match(/resumes\/(\d+)/) || [])[1];
const c = await connect(tab.webSocketDebuggerUrl);
await c.send('Runtime.enable');
const ev = async (e, aw = true) => (await c.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: aw })).result.value;
if (!id) { const ids = JSON.parse(await ev(`fetch('/api/app/resumes',{credentials:'include'}).then(r=>r.json()).then(j=>JSON.stringify(j.resumes.map(x=>x.id)))`)); id = ids[0]; }
const j = JSON.parse(await ev(`fetch('/api/app/resumes/${id}',{credentials:'include'}).then(r=>r.text())`));
console.log('resume:', j.firstName, j.lastName, '(id', id + ', template', j.template + ')');

// ---------- helpers ----------
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const isHTML = s => typeof s === 'string' && /<\/?[a-z][\s\S]*>/i.test(s);
const para = s => !s ? '' : (isHTML(s) ? s : `<p>${esc(s)}</p>`);
const fmt = (d, hideMonth) => { if (!d) return ''; const [y, m] = String(d).split('-'); return hideMonth || !m ? y : `${MON[(+m) - 1]} ${y}`; };
const range = it => { const a = fmt(it.dateFrom, it.isMonthFromHidden); const b = it.isDateUntilPresent || !it.dateUntil ? (it.dateFrom ? 'Present' : '') : fmt(it.dateUntil, it.isMonthUntilHidden); return a ? (b ? `${a} — ${b}` : a) : b; };
const pick = (o, keys) => { for (const k of keys) if (o && o[k] != null && o[k] !== '') return o[k]; return ''; };
const ditem = it => ({
  date: range(it),
  title: [pick(it, ['title', 'degree', 'course', 'name', 'position', 'activity', 'award', 'function']), pick(it, ['employer', 'school', 'institution', 'organization', 'issuer', 'authority', 'publisher', 'company', 'place'])].filter(Boolean).map(esc).join(', '),
  place: esc(pick(it, ['city', 'location', 'country'])),
  body: para(pick(it, ['description', 'summary', 'text', 'content'])),
});

const LANG = { advanced: 'Native speaker', native_speaker: 'Native speaker', fluent: 'Native speaker', c2: 'Native speaker', upper_intermediate: 'Highly proficient', c1: 'Highly proficient', proficient: 'Highly proficient', low_intermediate: 'Very good command', b2: 'Very good command', intermediate: 'Good working knowledge', b1: 'B1', a2: 'A2', a1: 'A1', beginner: 'Working knowledge', working_knowledge: 'Working knowledge' };
const datedSection = (label, rows) => { rows = rows.filter(r => r.title || r.body || r.date); return rows.length ? `<section class="sec dated"><div class="label">${esc(label)}</div>${rows.map(r => `<div class="date">${esc(r.date)}</div><div class="entry"><div class="head"><span class="title">${r.title}</span>${r.place ? `<span class="place">${r.place}</span>` : ''}</div>${r.body ? `<div class="body">${r.body}</div>` : ''}</div>`).join('')}</section>` : ''; };
const plainSection = (label, content) => content && content.trim() ? `<section class="sec"><div class="label">${esc(label)}</div><div class="col2">${content}</div></section>` : '';
const grid2 = cells => { cells = cells.filter(Boolean); return cells.length ? `<div class="grid2">${cells.join('')}</div>` : ''; };

// ---------- section renderers ----------
const TITLES = { profile: 'Profile', workExperiences: 'Employment History', educations: 'Education', socialProfiles: 'Links', skills: 'Skills', languages: 'Languages', hobbies: 'Hobbies', courses: 'Courses', internships: 'Internships', activities: 'Extra-curricular Activities', extracurricularActivities: 'Extra-curricular Activities', conferences: 'Conferences', volunteerings: 'Volunteering', volunteering: 'Volunteering', references: 'References', awards: 'Awards', publications: 'Publications', accomplishments: 'Accomplishments', licensesAndCertifications: 'Certifications', certifications: 'Certifications', affiliations: 'Affiliations', technicalProficiencyCategories: 'Technical Skills', skillCategories: 'Skills', signatures: 'Signature' };
const ST = j.sectionTitles || {};
const titleFor = key => esc(ST[key] || TITLES[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()));
const DATED_KEYS = new Set(['workExperiences', 'educations', 'courses', 'internships', 'activities', 'extracurricularActivities', 'conferences', 'volunteerings', 'volunteering', 'awards', 'publications']);

function renderKey(key) {
  if (key.startsWith('custom:')) {
    const cs = (j.customSections || []).find(x => String(x.externalId) === key.slice(7) || String(x.id) === key.slice(7));
    return cs && (cs.items || []).length ? datedSection(cs.title || 'Custom', cs.items.map(ditem)) : '';
  }
  if (key === 'profile') return plainSection(titleFor('profile'), para(j.profile || j.summary));
  if (key === 'socialProfiles') { const ls = (j.socialProfiles || []).filter(s => s.link); return ls.length ? plainSection(titleFor('socialProfiles'), `<div class="links">${ls.map(s => `<a href="${esc(s.link)}">${esc(s.label || s.link)}</a>`).join('<span>, </span>')}</div>`) : ''; }
  if (key === 'skills') {
    if ((j.skillCategories || []).length) return plainSection(titleFor('skills'), j.skillCategories.map(cat => `<div class="catname">${esc(cat.name || cat.title)}</div>${grid2((cat.skills || cat.items || []).filter(s => s.skill || s.name).map(s => `<div class="cell">${esc(s.skill || s.name)}</div>`))}`).join(''));
    const sk = (j.skills || []).filter(s => s.skill || s.name); return sk.length ? plainSection(titleFor('skills'), grid2(sk.map(s => `<div class="cell">${esc(s.skill || s.name)}${j.hideSkillLevel || !s.level ? '' : `<span class="lvl"> · ${esc(s.level)}</span>`}</div>`))) : '';
  }
  if (key === 'technicalProficiencyCategories') return (j.technicalProficiencyCategories || []).length ? plainSection(titleFor(key), j.technicalProficiencyCategories.map(cat => `<div class="catname">${esc(cat.name || cat.title)}</div>${grid2((cat.skills || cat.items || []).filter(s => s.skill || s.name).map(s => `<div class="cell">${esc(s.skill || s.name)}</div>`))}`).join('')) : '';
  if (key === 'languages') { const ls = (j.languages || []).filter(l => l.language || l.name); return ls.length ? plainSection(titleFor('languages'), grid2(ls.map(l => `<div class="cell lang"><span>${esc(l.language || l.name)}</span><span class="lvl">${esc(LANG[l.level] || l.level || '')}</span></div>`))) : ''; }
  if (key === 'hobbies') { const h = j.hobbies; const txt = (Array.isArray(h) ? h.map(x => x && (x.hobby || x.name)).filter(Boolean).join(', ') : (h || '')); return plainSection(titleFor('hobbies'), txt ? `<div>${esc(txt)}</div>` : ''); }
  if (key === 'accomplishments') return plainSection(titleFor('accomplishments'), para(j.accomplishments));
  if (key === 'references') {
    const refs = (j.references || []).filter(r => r.name);
    if (refs.length) return plainSection(titleFor('references'), refs.map(r => `<div class="ref"><b>${esc(r.name)}</b>${r.company ? ', ' + esc(r.company) : ''}${r.email || r.phone ? `<div class="lvl">${[r.email, r.phone].filter(Boolean).map(esc).join(' · ')}</div>` : ''}</div>`).join(''));
    return j.referencesUponRequest ? plainSection(titleFor('references'), '<div>References available upon request</div>') : '';
  }
  if (key === 'licensesAndCertifications' || key === 'certifications') { const cs = (j.licensesAndCertifications || j.certifications || []).filter(x => x.name || x.title); return cs.length ? plainSection(titleFor(key), cs.map(x => `<div class="ref"><b>${esc(x.name || x.title)}</b>${x.issuer || x.authority ? ', ' + esc(x.issuer || x.authority) : ''}${x.date || x.dateFrom ? ` <span class="lvl">(${esc(fmt(x.date || x.dateFrom))})</span>` : ''}</div>`).join('')) : ''; }
  if (key === 'affiliations') { const a = (j.affiliations || []).filter(x => x.name || x.title || x.organization); return a.length ? plainSection(titleFor(key), a.map(x => `<div class="ref"><b>${esc(x.name || x.title || x.organization)}</b>${x.city ? ', ' + esc(x.city) : ''}</div>`).join('')) : ''; }
  // generic dated/array sections
  if (DATED_KEYS.has(key) && Array.isArray(j[key]) && j[key].length) return datedSection(titleFor(key), j[key].map(ditem));
  if (Array.isArray(j[key]) && j[key].length) return datedSection(titleFor(key), j[key].map(ditem));
  return '';
}

// resume.io pins "Links" (socialProfiles) to the header/top area, not its sectionsOrder slot.
const linksHtml = renderKey('socialProfiles');
const order = (j.sectionsOrder && j.sectionsOrder.length) ? j.sectionsOrder : ['profile', 'workExperiences', 'educations', 'socialProfiles', 'skills', 'languages'];
const bodyOrder = order.filter(k => k !== 'socialProfiles');
const parts = bodyOrder.map(renderKey).filter(Boolean);
// append any non-empty known sections not present in sectionsOrder (safety against data loss)
for (const k of ['workExperiences', 'educations', 'skills', 'languages', 'courses', 'internships', 'activities', 'volunteerings', 'references', 'licensesAndCertifications', 'awards', 'publications', 'hobbies']) {
  if (!order.includes(k) && Array.isArray(j[k]) && j[k].length) { const h = renderKey(k); if (h) parts.push(h); }
}

// accent colour from the resume (resume.io tints headings/links); default near-black
let accent = '#1a1a1a';
if (typeof j.color === 'string' && /^#?[0-9a-fA-F]{6}$/.test(j.color)) accent = j.color[0] === '#' ? j.color : '#' + j.color;
const contact = [j.city, j.countryName, j.phoneNumber, j.email].filter(Boolean).map(esc).join(', ');
const position = esc(j.position || j.jobTitle || '');

const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(FONT)}:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet"><style>
:root{--accent:${accent}}
@page{size:A4;margin:12mm 16mm}*{margin:0;padding:0;box-sizing:border-box}html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:'${FONT}','Times New Roman',Times,serif;color:#1a1a1a;font-size:12px;line-height:1.34}a{color:var(--accent);text-decoration:none}
.name{text-align:center;font-weight:700;font-size:17px;letter-spacing:.2px;color:var(--accent)}
.position{text-align:center;font-size:12px;color:#333;margin-top:2px}
.contact{text-align:center;font-size:11px;color:#333;margin:5px 0 4px}
.sec{display:grid;grid-template-columns:23% 1fr;column-gap:14px;border-top:1px solid #dcdcdc;padding-top:9px;margin-top:9px}
.sec:first-of-type{margin-top:9px}
.label{font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase;color:var(--accent);opacity:.92}
.sec.dated>.label{grid-column:1/-1;margin-bottom:8px}.sec:not(.dated)>.label{grid-column:1}.col2{grid-column:2}
.date{grid-column:1;font-size:10.5px;color:#555}.entry{grid-column:2;margin-bottom:13px;break-inside:avoid}.entry:last-child{margin-bottom:2px}
.head{display:flex;justify-content:space-between;align-items:baseline;gap:10px}.title{font-weight:700;font-size:14px;color:#1a1a1a;flex:1;min-width:0;overflow-wrap:break-word}
.place{font-size:11px;color:#555;white-space:nowrap;flex:0 0 auto}.body{margin-top:3px;overflow-wrap:break-word}.body ul{padding-left:15px;margin:2px 0}.body li{margin:2px 0;padding-left:2px}.body p{margin:2px 0}
.links a{font-size:12px}.grid2{display:grid;grid-template-columns:1fr 1fr;column-gap:30px;row-gap:6px}.cell{font-size:12px}.cell.lang{display:flex;justify-content:space-between;gap:8px}
.lvl{color:#555}.catname{font-weight:700;font-size:12px;margin:4px 0 2px}.col2>.catname:first-child{margin-top:0}.ref{margin-bottom:6px}
</style></head><body><div class="name">${esc(j.firstName)} ${esc(j.lastName)}</div>${position ? `<div class="position">${position}</div>` : ''}<div class="contact">${contact}</div>${linksHtml}${parts.join('')}</body></html>`;

// ---------- render to vector PDF ----------
const t2 = await (await fetch(BASE + '/json/new?about:blank', { method: 'PUT' })).json();
const p = await connect(t2.webSocketDebuggerUrl);
await p.send('Page.enable');
const fid = (await p.send('Page.getFrameTree')).frameTree.frame.id;
await p.send('Page.setDocumentContent', { frameId: fid, html });
await p.send('Runtime.enable');
for (let i = 0; i < 30; i++) { const ok = (await p.send('Runtime.evaluate', { expression: 'document.fonts.ready.then(()=>document.fonts.size>0)', awaitPromise: true, returnByValue: true })).result.value; if (ok) break; await sleep(200); }
await sleep(1200);
const pdf = await p.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
writeFileSync(OUT, Buffer.from(pdf.data, 'base64'));
try { await fetch(`${BASE}/json/close/${t2.id}`); } catch {}
p.close(); c.close();
console.log(`\n✅ ${OUT} — ${parts.length} sections, true vector, embedded font, selectable text, clickable links (${Buffer.from(pdf.data, 'base64').length} bytes)`);
