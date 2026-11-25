# DocLens – Docs QA Copilot

A Chrome extension that runs a full QA pass on any documentation page with one click. It does three jobs in one side panel:

| Tab | What it does | Needs AI key? |
|---|---|---|
| **Health** | Checks every link and image: 404s, redirects, unreachable URLs, missing `#anchors`, broken images, missing alt text, generic link text. Also checks SEO basics: title, meta description, H1, skipped heading levels, canonical, `lang`, Open Graph, mixed content. Exports to CSV or a full Markdown report. | No |
| | ✨ **AI summary**: health score, prioritised fixes, a ready-to-paste **Jira ticket** and **Slack update** | Yes |
| **Style** | Lints the page against 19 rules from the Contentstack docs style guide and **highlights each issue on the page**. Click a finding to jump to it. | No |
| | ✨ **AI style review**: finds deeper issues and suggests sentence rewrites you can copy | Yes |
| **Bug report** | Captures a screenshot, URL, browser, viewport, and **console errors**. ✨ AI writes a structured bug that you can copy as Jira markup or Markdown. | Yes |

All AI prompts follow the **ICEPOT** framework. See [ICEPOT.md](ICEPOT.md).

## Install (load unpacked)
1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this `NewExtension` folder.
3. Pin DocLens and click its icon. The side panel opens.
4. *(Optional, for the ✨ features)* Open **Settings**, choose a provider, paste an API key, and click **Test connection**.
   - **Groq** has a free key at console.groq.com and is the default.
   - **Anthropic Claude** (default model `claude-opus-5-5`) and **OpenAI** are also supported. You can type any model name.

## Try it on the demo page
`demo/sample-doc.html` has planted problems: a 404 link, a broken image, a missing anchor, "e-mail", "ContentStack", passive voice, and more. Link checks need a real server, so serve the folder:

```bash
cd ~/Desktop/Priyal/GenAICourse/NewExtension && python3 -m http.server 8765
```

Then open http://localhost:8765/demo/sample-doc.html and click **Scan this page**.

## How it works
```
manifest.json            MV3, side panel, <all_urls> host permission for link checks
background/sw.js         Message router: URL checker (HEAD → GET fallback, 8 parallel, 12 s timeout) + AI calls
background/ai.js         Groq / Anthropic / OpenAI client (raw fetch, key redacted from errors)
background/prompts.js    The three ICEPOT prompts
content/console-hook.js  Records console errors in the page so bug reports can include them
sidepanel/               UI (HTML/CSS/JS), page functions injected on demand, style rules
```

- Link checks run from the service worker **without cookies**, so you see what a logged-out reader sees.
- The **Content area only** scope checks `main`/`article`. **Whole page** also checks the nav and footer.
- Highlights are added only to the page in your tab and disappear on reload.

## Limitations
- **Google Docs editor pages** draw their text on a canvas, so the extension cannot read them. Use **File → Share → Publish to web** and scan the published link, or scan the live docs page.
- Some sites block automated requests. Those links show as **"Could not verify"**, not as broken.
- The passive-voice and long-sentence rules are heuristics. Treat them as suggestions.
