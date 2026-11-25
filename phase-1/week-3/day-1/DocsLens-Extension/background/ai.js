// Minimal multi-provider AI client (raw fetch — no bundler in a Chrome extension).
// Supports Groq (free tier), Anthropic Claude, and OpenAI.

export const PROVIDERS = {
  groq: { label: "Groq (free tier)", defaultModel: "openai/gpt-oss-120b" },
  anthropic: { label: "Anthropic Claude", defaultModel: "claude-opus-5-5" },
  openai: { label: "OpenAI", defaultModel: "gpt-5-mini" },
};

const MAX_TOKENS = 16000;
const TIMEOUT_MS = 120000;

export async function callModel(settings, { system, user, json }) {
  const provider = settings.provider || "groq";
  const model = settings.model?.trim() || PROVIDERS[provider].defaultModel;
  if (provider === "anthropic") return callAnthropic(settings.apiKey, model, system, user);
  const url =
    provider === "groq"
      ? "https://api.groq.com/openai/v1/chat/completions"
      : "https://api.openai.com/v1/chat/completions";
  return callOpenAICompatible(url, settings.apiKey, model, system, user, json, provider);
}

export async function testConnection(settings) {
  const text = await callModel(settings, {
    system: "You are a connectivity check.",
    user: 'Reply with exactly: {"ok":true}',
    json: true,
  });
  return { reply: String(text).slice(0, 80) };
}

async function callAnthropic(apiKey, model, system, user) {
  const body = {
    model,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: "user", content: user }],
    fallbacks: "default", // server-side fallback if the model declines
  };
  const data = await post(
    "https://api.anthropic.com/v1/messages",
    {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "server-side-fallback-2026-07-01",
      // Required for calls made directly from a browser extension.
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body,
    "Anthropic",
    apiKey
  );
  if (data.stop_reason === "refusal") throw new Error("Claude declined this request.");
  if (data.stop_reason === "max_tokens") throw new Error("The reply was cut off (max tokens). Try a smaller page section.");
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
}

async function callOpenAICompatible(url, apiKey, model, system, user, json, provider) {
  const body = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_completion_tokens: MAX_TOKENS,
  };
  if (json) body.response_format = { type: "json_object" };
  const label = provider === "groq" ? "Groq" : "OpenAI";
  const data = await post(url, { Authorization: `Bearer ${apiKey}` }, body, label, apiKey);
  const text = data.choices?.[0]?.message?.content || "";
  return text.replace(/<think>[\s\S]*?<\/think>\s*/gi, "");
}

async function post(url, headers, body, label, secret) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* non-JSON error body */ }
    if (!res.ok) {
      const detail = data?.error?.message || data?.error || text.slice(0, 300);
      let hint = "";
      if (res.status === 401 || res.status === 403) hint = " — check your API key in Settings.";
      if (res.status === 404) hint = " — check the model name in Settings.";
      if (res.status === 429) hint = " — rate limit reached; wait a moment.";
      throw new Error(redact(`${label} ${res.status}: ${detail}${hint}`, secret));
    }
    return data;
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`${label} request timed out.`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const redact = (s, secret) => (secret && secret.length > 6 ? String(s).split(secret).join("[redacted]") : String(s));
