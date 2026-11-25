// DocLens service worker: opens the side panel, checks URLs, and calls the AI provider.
import { callModel, testConnection } from "./ai.js";
import { buildPrompt } from "./prompts.js";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handlers = {
    checkUrls: () => checkUrls(msg.urls || []),
    ai: () => runAi(msg.task, msg.payload),
    testKey: () => testConnection(msg.settings),
  };
  const handler = handlers[msg?.type];
  if (!handler) return false;
  handler()
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true; // keep the channel open for the async response
});

// ---------- AI ----------
async function runAi(task, payload) {
  const { settings } = await chrome.storage.local.get("settings");
  if (!settings?.apiKey) throw new Error("Add an API key in the Settings tab first.");
  const { system, user, json } = buildPrompt(task, payload);
  const text = await callModel(settings, { system, user, json });
  return json ? parseJson(text) : text;
}

function parseJson(text) {
  const cleaned = String(text).replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("The AI reply was not valid JSON. Try again or pick another model.");
  }
}

// ---------- Link / image checking ----------
const TIMEOUT_MS = 12000;
const CONCURRENCY = 8;

async function checkUrls(urls) {
  const unique = [...new Set(urls)];
  const results = {};
  let i = 0;
  async function worker() {
    while (i < unique.length) {
      const url = unique[i++];
      results[url] = await checkOne(url);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, worker));
  return results;
}

async function checkOne(url) {
  const started = Date.now();
  let res = await tryFetch(url, "HEAD");
  // Many servers reject HEAD; retry those with GET before calling the link broken.
  if (!res.status || [403, 405, 501].includes(res.status)) {
    const viaGet = await tryFetch(url, "GET");
    if (viaGet.status) res = viaGet;
  }
  return { ...res, ms: Date.now() - started };
}

async function tryFetch(url, method) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method,
      redirect: "follow",
      credentials: "omit", // check what a logged-out reader sees
      cache: "no-store",
      signal: controller.signal,
    });
    if (method === "GET") r.body?.cancel().catch(() => {});
    return {
      status: r.status,
      ok: r.ok,
      redirected: r.redirected,
      finalUrl: r.url,
      contentType: r.headers.get("content-type") || "",
    };
  } catch (err) {
    return { status: 0, ok: false, error: err.name === "AbortError" ? "Timed out" : "Network error / blocked" };
  } finally {
    clearTimeout(timer);
  }
}
