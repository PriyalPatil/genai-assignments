// Runs in the page's MAIN world at document_start so DocLens can include
// console errors and uncaught exceptions in bug reports. Keeps the last 50 only.
(() => {
  if (window.__docLensErrors) return;
  const buf = [];
  Object.defineProperty(window, "__docLensErrors", { value: buf, enumerable: false });
  const push = (kind, text) => {
    buf.push(`[${new Date().toISOString().slice(11, 19)}] ${kind}: ${String(text).slice(0, 500)}`);
    if (buf.length > 50) buf.shift();
  };
  const origError = console.error;
  console.error = function (...args) {
    try {
      push("console.error", args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === "object" ? safe(a) : a)).join(" "));
    } catch { /* never break the page */ }
    return origError.apply(this, args);
  };
  window.addEventListener("error", (e) => {
    if (e.target && e.target !== window && (e.target.src || e.target.href)) {
      push("resource failed", e.target.src || e.target.href);
    } else {
      push("uncaught", `${e.message} (${e.filename}:${e.lineno})`);
    }
  }, true);
  window.addEventListener("unhandledrejection", (e) => push("unhandled promise", e.reason?.stack || e.reason));
  function safe(o) { try { return JSON.stringify(o); } catch { return String(o); } }
})();
