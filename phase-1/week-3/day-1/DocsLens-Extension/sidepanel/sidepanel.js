import { collectPage, lintStyle, clearHighlights, scrollToMark, readConsoleErrors } from "./page-functions.js";
import { STYLE_RULES } from "./style-rules.js";

const DEFAULT_MODELS = { groq: "openai/gpt-oss-120b", anthropic: "claude-opus-5-5", openai: "gpt-5-mini" };
const MAX_LINKS = 400;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const SEV_ORDER = { High: 0, Medium: 1, Low: 2, OK: 3 };

const state = {
  tabId: null, page: null, health: [], passed: [], style: [], filter: "all",
  aiHealth: null, aiStyle: null, aiBug: null, screenshot: null, consoleErrors: [],
};

// ---------- helpers ----------
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:/.test(tab.url || "")) throw new Error("Open a normal web page (http/https) first. Chrome pages can’t be scanned.");
  return tab;
}
async function inPage(tabId, func, args = [], world = "ISOLATED") {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args, world });
  return res?.result;
}
async function send(msg) {
  const res = await chrome.runtime.sendMessage(msg);
  if (!res?.ok) throw new Error(res?.error || "Unknown error");
  return res.data;
}
function toast(text, ms = 2600) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), ms);
}
async function busy(btn, label, fn) {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>${label}`;
  try { return await fn(); }
  catch (err) { toast(err.message || String(err), 5000); }
  finally { btn.disabled = false; btn.innerHTML = original; }
}
async function copy(text) {
  await navigator.clipboard.writeText(text);
  toast("Copied to clipboard");
}
function download(name, content, type = "text/plain") {
  const a = document.createElement("a");
  a.href = typeof content === "string" && content.startsWith("data:") ? content : URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
}
const slug = () => {
  try { return new URL(state.page.url).pathname.split("/").filter(Boolean).pop() || "page"; } catch { return "page"; }
};

// ---------- tabs ----------
document.querySelectorAll(".tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === `tab-${b.dataset.tab}`));
  })
);

async function refreshPageInfo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const info = $("pageInfo");
  if (!tab) return;
  const stale = state.page && state.page.url !== tab.url;
  info.textContent = stale ? `⚠ Results are for another page — rescan. Now: ${tab.title}` : tab.title || tab.url;
  info.title = tab.url || "";
}
chrome.tabs.onActivated.addListener(refreshPageInfo);
chrome.tabs.onUpdated.addListener((_id, change) => change.status === "complete" && refreshPageInfo());

// ---------- full scan ----------
$("runAll").addEventListener("click", (e) =>
  busy(e.currentTarget, "Scanning…", async () => {
    const tab = await activeTab();
    state.tabId = tab.id;
    state.aiHealth = state.aiStyle = null;
    $("aiHealthOut").hidden = $("aiStyleOut").hidden = true;

    const page = await inPage(tab.id, collectPage, [$("scope").value]);
    state.page = page;

    const linkUrls = [...new Set(page.links.map((l) => l.href))];
    const truncated = linkUrls.length > MAX_LINKS;
    const toCheck = [...linkUrls.slice(0, MAX_LINKS), ...page.images.map((i) => i.src)];
    $("runAll").innerHTML = `<span class="spinner"></span>Checking ${toCheck.length} URLs…`;
    const results = await send({ type: "checkUrls", urls: toCheck });

    buildHealth(page, results, truncated);
    renderHealth();
    await runStyle();
    refreshPageInfo();
    const broken = state.health.filter((f) => f.severity === "High").length;
    toast(`Scan done: ${broken} high-severity issue(s), ${state.style.length} style finding(s).`);
  })
);

function buildHealth(page, results, truncated) {
  const out = [];
  const passed = [];
  const seen = new Map();
  for (const l of page.links) {
    if (seen.has(l.href)) { seen.get(l.href).count++; continue; }
    seen.set(l.href, { ...l, count: 1 });
  }
  for (const l of seen.values()) {
    const r = results[l.href];
    if (!r) continue;
    const where = `${l.internal ? "Internal" : "External"} · link text “${l.text || "(none)"}”${l.count > 1 ? ` · ${l.count}× on page` : ""}`;
    if (r.status >= 400) out.push({ cat: "link", severity: "High", title: `Broken link (${r.status})`, url: l.href, status: r.status, detail: where });
    else if (r.status === 0) out.push({ cat: "link", severity: "Medium", title: `Could not verify (${r.error})`, url: l.href, status: 0, detail: `${where} · may block automated checks; open it manually` });
    else if (r.redirected) out.push({ cat: "link", severity: "Low", title: `Redirect (${r.status})`, url: l.href, status: r.status, detail: `→ ${r.finalUrl} · update the link to the final URL` });
    else passed.push({ cat: "ok", severity: "OK", title: `OK (${r.status})`, url: l.href, status: r.status, detail: where });
  }
  if (truncated) out.push({ cat: "link", severity: "Low", title: `Only the first ${MAX_LINKS} links were checked`, detail: "Switch scope to “Content area only” or check the rest with your crawler." });
  for (const a of page.brokenAnchors) out.push({ cat: "link", severity: "Medium", title: "Missing in-page anchor", url: a.href, detail: `No element with this id · link text “${a.text}”` });
  for (const g of page.genericText) out.push({ cat: "link", severity: "Low", title: "Generic link text", url: g.href, detail: `“${g.text}” — use descriptive text` });

  const imgSeen = new Set();
  for (const img of page.images) {
    if (imgSeen.has(img.src)) continue;
    imgSeen.add(img.src);
    const r = results[img.src] || {};
    if (img.domBroken || r.status >= 400) out.push({ cat: "image", severity: "High", title: `Broken image${r.status ? ` (${r.status})` : ""}`, url: img.src, status: r.status, detail: `alt: “${img.alt ?? "(missing)"}”` });
    else if (r.status === 0 && !img.loaded) out.push({ cat: "image", severity: "Medium", title: "Image could not be verified", url: img.src, detail: r.error || "" });
    else if (r.ok && r.contentType && !/^image\//.test(r.contentType)) out.push({ cat: "image", severity: "Medium", title: "Image URL does not return an image", url: img.src, detail: `Content-Type: ${r.contentType}` });
    else passed.push({ cat: "ok", severity: "OK", title: `Image OK (${r.status || "loaded"})`, url: img.src, detail: "" });
    if (img.alt === null) out.push({ cat: "image", severity: "Medium", title: "Missing alt text", url: img.src, detail: "Add alt text (or alt=\"\" if decorative)" });
  }

  const s = page.seo;
  const seo = (severity, title, detail = "") => out.push({ cat: "seo", severity, title, detail });
  if (!s.title) seo("High", "Missing <title>");
  else if (s.title.length < 15 || s.title.length > 65) seo("Low", `Title length ${s.title.length} chars`, `Aim for 15–65 · “${s.title}”`);
  if (!s.metaDescription) seo("Medium", "Missing meta description");
  else if (s.metaDescription.length > 160 || s.metaDescription.length < 50) seo("Low", `Meta description length ${s.metaDescription.length} chars`, "Aim for 50–160");
  if (!s.h1s.length) seo("Medium", "No H1 heading");
  else if (s.h1s.length > 1) seo("Low", `${s.h1s.length} H1 headings`, s.h1s.join(" | "));
  for (const k of s.headingSkips) seo("Low", "Skipped heading level", k);
  if (!s.canonical) seo("Low", "Missing canonical link");
  if (/noindex/i.test(s.robots)) seo("Medium", "Page is set to noindex", s.robots);
  if (!s.lang) seo("Low", "Missing <html lang>");
  if (!s.ogTitle || !s.ogImage) seo("Low", "Incomplete Open Graph tags", `${!s.ogTitle ? "og:title " : ""}${!s.ogImage ? "og:image" : ""}`.trim() + " missing");
  for (const m of s.mixedContent) seo("Medium", "Mixed content (http on https page)", m);

  out.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  state.health = out;
  state.passed = passed;
  state.linkCount = seen.size;
  state.imageCount = imgSeen.size;
}

function renderHealth() {
  $("healthEmpty").hidden = true;
  $("healthBody").hidden = false;
  const h = state.health;
  const count = (fn) => h.filter(fn).length;
  const stats = [
    ["Links checked", state.linkCount, false],
    ["Broken links", count((f) => f.cat === "link" && f.severity === "High"), true],
    ["Redirects", count((f) => f.title.startsWith("Redirect")), false],
    ["Broken images", count((f) => f.cat === "image" && f.severity === "High"), true],
    ["Missing alt", count((f) => f.title === "Missing alt text"), true],
    ["SEO issues", count((f) => f.cat === "seo"), false],
  ];
  $("stats").innerHTML = stats
    .map(([label, n, bad]) => `<div class="stat ${bad && n ? "bad" : ""}"><b>${n}</b><span>${label}</span></div>`)
    .join("");
  const list = state.filter === "ok" ? state.passed : state.filter === "all" ? h : h.filter((f) => f.cat === state.filter);
  $("healthList").innerHTML = list.length
    ? list.map((f) => `<li><div class="head"><span class="sev ${f.severity}">${f.severity}</span><span class="title">${esc(f.title)}</span></div>
        ${f.url ? `<div class="detail"><a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.url)}</a></div>` : ""}
        ${f.detail ? `<div class="detail">${esc(f.detail)}</div>` : ""}</li>`).join("")
    : `<li class="detail">Nothing here 🎉</li>`;
}
$("filters").addEventListener("click", (e) => {
  const b = e.target.closest(".chip");
  if (!b) return;
  state.filter = b.dataset.f;
  document.querySelectorAll("#filters .chip").forEach((c) => c.classList.toggle("active", c === b));
  renderHealth();
});

// ---------- AI health summary ----------
$("aiHealth").addEventListener("click", (e) =>
  busy(e.currentTarget, "Thinking…", async () => {
    if (!state.page) throw new Error("Scan the page first.");
    const ai = await send({
      type: "ai", task: "healthSummary",
      payload: { url: state.page.url, title: state.page.title, findings: state.health.map(({ severity, cat, title, url, detail }) => ({ severity, cat, title, url, detail })) },
    });
    state.aiHealth = ai;
    const box = $("aiHealthOut");
    box.hidden = false;
    box.innerHTML = `
      <h3>Health score</h3><div class="score">${esc(ai.healthScore)}/100</div><p>${esc(ai.summary)}</p>
      <h3>Priorities</h3>
      <ul class="findings">${(ai.priorities || []).map((p) => `<li><div class="head"><span class="sev ${esc(p.severity)}">${esc(p.severity)}</span><span class="title">${esc(p.issue)}</span></div><div class="detail">${esc(p.impact)}</div><div class="detail"><b>Fix:</b> ${esc(p.fix)}</div></li>`).join("")}</ul>
      <h3>Jira ticket <button data-copy="jira">Copy</button></h3><pre>${esc(ai.jira)}</pre>
      <h3>Slack update <button data-copy="slack">Copy</button></h3><pre>${esc(ai.slack)}</pre>`;
    box.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", () => copy(ai[b.dataset.copy] || "")));
  })
);

// ---------- exports ----------
$("exportCsv").addEventListener("click", () => {
  const rows = [["Severity", "Category", "Issue", "URL", "Status", "Detail"], ...[...state.health, ...state.passed].map((f) => [f.severity, f.cat, f.title, f.url || "", f.status ?? "", f.detail || ""])];
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  download(`doclens-${slug()}-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv");
});
$("exportMd").addEventListener("click", () => download(`doclens-${slug()}-${new Date().toISOString().slice(0, 10)}.md`, markdownReport(), "text/markdown"));

function markdownReport() {
  const p = state.page;
  const lines = [`# DocLens report — ${p.title}`, "", `- **URL:** ${p.url}`, `- **Scanned:** ${new Date().toLocaleString()}`, `- **Scope:** ${p.scope}`, `- **Links checked:** ${state.linkCount} · **Images:** ${state.imageCount}`, ""];
  if (state.aiHealth) lines.push(`## AI summary (score ${state.aiHealth.healthScore}/100)`, "", state.aiHealth.summary, "");
  lines.push("## Health findings", "", "| Severity | Category | Issue | URL | Detail |", "|---|---|---|---|---|");
  for (const f of state.health) lines.push(`| ${f.severity} | ${f.cat} | ${f.title} | ${f.url || ""} | ${(f.detail || "").replace(/\|/g, "\\|")} |`);
  lines.push("", "## Style findings", "", "| Severity | Rule | Match | Context |", "|---|---|---|---|");
  for (const f of state.style) lines.push(`| ${f.severity} | ${f.rule} | ${f.match} | ${f.context.replace(/\|/g, "\\|")} |`);
  if (state.aiStyle?.issues?.length) {
    lines.push("", "## AI rewrite suggestions", "");
    for (const i of state.aiStyle.issues) lines.push(`- **${i.rule}** (${i.severity})`, `  - Original: ${i.original}`, `  - Rewrite: ${i.rewrite}`);
  }
  return lines.join("\n");
}

// ---------- style ----------
async function runStyle() {
  if (!state.tabId) return;
  state.style = (await inPage(state.tabId, lintStyle, [STYLE_RULES, $("highlight").checked])) || [];
  state.style.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  renderStyle();
}
function renderStyle() {
  $("styleEmpty").hidden = true;
  $("styleBody").hidden = false;
  const by = (s) => state.style.filter((f) => f.severity === s).length;
  const rulesHit = new Set(state.style.map((f) => f.ruleId)).size;
  $("styleStats").innerHTML = [["Findings", state.style.length], ["High", by("High")], ["Medium", by("Medium")], ["Low", by("Low")], ["Rules hit", rulesHit], ["Rules", STYLE_RULES.length + 1]]
    .map(([l, n]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join("");
  $("styleList").innerHTML = state.style.length
    ? state.style.map((f) => `<li class="${f.id ? "clickable" : ""}" data-mark="${f.id || ""}" title="${f.id ? "Click to jump to it on the page" : ""}">
        <div class="head"><span class="sev ${f.severity}">${f.severity}</span><span class="title">${esc(f.rule)}</span></div>
        <div class="detail">${esc(f.context).replace(esc(f.match), `<mark>${esc(f.match)}</mark>`)}</div>
        <div class="detail">💡 ${esc(f.suggestion)}</div></li>`).join("")
    : `<li class="detail">No rule-based style issues found 🎉 Try the AI review for deeper checks.</li>`;
}
$("styleList").addEventListener("click", async (e) => {
  const li = e.target.closest("li[data-mark]");
  if (!li?.dataset.mark || !state.tabId) return;
  if (!$("highlight").checked) return toast("Turn on “Highlight issues on the page” to jump to findings.");
  const found = await inPage(state.tabId, scrollToMark, [li.dataset.mark]);
  if (!found) toast("That spot changed — rescan the page.");
});
$("highlight").addEventListener("change", async () => {
  if (!state.tabId) return;
  if ($("highlight").checked) await runStyle();
  else await inPage(state.tabId, clearHighlights);
});

$("aiStyle").addEventListener("click", (e) =>
  busy(e.currentTarget, "Reviewing…", async () => {
    if (!state.page) throw new Error("Scan the page first.");
    const ai = await send({ type: "ai", task: "styleReview", payload: { url: state.page.url, text: state.page.text } });
    state.aiStyle = ai;
    const box = $("aiStyleOut");
    box.hidden = false;
    const issues = ai.issues || [];
    box.innerHTML = `<h3>Verdict</h3><p>${esc(ai.overall)}</p>
      <h3>${issues.length} suggested rewrite(s) <button id="copyRewrites">Copy all</button></h3>
      ${issues.map((i, n) => `<div class="rewrite"><span class="sev ${esc(i.severity)}">${esc(i.severity)}</span> <b>${esc(i.rule)}</b>
        <div><del>${esc(i.original)}</del><ins>✓ ${esc(i.rewrite)}</ins></div>
        <button data-n="${n}" class="copyOne">Copy rewrite</button></div>`).join("")}`;
    box.querySelectorAll(".copyOne").forEach((b) => b.addEventListener("click", () => copy(issues[b.dataset.n].rewrite)));
    $("copyRewrites").addEventListener("click", () => copy(issues.map((i) => `- ${i.rule}\n  Original: ${i.original}\n  Rewrite: ${i.rewrite}`).join("\n")));
  })
);

// ---------- bug report ----------
$("capture").addEventListener("click", (e) =>
  busy(e.currentTarget, "Capturing…", async () => {
    const tab = await activeTab();
    state.screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    $("shot").src = state.screenshot;
    $("shot").hidden = false;
    toast("Screenshot captured");
  })
);

$("aiBug").addEventListener("click", (e) =>
  busy(e.currentTarget, "Writing report…", async () => {
    const tab = await activeTab();
    if (!$("bugNotes").value.trim()) throw new Error("Describe what went wrong first.");
    const page = state.page?.url === tab.url ? state.page : await inPage(tab.id, collectPage, ["content"]);
    const errors = $("incConsole").checked ? (await inPage(tab.id, readConsoleErrors, [], "MAIN")) || [] : [];
    state.consoleErrors = errors;
    $("consoleBox").hidden = !errors.length;
    $("consoleBox").textContent = errors.join("\n");

    const healthSnapshot = $("incHealth").checked && state.page?.url === tab.url
      ? state.health.filter((f) => f.severity !== "Low").slice(0, 15).map((f) => `${f.severity}: ${f.title} ${f.url || ""}`)
      : [];
    const ai = await send({
      type: "ai", task: "bugReport",
      payload: {
        notes: $("bugNotes").value, expected: $("bugExpected").value,
        url: tab.url, title: tab.title, userAgent: page.userAgent, viewport: page.viewport,
        timestamp: new Date().toISOString(), consoleErrors: errors, healthSnapshot, hasScreenshot: !!state.screenshot,
      },
    });
    state.aiBug = { ...ai, url: tab.url };
    renderBug();
  })
);

function bugAsJira(b) {
  return [`h2. ${b.title}`, "", `*Severity:* ${b.severity}  *Priority:* ${b.priority}  *Component:* ${b.component}`, `*URL:* ${b.url}`, `*Environment:* ${b.environment}`, "",
    "h3. Steps to reproduce", ...(b.steps || []).map((s) => `# ${s}`), "", "h3. Expected result", b.expected, "", "h3. Actual result", b.actual, "",
    b.notes ? `h3. Notes\n${b.notes}\n` : "", state.consoleErrors.length ? `h3. Console errors\n{noformat}\n${state.consoleErrors.join("\n")}\n{noformat}\n` : "",
    state.screenshot ? "_Screenshot attached._" : "", `Labels: ${(b.labels || []).join(", ")}`].join("\n");
}
function bugAsMarkdown(b) {
  return [`## ${b.title}`, "", `**Severity:** ${b.severity} · **Priority:** ${b.priority} · **Component:** ${b.component}`, `**URL:** ${b.url}`, `**Environment:** ${b.environment}`, "",
    "### Steps to reproduce", ...(b.steps || []).map((s, i) => `${i + 1}. ${s}`), "", "### Expected", b.expected, "", "### Actual", b.actual, "",
    b.notes ? `### Notes\n${b.notes}\n` : "", state.consoleErrors.length ? "### Console errors\n```\n" + state.consoleErrors.join("\n") + "\n```\n" : "",
    `Labels: ${(b.labels || []).join(", ")}`].join("\n");
}
function renderBug() {
  const b = state.aiBug;
  const box = $("aiBugOut");
  box.hidden = false;
  box.innerHTML = `<h3>${esc(b.title)}</h3>
    <p><span class="sev ${esc(b.severity)}">${esc(b.severity)}</span> ${esc(b.priority)} · ${esc(b.component)}</p>
    <p class="muted">${esc(b.environment)}</p>
    <h3>Steps</h3><ol>${(b.steps || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
    <h3>Expected</h3><p>${esc(b.expected)}</p><h3>Actual</h3><p>${esc(b.actual)}</p>
    ${b.notes ? `<h3>Notes</h3><p>${esc(b.notes)}</p>` : ""}
    <div class="actions"><button id="copyJira">Copy as Jira</button><button id="copyMd">Copy as Markdown</button>${state.screenshot ? `<button id="dlShot">Download screenshot</button>` : ""}</div>`;
  $("copyJira").addEventListener("click", () => copy(bugAsJira(b)));
  $("copyMd").addEventListener("click", () => copy(bugAsMarkdown(b)));
  $("dlShot")?.addEventListener("click", () => download(`bug-screenshot-${Date.now()}.png`, state.screenshot));
}

// ---------- settings ----------
async function loadSettings() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  $("provider").value = settings.provider || "groq";
  $("apiKey").value = settings.apiKey || "";
  $("model").value = settings.model || "";
  updateModelHint();
}
function updateModelHint() {
  $("modelHint").textContent = `(default: ${DEFAULT_MODELS[$("provider").value]})`;
}
$("provider").addEventListener("change", updateModelHint);
async function saveSettings() {
  const settings = { provider: $("provider").value, apiKey: $("apiKey").value.trim(), model: $("model").value.trim() };
  await chrome.storage.local.set({ settings });
  return settings;
}
$("saveSettings").addEventListener("click", async () => {
  await saveSettings();
  $("settingsMsg").textContent = "Saved.";
});
$("testKey").addEventListener("click", (e) =>
  busy(e.currentTarget, "Testing…", async () => {
    const settings = await saveSettings();
    if (!settings.apiKey) throw new Error("Paste an API key first.");
    await send({ type: "testKey", settings });
    $("settingsMsg").textContent = "✅ Connection works.";
  })
);

loadSettings();
refreshPageInfo();
