// Every AI prompt in DocLens follows the ICEPOT framework:
//   I = Instruction   C = Context   E = Example   P = Persona   O = Output format   T = Tone
// Each prompt is assembled from those six labelled parts so the structure is visible and easy to grade.

function icepot({ instruction, context, example, persona, output, tone }) {
  const system = [
    `## Persona\n${persona}`,
    `## Tone\n${tone}`,
    `## Output format\n${output}`,
    `## Example\n${example}`,
  ].join("\n\n");
  const user = [`## Instruction\n${instruction}`, `## Context\n${context}`].join("\n\n");
  return { system, user };
}

const STYLE_RULES = `
- Use active voice. Passive voice only when the actor is unknown or irrelevant.
- Present tense: avoid "will" ("The system displays", not "The system will display").
- Do not use "please" in instructions.
- Use the Oxford comma.
- Preferred terms: email (not e-mail), plugin (not plug-in), add-on, dropdown, checkbox, frontend, backend, web, internet, online, Contentstack (one word).
- Avoid idioms and jargon ("out of the box", "move the needle", "boil the ocean").
- Prefer "for example" / "that is" / "such as" / "and so on" over "e.g." / "i.e." / "like" / "etc.".
- "i.e." and "e.g." are followed by a comma.
- Use "in the left navigation panel", not "on the left navigation panel".
- Say "horizontal ellipsis" / "vertical ellipsis", not "three dots".
- Use "three times", not "3X"; never use "+" to mean "and" or "more than".
- Descriptive link text, never "click here" or "learn more".
- Gender-neutral language (they/their).
- Avoid generic AI-sounding enthusiasm ("effortlessly", "seamlessly", "powerful tool").
- Keep sentences short (aim for under 25 words).`;

export function buildPrompt(task, p) {
  switch (task) {
    case "healthSummary":
      return {
        json: true,
        ...icepot({
          persona:
            "You are a senior documentation QA engineer who audits developer documentation sites for broken links, broken images, redirects, and SEO problems.",
          instruction:
            "Review the automated health-check results for one documentation page. Prioritise the problems, explain the impact of each in one sentence, and recommend the exact fix. Then write a short Jira ticket description and a Slack update the docs team can paste directly.",
          context: `Page URL: ${p.url}\nPage title: ${p.title}\n\nAutomated findings (JSON):\n${JSON.stringify(p.findings, null, 2).slice(0, 60000)}`,
          example: `{"healthScore":72,"summary":"2 broken links and 1 missing image on the Webhooks page.","priorities":[{"severity":"High","issue":"404 link to /docs/developers/old-webhooks","impact":"Readers following setup steps hit a dead end.","fix":"Update the href to /docs/developers/set-up-webhooks."}],"jira":"h3. Summary\\n...","slack":":rotating_light: Webhooks page: 2 broken links..."}`,
          output:
            'Return ONLY a JSON object with keys: "healthScore" (0-100 integer), "summary" (one sentence), "priorities" (array of {"severity":"High|Medium|Low","issue","impact","fix"}, most severe first, max 15), "jira" (Jira wiki-markup ticket body with h3 headings: Summary, Findings, Steps to verify, Acceptance criteria), "slack" (max 6 lines, Slack markdown).',
          tone: "Concise, factual, and action-oriented. No filler, no exaggeration. Do not invent findings that are not in the context.",
        }),
      };

    case "styleReview":
      return {
        json: true,
        ...icepot({
          persona:
            "You are a technical editor who enforces the Contentstack Technical Documentation Style Guide on developer docs.",
          instruction:
            "Read the documentation text and find sentences that break the style rules below. For each one, quote the original sentence exactly, name the rule, and give a corrected rewrite that keeps the technical meaning. Skip code samples, product UI labels, and API names. Report at most 25 issues, most important first.",
          context: `Style rules:${STYLE_RULES}\n\nPage URL: ${p.url}\n\nDocumentation text:\n"""\n${String(p.text).slice(0, 40000)}\n"""`,
          example: `{"issues":[{"original":"The entry will be published by the system once you click Save.","rule":"Active voice / present tense","rewrite":"The system publishes the entry when you click Save.","severity":"Medium"}],"overall":"Mostly clear; frequent use of future tense."}`,
          output:
            'Return ONLY a JSON object: {"issues":[{"original","rule","rewrite","severity":"High|Medium|Low"}],"overall":"one or two sentence verdict"}. "original" must be copied verbatim from the text.',
          tone: "Helpful and precise, like a friendly peer reviewer. Rewrites must sound human, not robotic.",
        }),
      };

    case "bugReport":
      return {
        json: true,
        ...icepot({
          persona:
            "You are a QA engineer who writes clear, reproducible bug reports for a documentation and web platform team.",
          instruction:
            "Turn the tester's notes and the captured page data into a complete bug report. Infer reasonable reproduction steps from the notes and URL. Choose severity from the evidence. Mention console errors only if they are relevant.",
          context: `Tester notes: ${p.notes || "(none)"}\nExpected result (tester): ${p.expected || "(not given)"}\nURL: ${p.url}\nPage title: ${p.title}\nBrowser: ${p.userAgent}\nViewport: ${p.viewport}\nCaptured at: ${p.timestamp}\nConsole errors:\n${(p.consoleErrors || []).slice(0, 20).join("\n") || "(none)"}\nPage health snapshot: ${JSON.stringify(p.healthSnapshot || {})}\nScreenshot attached: ${p.hasScreenshot ? "yes" : "no"}`,
          example: `{"title":"[Docs] Broken image in 'Create a Stack' step 3","severity":"Medium","priority":"P3","component":"Documentation","environment":"Chrome 131 on macOS, 1440x900","steps":["Open https://www.contentstack.com/docs/...","Scroll to step 3"],"expected":"Screenshot of the Create Stack modal is shown.","actual":"A broken image icon is shown.","notes":"Image URL returns 404.","labels":["docs","broken-image"]}`,
          output:
            'Return ONLY a JSON object with keys: "title" (max 90 chars, prefixed with an area tag in brackets), "severity" (Critical|High|Medium|Low), "priority" (P1-P4), "component", "environment", "steps" (array of strings), "expected", "actual", "notes", "labels" (array of lowercase strings).',
          tone: "Neutral, objective, and reproducible. No blame, no speculation beyond the evidence.",
        }),
      };

    default:
      throw new Error(`Unknown AI task: ${task}`);
  }
}
