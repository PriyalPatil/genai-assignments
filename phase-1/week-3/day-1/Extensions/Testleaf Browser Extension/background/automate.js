// Port of NaviCase handleAutomate: selected manual test cases → Playwright /
// Selenium script. Same validation caps, prompt, parsing and result shape.

import { FRAMEWORKS, buildAutomationPrompt, parseScript } from "./prompts/automationPrompt.js";
import { resolveModelOptions } from "./llm/options.js";
import { callModel } from "./llm/callModel.js";
import { HttpError } from "./llm/http.js";
import { buildUsage } from "./usage.js";
import { MAX_EVENTS } from "../shared/constants.js";

export async function handleAutomate(payload, { onStage = () => {} } = {}) {
  const options = resolveModelOptions(payload);
  const framework = String(payload.framework || "").toLowerCase();
  if (!FRAMEWORKS[framework]) throw new HttpError(400, `Unknown framework "${payload.framework}". Use one of: ${Object.keys(FRAMEWORKS).join(", ")}`);
  const fw = FRAMEWORKS[framework];
  // "languages" lists everything in the dropdown; when a framework has a "supported"
  // list, only those are generated. Without one (Playwright and Selenium today), every language is.
  const allowed = fw.supported || fw.languages;
  const language = fw.languages.includes(payload.language) ? payload.language : allowed[0];
  if (!allowed.includes(language)) throw new HttpError(400, `${fw.label} code generation is available only in ${allowed.join(" / ")}. Select ${allowed[0]} in the Language dropdown.`);
  const referenceScript = String(payload.referenceScript || "").slice(0, 20_000);
  const testCases = Array.isArray(payload.testCases) ? payload.testCases.slice(0, 40) : [];
  if (!testCases.length) throw new HttpError(400, "Select at least one manual test case to automate");
  const events = Array.isArray(payload.events) ? payload.events.slice(-MAX_EVENTS) : [];
  const page = payload.page && typeof payload.page === "object" ? payload.page : {};

  const warnings = [];
  const { system, user } = buildAutomationPrompt({ framework, language, referenceScript, testCases, events, page });
  onStage("calling");
  const reply = await callModel({ ...options, system, user, json: false });
  onStage("parsing");

  if (reply.truncated) warnings.push("The model hit its output limit; the script may be cut off. Select fewer test cases and try again.");
  const script = parseScript(reply.text);
  if (!script.code) throw new HttpError(502, "The model returned no script. Try again or pick a different model.");
  if (fw.supported && script.fence && !allowed.includes(script.fence)) throw new HttpError(502, `The model returned ${script.fence} code, but ${fw.label} scripts are generated only in ${allowed.join(" / ")}. Try again.`);
  if (!events.length) warnings.push("No recorded actions were available, so locators come only from the page snapshot.");

  return {
    framework,
    language: referenceScript.trim() && !fw.supported ? script.fence || language : language,
    code: script.code,
    gaps: script.gaps,
    caseIds: testCases.map((tc) => String(tc.id)),
    meta: { provider: options.provider, model: options.model, usedReference: Boolean(referenceScript.trim()), generatedAt: new Date().toISOString() },
    usage: buildUsage(options.model, reply.inputTokens, reply.outputTokens, reply.reasoningTokens),
    warnings,
  };
}
