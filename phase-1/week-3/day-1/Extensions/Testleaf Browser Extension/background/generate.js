// Port of NaviCase handleGenerate: manual test cases from the recorded journey.
// Same validation caps, prompt, parsing, priority filter and result shape.

import { buildPrompt, normalizeResult } from "./prompts/prompt.js";
import { parseModelJsonLenient } from "./jsonRepair.js";
import { resolveModelOptions } from "./llm/options.js";
import { callModel } from "./llm/callModel.js";
import { HttpError } from "./llm/http.js";
import { buildUsage } from "./usage.js";
import { COVERAGE_TYPES, PRIORITIES, MAX_EVENTS } from "../shared/constants.js";

export async function handleGenerate(payload, { onStage = () => {} } = {}) {
  const options = resolveModelOptions(payload);
  const events = Array.isArray(payload.events) ? payload.events.slice(-MAX_EVENTS) : [];
  const coverage = Array.isArray(payload.coverage) ? payload.coverage.filter((c) => COVERAGE_TYPES.includes(c)) : [];
  const requested = Array.isArray(payload.priorities) ? PRIORITIES.filter((p) => payload.priorities.includes(p)) : [];
  const priorities = requested.length ? requested : PRIORITIES;
  const language = String(payload.language || "US English").slice(0, 40);
  const customPrompt = payload.useCustomPrompt ? String(payload.customPrompt || "").slice(0, 6000) : "";
  const maxCases = Math.min(40, Math.max(5, Number(payload.maxCases) || 15));
  const page = payload.page && typeof payload.page === "object" ? payload.page : {};

  const warnings = [];
  const { system, user } = buildPrompt({ events, page, language, coverage, priorities, customPrompt, maxCases });
  onStage("calling");
  const reply = await callModel({ ...options, system, user, json: true });
  onStage("parsing");

  if (reply.truncated) warnings.push("The model hit its output limit; the last test case may be incomplete.");
  let result;
  try {
    result = normalizeResult(parseModelJsonLenient(reply.text));
  } catch (err) {
    throw new HttpError(502, `${err.message}. Try again or pick a different model.`);
  }
  if (!result.testCases.length) throw new HttpError(502, "The model returned no test cases");

  // Drop any case outside the selected priorities, then renumber so IDs stay consecutive.
  const kept = result.testCases.filter((tc) => priorities.includes(tc.priority));
  if (kept.length < result.testCases.length) {
    warnings.push(`Removed ${result.testCases.length - kept.length} test case(s) outside the selected priorities (${priorities.join(", ")}).`);
    if (!kept.length) throw new HttpError(502, `The model returned no ${priorities.join("/")} priority test cases. Try again.`);
    result.testCases = kept.map((tc, i) => ({ ...tc, id: `TC-${String(i + 1).padStart(3, "0")}` }));
  }

  return {
    ...result,
    meta: {
      provider: options.provider,
      model: options.model,
      priorities,
      eventCount: events.length,
      generatedAt: new Date().toISOString(),
    },
    usage: buildUsage(options.model, reply.inputTokens, reply.outputTokens, reply.reasoningTokens),
    warnings,
  };
}
