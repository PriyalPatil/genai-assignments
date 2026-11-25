# How DocLens uses the ICEPOT framework

ICEPOT shows up in two places in this assignment:

1. **Building the extension.** The vibe-coding prompt that describes DocLens is written in ICEPOT form.
2. **Inside the extension.** Each AI feature sends a prompt assembled from the six ICEPOT parts (see `background/prompts.js`).

| Letter | Part | What it does |
|---|---|---|
| **I** | Instruction | The task the AI must do |
| **C** | Context | The data it works from |
| **E** | Example | A sample of good output |
| **P** | Persona | The role the AI takes on |
| **O** | Output | The exact format of the answer |
| **T** | Tone | How the answer should sound |

---

## 1. Vibe-coding prompt used to build DocLens

> **Persona:** You are a senior Chrome extension developer who also works as a documentation QA engineer.
>
> **Instruction:** Build a Manifest V3 Chrome extension called *DocLens – Docs QA Copilot* that combines three tools in one side panel:
> (A) **Docs Health Inspector**: checks every link and image on the current page (404s, redirects, missing anchors, broken images, missing alt text) and checks SEO basics (title, meta description, H1, heading order, canonical, lang, Open Graph, mixed content);
> (B) **Style Guide Linter**: highlights style-guide violations on the page and offers AI rewrites;
> (C) **Bug Report Generator**: captures a screenshot, URL, browser, and console errors, and uses AI to write a Jira-ready bug.
> Add an AI summary that writes a Jira ticket and a Slack update from the health findings, plus CSV and Markdown export.
>
> **Context:** I test the Contentstack documentation and Academy sites. Today I run separate Node scripts for broken links, broken images, and orphan pages, check pages against a 2,600-line style guide by hand, and write Jira bugs by hand. The TestLeaf reference extension (Ledge-3.0) shows the expected structure: side panel, service worker, content script, and multiple AI providers.
>
> **Example:** Clicking *Scan this page* on a docs page shows "2 broken links, 1 broken image, 6 SEO issues", highlights "e-mail", "ContentStack", and "will be triggered" on the page, and lets me copy a Jira ticket in one click.
>
> **Output:** A folder I can load unpacked: `manifest.json`, `background/` (service worker, AI client, ICEPOT prompts), `content/`, `sidepanel/` (HTML, CSS, JS), `icons/`, a demo page with planted bugs, and a README. Plain JavaScript, no build step.
>
> **Tone:** Clean, professional UI that supports dark mode, with plain-English messages and no jargon in errors.

---

## 2. ICEPOT prompts inside the extension

All three AI prompts are built by the `icepot()` helper in `background/prompts.js`. Persona, Tone, Output, and Example go in the **system** message. Instruction and Context go in the **user** message.

### a) Health summary → Jira + Slack
| | |
|---|---|
| **I** | Prioritise the findings, explain each one's impact, recommend a fix, and write a Jira ticket and a Slack update |
| **C** | Page URL, title, and the JSON findings from the automated scan |
| **E** | A sample JSON reply with a score, priorities, Jira text, and Slack text |
| **P** | Senior documentation QA engineer |
| **O** | Strict JSON: `healthScore`, `summary`, `priorities[]`, `jira`, `slack` |
| **T** | Concise and factual; never invent findings |

### b) Style review → rewrites
| | |
|---|---|
| **I** | Find sentences that break the style rules, quote each one exactly, and rewrite it |
| **C** | 15 rules taken from the Contentstack Technical Documentation Style Guide, plus the page text |
| **E** | A passive, future-tense sentence and its present-tense, active rewrite |
| **P** | Technical editor who enforces the style guide |
| **O** | Strict JSON: `issues[] {original, rule, rewrite, severity}`, `overall` |
| **T** | Helpful peer reviewer; rewrites must sound human |

### c) Bug report
| | |
|---|---|
| **I** | Turn the tester's notes and captured data into a reproducible bug report |
| **C** | Notes, expected result, URL, browser, viewport, console errors, health findings |
| **E** | A complete sample bug for a broken docs image |
| **P** | QA engineer writing for a docs/web platform team |
| **O** | Strict JSON: `title`, `severity`, `priority`, `component`, `environment`, `steps[]`, `expected`, `actual`, `notes`, `labels[]` |
| **T** | Neutral, objective, no blame |
