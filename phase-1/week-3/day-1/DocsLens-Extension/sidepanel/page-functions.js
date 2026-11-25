// Functions injected into the inspected page with chrome.scripting.executeScript.
// Each one must be fully self-contained: no imports, no outer variables.

/** Collect links, images, SEO data, and content text from the page. */
export function collectPage(scope) {
  const root =
    scope === "page"
      ? document.body
      : document.querySelector("main article, article, main, [role=main], .doc-content, .markdown-body, #content") || document.body;

  const abs = (u) => { try { return new URL(u, location.href).href; } catch { return null; } };
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

  // Links
  const links = [];
  const brokenAnchors = [];
  const genericText = [];
  const GENERIC = /^(click here|here|learn more|read more|more|this link|link)$/i;
  for (const a of root.querySelectorAll("a[href]")) {
    const raw = a.getAttribute("href").trim();
    const text = clean(a.innerText || a.getAttribute("aria-label") || a.title).slice(0, 120);
    if (!raw || /^(mailto:|tel:|javascript:|data:)/i.test(raw)) continue;
    if (raw.startsWith("#")) {
      const id = decodeURIComponent(raw.slice(1));
      if (id && !document.getElementById(id) && !document.getElementsByName(id).length) {
        brokenAnchors.push({ href: raw, text });
      }
      continue;
    }
    const href = abs(raw);
    if (!href || !/^https?:/.test(href)) continue;
    if (GENERIC.test(text)) genericText.push({ href, text });
    const u = new URL(href);
    // Same-page hash links on this URL: verify the target id exists.
    if (u.hash && u.origin + u.pathname === location.origin + location.pathname) {
      const id = decodeURIComponent(u.hash.slice(1));
      if (id && !document.getElementById(id) && !document.getElementsByName(id).length) brokenAnchors.push({ href: raw, text });
      continue;
    }
    u.hash = "";
    links.push({ href: u.href, text, internal: u.hostname === location.hostname });
  }

  // Images
  const images = [];
  for (const img of root.querySelectorAll("img")) {
    const src = img.currentSrc || img.src;
    if (!src || src.startsWith("data:")) continue;
    images.push({
      src,
      alt: img.getAttribute("alt"),
      domBroken: img.complete && img.naturalWidth === 0,
      loaded: img.complete && img.naturalWidth > 0,
    });
  }

  // SEO / structure (always whole document)
  const meta = (sel) => document.querySelector(sel)?.getAttribute("content") || "";
  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
    .filter((h) => h.offsetParent !== null || h.getClientRects().length)
    .map((h) => ({ level: +h.tagName[1], text: clean(h.innerText).slice(0, 100) }));
  const skips = [];
  for (let i = 1; i < headings.length; i++) {
    if (headings[i].level > headings[i - 1].level + 1) {
      skips.push(`H${headings[i - 1].level} → H${headings[i].level} ("${headings[i].text}")`);
    }
  }
  const mixed = location.protocol === "https:"
    ? [...document.querySelectorAll("img[src^='http:'],script[src^='http:'],iframe[src^='http:'],link[href^='http:'][rel=stylesheet]")].map((e) => e.src || e.href)
    : [];

  const seo = {
    title: document.title,
    metaDescription: meta("meta[name=description]"),
    canonical: document.querySelector("link[rel=canonical]")?.href || "",
    robots: meta("meta[name=robots]"),
    lang: document.documentElement.lang,
    ogTitle: meta("meta[property='og:title']"),
    ogImage: meta("meta[property='og:image']"),
    h1s: headings.filter((h) => h.level === 1).map((h) => h.text),
    headingSkips: skips,
    mixedContent: mixed,
  };

  return {
    url: location.href,
    title: document.title,
    scope: root === document.body ? "whole page" : "content area",
    links,
    images,
    brokenAnchors,
    genericText,
    seo,
    text: clean(root.innerText).slice(0, 60000),
    viewport: `${innerWidth}x${innerHeight}`,
    userAgent: navigator.userAgent,
  };
}

/** Run regex style rules over content text nodes; optionally wrap matches in <mark>. */
export function lintStyle(rules, highlight) {
  // Remove previous highlights first.
  for (const m of document.querySelectorAll("mark[data-doclens]")) {
    m.replaceWith(document.createTextNode(m.textContent));
  }
  document.body.normalize();

  const root = document.querySelector("main article, article, main, [role=main], .doc-content, .markdown-body, #content") || document.body;
  const SKIP = "pre,code,script,style,noscript,textarea,kbd,samp,nav,header,footer,aside,[contenteditable=true]";
  const compiled = rules.map((r) => ({ ...r, re: new RegExp(r.pattern, r.flags.includes("g") ? r.flags : r.flags + "g") }));

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.nodeValue.trim() && !n.parentElement.closest(SKIP) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  const findings = [];
  let id = 0;
  for (const node of nodes) {
    const text = node.nodeValue;
    const hits = [];
    for (const r of compiled) {
      r.re.lastIndex = 0;
      let m;
      while ((m = r.re.exec(text))) {
        if (!m[0]) { r.re.lastIndex++; continue; }
        hits.push({ start: m.index, end: m.index + m[0].length, rule: r, match: m[0] });
      }
    }
    if (!hits.length) continue;
    hits.sort((a, b) => a.start - b.start);
    const kept = [];
    for (const h of hits) if (!kept.length || h.start >= kept[kept.length - 1].end) kept.push(h);

    const frag = document.createDocumentFragment();
    let pos = 0;
    for (const h of kept) {
      const markId = `dl-${++id}`;
      const ctxStart = Math.max(0, h.start - 50);
      findings.push({
        id: markId,
        ruleId: h.rule.id,
        rule: h.rule.name,
        severity: h.rule.severity,
        suggestion: h.rule.suggestion,
        match: h.match,
        context: (ctxStart > 0 ? "…" : "") + text.slice(ctxStart, h.end + 50).replace(/\s+/g, " ") + (h.end + 50 < text.length ? "…" : ""),
      });
      if (highlight) {
        frag.append(text.slice(pos, h.start));
        const mark = document.createElement("mark");
        mark.dataset.doclens = markId;
        mark.title = `DocLens: ${h.rule.name} — ${h.rule.suggestion}`;
        mark.style.cssText = `background:${h.rule.severity === "High" ? "#ffb4b4" : h.rule.severity === "Medium" ? "#ffe08a" : "#cde8ff"};color:inherit;border-radius:3px;padding:0 2px;outline:1px solid rgba(0,0,0,.15)`;
        mark.textContent = h.match;
        frag.append(mark);
        pos = h.end;
      }
    }
    if (highlight) {
      frag.append(text.slice(pos));
      node.replaceWith(frag);
    }
  }

  // Long sentences (reported, not highlighted).
  const sentences = (root.innerText || "").replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z])/);
  for (const s of sentences) {
    const words = s.trim().split(" ").length;
    if (words > 30 && words < 200) {
      findings.push({
        id: null, ruleId: "long", rule: "Long sentence", severity: "Low",
        suggestion: `Split this ${words}-word sentence (aim for under 25 words).`,
        match: `${words} words`, context: s.trim().slice(0, 220) + (s.length > 220 ? "…" : ""),
      });
    }
  }
  return findings;
}

export function clearHighlights() {
  for (const m of document.querySelectorAll("mark[data-doclens]")) m.replaceWith(document.createTextNode(m.textContent));
  document.body.normalize();
}

export function scrollToMark(markId) {
  const el = document.querySelector(`mark[data-doclens="${markId}"]`);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.animate([{ boxShadow: "0 0 0 4px #6c5ce7" }, { boxShadow: "0 0 0 0 transparent" }], { duration: 1200, iterations: 2 });
  return true;
}

/** Runs in the MAIN world to read errors captured by console-hook.js. */
export function readConsoleErrors() {
  return Array.isArray(window.__docLensErrors) ? [...window.__docLensErrors] : [];
}
