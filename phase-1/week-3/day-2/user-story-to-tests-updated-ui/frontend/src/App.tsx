import { Fragment, useEffect, useRef, useState } from 'react'
import { generateTests, getConfig } from './api'
import { AppConfig, ExportTestsResult, GenerateRequest, GenerateResponse, JiraStory, TestCase } from './types'
import { ModelSelector } from './components/ModelSelector'
import { JiraPanel } from './components/JiraPanel'
import { ApproveTestCases } from './components/ApproveTestCases'

const PREFS_KEY = 'llm-preferences'
const MAX_TEST_CASES = 50
const COUNT_PRESETS = [5, 10, 15, 20]
/** Must match backend/src/categories.ts */
const TEST_CATEGORIES: Array<{ name: string; icon: string; hint: string }> = [
  { name: 'Functional', icon: '✅', hint: 'Happy-path behaviour for each acceptance criterion' },
  { name: 'Negative', icon: '⛔', hint: 'Invalid input and error handling' },
  { name: 'Boundary', icon: '📏', hint: 'Min/max limits, just inside and outside' },
  { name: 'Edge Case', icon: '🧩', hint: 'Unusual but possible situations' },
  { name: 'UI', icon: '🖥️', hint: 'Layout, labels, messages, field states' },
  { name: 'Accessibility', icon: '♿', hint: 'Keyboard, screen readers, contrast (WCAG)' },
  { name: 'Security', icon: '🔒', hint: 'Auth, roles, injection, data exposure' },
  { name: 'Usability', icon: '🙂', hint: 'Ease of use and clarity' }
]
const CATEGORY_ORDER = TEST_CATEGORIES.map(c => c.name)

/** "Edge Case" -> "category-edge-case" */
function categoryClass(category: string): string {
  return `category-${category.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
}

/** Only one category is selected when the page loads */
const DEFAULT_CATEGORIES = ['Functional']

function categoryCounts(cases: TestCase[]): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const c of cases) counts.set(c.category, (counts.get(c.category) || 0) + 1)
  const rank = (k: string) => {
    const i = CATEGORY_ORDER.findIndex(c => c.toLowerCase() === k.toLowerCase())
    return i === -1 ? CATEGORY_ORDER.length : i
  }
  return [...counts.entries()].sort((a, b) => rank(a[0]) - rank(b[0]))
}

function App() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [autoSwitch, setAutoSwitch] = useState(true)
  /** '' = let the AI decide */
  const [testCaseCount, setTestCaseCount] = useState<string>('')
  const isCustomCount = testCaseCount !== '' && !COUNT_PRESETS.map(String).includes(testCaseCount)
  const [selectedCategories, setSelectedCategories] = useState<string[]>(DEFAULT_CATEGORIES)
  const outputRef = useRef<HTMLDivElement>(null)
  const scrollToOutput = () =>
    requestAnimationFrame(() => outputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))

  const toggleCategory = (name: string) => {
    setSelectedCategories(prev =>
      prev.includes(name)
        ? prev.filter(c => c !== name)
        : CATEGORY_ORDER.filter(c => c === name || prev.includes(c)) // keep canonical order
    )
  }
  const allCategoriesSelected = selectedCategories.length === CATEGORY_ORDER.length

  useEffect(() => {
    getConfig()
      .then(cfg => {
        setConfig(cfg)
        let prefs: { provider?: string; model?: string; autoSwitch?: boolean } = {}
        try { prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') } catch { /* ignore */ }
        const p = cfg.providers.find(x => x.id === prefs.provider) || cfg.providers[0]
        if (p) {
          setProvider(p.id)
          setModel(prefs.model && p.models.includes(prefs.model) ? prefs.model : p.defaultModel)
        }
        setAutoSwitch(prefs.autoSwitch ?? cfg.autoSwitchDefault)
      })
      .catch(err => setConfigError(`Could not reach the backend: ${err instanceof Error ? err.message : err}`))
  }, [])

  useEffect(() => {
    if (!provider) return
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ provider, model, autoSwitch })) } catch { /* ignore */ }
  }, [provider, model, autoSwitch])

  const handleProviderChange = (id: string) => {
    setProvider(id)
    const p = config?.providers.find(x => x.id === id)
    if (p) setModel(p.defaultModel)
  }

  const handleStorySelected = (story: JiraStory) => {
    const meta = [
      `Jira: ${story.key}`,
      story.issueType && `Type: ${story.issueType}`,
      story.priority && `Priority: ${story.priority}`,
      story.status && `Status: ${story.status}`,
      story.labels.length > 0 && `Labels: ${story.labels.join(', ')}`
    ].filter(Boolean).join(' | ')

    setLinkedStory({ key: story.key, id: story.id })
    setFormData({
      storyTitle: story.summary,
      description: story.description,
      acceptanceCriteria: story.acceptanceCriteria,
      additionalInfo: meta
    })
    setResults(null)
    setError(null)
  }

  const [formData, setFormData] = useState<GenerateRequest>({
    storyTitle: '',
    acceptanceCriteria: '',
    description: '',
    additionalInfo: ''
  })
  const [results, setResults] = useState<GenerateResponse | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedTestCases, setExpandedTestCases] = useState<Set<string>>(new Set())

  // ----- Approve test cases and send to Jira -----
  /** Jira story loaded via the Jira panel (test cases get linked to it) */
  const [linkedStory, setLinkedStory] = useState<{ key: string; id: string } | null>(null)
  /** Test case ids ticked for approval */
  const [approvalSelection, setApprovalSelection] = useState<Set<string>>(new Set())
  /** Test cases already sent: generator id -> key in the test management tool */
  const [sentCases, setSentCases] = useState<Map<string, { key: string; url?: string }>>(new Map())

  const selectableCases = results ? results.cases.filter(c => !sentCases.has(c.id)) : []
  const allApprovalSelected = selectableCases.length > 0 && selectableCases.every(c => approvalSelection.has(c.id))

  const toggleApproval = (id: string) => {
    setApprovalSelection(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAllApprovals = () => {
    setApprovalSelection(allApprovalSelected ? new Set() : new Set(selectableCases.map(c => c.id)))
  }

  const handleExported = (result: ExportTestsResult) => {
    setSentCases(prev => {
      const next = new Map(prev)
      for (const c of result.created) next.set(c.sourceId, { key: c.key, url: c.url })
      return next
    })
    setApprovalSelection(prev => {
      const next = new Set(prev)
      for (const c of result.created) next.delete(c.sourceId)
      return next
    })
  }

  const toggleTestCaseExpansion = (testCaseId: string) => {
    const newExpanded = new Set(expandedTestCases)
    if (newExpanded.has(testCaseId)) {
      newExpanded.delete(testCaseId)
    } else {
      newExpanded.add(testCaseId)
    }
    setExpandedTestCases(newExpanded)
  }

  const handleInputChange = (field: keyof GenerateRequest, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.storyTitle.trim() || !formData.acceptanceCriteria.trim()) {
      setError('Story Title and Acceptance Criteria are required')
      return
    }

    if (selectedCategories.length === 0) {
      setError('Select at least one test category')
      return
    }

    const count = testCaseCount.trim() ? Number(testCaseCount) : undefined
    if (count !== undefined && (!Number.isInteger(count) || count < 1 || count > MAX_TEST_CASES)) {
      setError(`Number of test cases must be a whole number between 1 and ${MAX_TEST_CASES}`)
      return
    }

    setIsLoading(true)
    setError(null)
    scrollToOutput()

    try {
      const response = await generateTests({
        ...formData,
        provider: provider || undefined,
        model: model || undefined,
        autoSwitch,
        testCaseCount: count,
        categories: selectedCategories
      })
      setResults(response)
      setApprovalSelection(new Set())
      setSentCases(new Map())
      scrollToOutput()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate tests')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div>
      <style>{`
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        :root {
          --bg: #f4f7f3;
          --surface: #ffffff;
          --border: #e3e8e0;
          --text: #1f2a24;
          --muted: #6b7a72;
          --brand: #00c853;
          --brand-dark: #009624;
          --brand-darker: #00791d;
          --brand-soft: #e6f7ec;
        }

        body {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
          color: var(--text);
          line-height: 1.6;
          min-height: 100vh;
          background:
            radial-gradient(900px 500px at 8% -8%, rgba(0,200,83,0.14), transparent 55%),
            radial-gradient(700px 400px at 100% 0%, rgba(0,200,83,0.08), transparent 50%),
            var(--bg);
          background-attachment: fixed;
        }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes floatGlow {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }

        @keyframes spin { to { transform: rotate(360deg); } }

        .container {
          max-width: 95%;
          width: 100%;
          margin: 0 auto;
          padding: 24px;
          min-height: 100vh;
        }

        @media (min-width: 768px) { .container { max-width: 92%; padding: 36px; } }
        @media (min-width: 1024px) { .container { max-width: 90%; padding: 44px; } }
        @media (min-width: 1600px) { .container { max-width: 1600px; padding: 52px; } }

        .header {
          text-align: center;
          margin-bottom: 40px;
          animation: fadeUp 0.6s ease both;
        }

        .badge-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 14px;
          border-radius: 999px;
          background: var(--brand-soft);
          border: 1px solid rgba(0,200,83,0.35);
          color: var(--brand-darker);
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 18px;
        }

        .badge-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: var(--brand);
          box-shadow: 0 0 12px var(--brand);
          animation: floatGlow 2.4s ease-in-out infinite;
        }

        .title {
          font-size: clamp(2.1rem, 5vw, 3.2rem);
          font-weight: 800;
          letter-spacing: -0.02em;
          color: var(--text);
          margin-bottom: 12px;
        }
        .title .accent { color: var(--brand-dark); }

        .subtitle {
          color: var(--muted);
          font-size: 1.05rem;
          max-width: 560px;
          margin: 0 auto;
        }

        /* Stacked workspace: horizontal input form on top, results below */
        .workspace {
          display: flex;
          flex-direction: column;
          gap: 26px;
        }

        .form-container {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 18px;
          padding: 24px 28px;
          box-shadow: 0 10px 30px rgba(31,42,36,0.06);
          animation: fadeUp 0.6s ease 0.08s both;
        }

        .form-group { margin-bottom: 18px; min-width: 0; }

        /* Horizontal rows inside the form */
        .form-row { display: grid; gap: 18px 22px; align-items: start; }
        .form-row > .form-group { margin-bottom: 0; }
        .form-row + .form-group, .form-group + .form-row, .form-row + .form-row { margin-top: 0; }
        .form-row { margin-bottom: 18px; }

        /* AI engine + Jira: side by side, a single panel fills the row */
        .panels-row { grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr)); align-items: stretch; }
        @media (max-width: 600px) {
          .container { padding: 16px; }
          .form-container { padding: 18px 16px; }
          .results-container { padding: 18px 16px; }
        }
        .panels-row .panel { margin-bottom: 0; }
        .panels-row > div { min-width: 0; display: flex; flex-direction: column; }
        .panels-row > div > .panel { flex: 1; }

        .cols-3 { grid-template-columns: 1fr; }
        .options-row { grid-template-columns: 1fr; }
        @media (min-width: 900px) {
          .cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
          .options-row { grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); }
        }
        .options-row .count-group { margin-top: 0; }

        .form-actions {
          display: flex;
          justify-content: flex-end;
          padding-top: 18px;
          border-top: 1px solid var(--border);
        }
        .form-actions .submit-btn { margin-top: 0; width: auto; min-width: 260px; }
        @media (max-width: 600px) {
          .form-actions .submit-btn { width: 100%; min-width: 0; }
        }

        .form-label {
          display: block;
          font-weight: 600;
          margin-bottom: 8px;
          color: var(--text);
          font-size: 14px;
        }
        .form-label .req { color: var(--brand-dark); margin-left: 3px; }

        .form-input, .form-textarea {
          width: 100%;
          padding: 12px 14px;
          border: 1px solid var(--border);
          border-radius: 11px;
          font-size: 14px;
          color: var(--text);
          background: #fbfdfa;
          transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
          font-family: inherit;
        }

        .form-input::placeholder, .form-textarea::placeholder { color: #9aa89f; }

        .form-input:focus, .form-textarea:focus {
          outline: none;
          border-color: var(--brand);
          background: #fff;
          box-shadow: 0 0 0 4px rgba(0,200,83,0.18);
        }

        .form-textarea { resize: none; min-height: 96px; }
        .form-textarea.tall { min-height: 120px; }

        .submit-btn {
          margin-top: 20px;
          width: 100%;
          background: linear-gradient(120deg, var(--brand), var(--brand-dark));
          color: #fff;
          border: none;
          padding: 13px 28px;
          border-radius: 12px;
          font-size: 15px;
          font-weight: 700;
          letter-spacing: 0.02em;
          cursor: pointer;
          transition: transform 0.15s ease, box-shadow 0.25s ease, filter 0.2s;
          box-shadow: 0 8px 22px rgba(0,200,83,0.35);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
        }

        .submit-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 14px 30px rgba(0,200,83,0.45);
          filter: brightness(1.03);
        }
        .submit-btn:active:not(:disabled) { transform: translateY(0); }

        .submit-btn:disabled {
          cursor: not-allowed;
          background: #c6d4bb;
          box-shadow: none;
        }

        .btn-spinner {
          width: 16px; height: 16px;
          border: 2px solid rgba(255,255,255,0.5);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }

        .output-col { min-width: 0; }

        .error-banner {
          background: #fdeceb;
          border: 1px solid #f5c2be;
          color: #b3261e;
          padding: 14px 18px;
          border-radius: 12px;
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          gap: 10px;
          animation: fadeUp 0.3s ease both;
        }

        .placeholder-card {
          background:
            radial-gradient(400px 200px at 50% 0%, rgba(0,200,83,0.08), transparent 70%),
            var(--surface);
          border: 1px dashed rgba(0,200,83,0.45);
          border-radius: 18px;
          padding: 40px 34px;
          text-align: center;
          color: var(--muted);
          min-height: 240px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          animation: fadeUp 0.5s ease both;
        }
        .placeholder-icon {
          width: 76px;
          height: 76px;
          border-radius: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 36px;
          background: var(--brand-soft);
          border: 1px solid rgba(0,200,83,0.35);
          margin-bottom: 20px;
          animation: floatGlow 3s ease-in-out infinite;
        }
        .placeholder-title {
          font-size: 1.25rem;
          font-weight: 700;
          color: var(--text);
          margin-bottom: 8px;
        }
        .placeholder-text { max-width: 360px; font-size: 14.5px; }
        .placeholder-hints {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          justify-content: center;
          margin-top: 22px;
        }
        .placeholder-hints .meta-chip { background: #f3f6ef; }

        .loading {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 18px;
          text-align: center;
          padding: 56px 30px;
          color: var(--muted);
          font-size: 16px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          box-shadow: 0 10px 30px rgba(31,42,36,0.06);
        }
        .loading .big-spinner {
          width: 42px; height: 42px;
          border: 3px solid rgba(0,200,83,0.2);
          border-top-color: var(--brand-dark);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        .results-container {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 18px;
          padding: 30px;
          box-shadow: 0 10px 30px rgba(31,42,36,0.06);
          animation: fadeUp 0.5s ease both;
        }

        .results-header {
          margin-bottom: 20px;
          padding-bottom: 18px;
          border-bottom: 1px solid var(--border);
        }

        .results-title {
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--text);
          margin-bottom: 12px;
        }

        .results-meta { display: flex; flex-wrap: wrap; gap: 8px; }
        .meta-chip {
          font-size: 12.5px;
          color: var(--brand-darker);
          background: var(--brand-soft);
          border: 1px solid rgba(0,200,83,0.3);
          padding: 5px 12px;
          border-radius: 999px;
          font-weight: 600;
        }

        .table-container { overflow-x: auto; border-radius: 12px; }

        .results-table {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          margin-top: 6px;
        }

        .results-table th {
          background: #f6f9f2;
          font-weight: 700;
          color: var(--muted);
          text-transform: uppercase;
          font-size: 11.5px;
          letter-spacing: 0.06em;
          padding: 13px 14px;
          text-align: left;
          border-bottom: 1px solid var(--border);
        }

        .results-table td {
          padding: 14px;
          text-align: left;
          border-bottom: 1px solid #eef1ec;
          color: var(--text);
          font-size: 14px;
          vertical-align: top;
        }

        .results-table tbody tr.row-main { transition: background 0.15s; }
        .results-table tbody tr.row-main:hover { background: #f7faf3; }

        .cat-badge {
          display: inline-flex;
          align-items: center;
          padding: 4px 12px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 600;
          border: 1px solid transparent;
          text-transform: capitalize;
        }
        .category-positive { color: #1f8a4c; background: #e6f6ec; border-color: #b7e4c7; }
        .category-negative { color: #c0392b; background: #fdecea; border-color: #f5c2be; }
        .category-edge { color: #b8860b; background: #fcf3d9; border-color: #f0dca0; }
        .category-authorization { color: #7d3cc0; background: #f3e9fb; border-color: #ddc6f2; }
        .category-non-functional { color: #2b6cb0; background: #e7f0fa; border-color: #c0d8f0; }
        .category-functional { color: #1f8a4c; background: #e6f6ec; border-color: #b7e4c7; }
        .category-boundary { color: #a14d00; background: #fdefe2; border-color: #f3cfa8; }
        .category-edge-case { color: #8a6a00; background: #fcf3d9; border-color: #f0dca0; }
        .category-ui { color: #0b6e79; background: #e2f5f7; border-color: #b0e0e6; }
        .category-accessibility { color: #2b5cb0; background: #e7eefa; border-color: #c0d0f0; }
        .category-security { color: #7d3cc0; background: #f3e9fb; border-color: #ddc6f2; }
        .category-usability { color: #b02a6b; background: #fbe9f2; border-color: #f2c4da; }

        /* ---------- Category pills ---------- */
        .label-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
        .label-row .form-label { margin-bottom: 0; }
        .link-btn.select-all { color: var(--brand-darker); }
        .link-btn.select-all:hover { color: var(--brand-dark); }
        .category-pills { display: flex; flex-wrap: wrap; gap: 8px; }
        .cat-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 13px;
          border-radius: 999px;
          border: 1px solid transparent;
          font-size: 13px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s, color 0.15s, transform 0.1s, filter 0.15s;
        }
        /* Unselected pills are neutral; selected ones are plain black */
        .cat-pill:not(.active) { background: #fbfdfa; color: var(--muted); border-color: var(--border); }
        .cat-pill:not(.active):hover { border-color: #111; color: var(--text); }
        .cat-pill.active { background: #111; color: #fff; border-color: #111; }
        .cat-pill.active:hover { background: #333; border-color: #333; }
        .cat-pill:active { transform: scale(0.97); }
        .cat-pill:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(0,200,83,0.3); }
        .cat-pill.active { font-weight: 700; }
        .cat-pill-icon { font-size: 12px; width: 14px; text-align: center; }
        .count-hint.hint-error { color: #b3261e; }

        .test-case-id {
          cursor: pointer;
          color: var(--brand-darker);
          font-weight: 700;
          padding: 6px 10px;
          border-radius: 8px;
          transition: background-color 0.2s;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .test-case-id:hover { background: var(--brand-soft); }
        .test-case-id.expanded { background: var(--brand-soft); }

        .expand-icon {
          font-size: 9px;
          transition: transform 0.2s;
          color: var(--muted);
        }
        .expand-icon.expanded { transform: rotate(90deg); color: var(--brand-dark); }

        .expanded-details {
          margin-top: 8px;
          background: #f8faf5;
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 20px;
          animation: fadeUp 0.3s ease both;
        }

        .details-title { margin-bottom: 16px; color: var(--text); font-size: 15px; font-weight: 700; }

        .step-item {
          background: #fff;
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 14px;
          margin-bottom: 10px;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .step-item:hover {
          border-color: var(--brand);
          box-shadow: 0 4px 12px rgba(0,200,83,0.15);
        }

        .step-header {
          display: grid;
          grid-template-columns: 70px 1fr 1fr 1fr;
          gap: 15px;
          align-items: start;
        }

        .step-id {
          font-weight: 700;
          color: #fff;
          background: linear-gradient(120deg, var(--brand), var(--brand-dark));
          padding: 5px 8px;
          border-radius: 8px;
          text-align: center;
          font-size: 12px;
        }
        .step-description { color: var(--text); line-height: 1.5; font-size: 13.5px; }
        .step-test-data { color: var(--muted); font-style: italic; font-size: 13px; }
        .step-expected { color: #1f8a4c; font-weight: 500; font-size: 13px; }

        .step-labels {
          display: grid;
          grid-template-columns: 70px 1fr 1fr 1fr;
          gap: 15px;
          margin-bottom: 12px;
          font-weight: 700;
          color: var(--muted);
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }

        /* ---------- AI engine + Jira panels ---------- */
        .panel {
          background: #f8fbf6;
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 14px 16px;
          margin-bottom: 16px;
        }
        .panel-warn { background: #fff8e6; border-color: #f0dca0; }
        .panel-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 10px;
        }
        .panel-title {
          font-weight: 700;
          font-size: 13.5px;
          color: var(--text);
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .panel-note { font-size: 12.5px; color: var(--muted); margin-bottom: 10px; word-break: break-all; }
        .panel-note a { color: var(--brand-darker); }
        .panel code, .modal code {
          background: #eef3ea;
          padding: 1px 5px;
          border-radius: 5px;
          font-size: 12px;
        }

        .field-row { display: grid; grid-template-columns: 1fr 1.4fr; gap: 10px; }
        @media (max-width: 480px) { .field-row { grid-template-columns: 1fr; } }
        .field { margin-top: 8px; min-width: 0; }
        .field:first-child { margin-top: 0; }
        .field-row .field { margin-top: 0; }
        .field-label {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11.5px;
          font-weight: 700;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 6px;
        }

        .form-select {
          width: 100%;
          padding: 10px 34px 10px 12px;
          border: 1px solid var(--border);
          border-radius: 10px;
          font-size: 13.5px;
          color: var(--text);
          background: #fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='none' stroke='%236b7a72' stroke-width='1.6' d='M1 1l5 5 5-5'/%3E%3C/svg%3E") no-repeat right 12px center;
          appearance: none;
          font-family: inherit;
          cursor: pointer;
          text-overflow: ellipsis;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .form-select:focus {
          outline: none;
          border-color: var(--brand);
          box-shadow: 0 0 0 4px rgba(0,200,83,0.18);
        }
        .form-select:disabled { background-color: #f2f4f0; cursor: not-allowed; color: var(--muted); }
        .form-input.compact { padding: 8px 12px; margin-bottom: 6px; font-size: 13px; }

        .toggle { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
        .toggle input { position: absolute; opacity: 0; pointer-events: none; }
        .toggle-track {
          width: 34px; height: 20px; border-radius: 999px;
          background: #cfd8cb; position: relative; transition: background 0.2s;
        }
        .toggle-thumb {
          position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
          border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.2);
          transition: transform 0.2s;
        }
        .toggle input:checked + .toggle-track { background: var(--brand); }
        .toggle input:checked + .toggle-track .toggle-thumb { transform: translateX(14px); }
        .toggle input:focus-visible + .toggle-track { box-shadow: 0 0 0 3px rgba(0,200,83,0.3); }
        .toggle-label { font-size: 12.5px; font-weight: 600; color: var(--text); }
        .toggle-disabled { opacity: 0.5; cursor: not-allowed; }

        .jira-btn {
          width: 100%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 11px 16px;
          border-radius: 11px;
          border: 1px solid #b3d4ff;
          background: #f0f6ff;
          color: #0747a6;
          font-weight: 700;
          font-size: 14px;
          cursor: pointer;
          transition: background 0.2s, box-shadow 0.2s, transform 0.15s;
          font-family: inherit;
        }
        .jira-btn:hover:not(:disabled) {
          background: #e3efff;
          box-shadow: 0 6px 16px rgba(38,132,255,0.2);
          transform: translateY(-1px);
        }
        .jira-btn:disabled { opacity: 0.7; cursor: wait; }

        .status-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: var(--brand); box-shadow: 0 0 8px var(--brand);
        }
        .link-btn {
          background: none; border: none; color: var(--muted);
          font-size: 12.5px; font-weight: 600; cursor: pointer; font-family: inherit;
        }
        .link-btn:hover { color: #b3261e; text-decoration: underline; }

        .inline-error {
          background: #fdeceb;
          border: 1px solid #f5c2be;
          color: #b3261e;
          font-size: 12.5px;
          padding: 8px 12px;
          border-radius: 9px;
          margin-bottom: 10px;
        }
        .story-loaded {
          margin-top: 10px;
          font-size: 12.5px;
          color: var(--brand-darker);
          background: var(--brand-soft);
          border: 1px solid rgba(0,200,83,0.3);
          border-radius: 9px;
          padding: 8px 12px;
        }
        .story-loaded a { color: var(--brand-darker); font-weight: 700; }
        .story-warn { color: #8a6100; margin-top: 4px; }

        .btn-spinner.dark { border-color: rgba(7,71,166,0.25); border-top-color: #0747a6; }
        .btn-spinner.small { width: 11px; height: 11px; border-width: 2px; }

        .switch-notice {
          margin-top: 14px;
          background: #fff8e6;
          border: 1px solid #f0dca0;
          border-radius: 10px;
          padding: 10px 14px;
          font-size: 12.5px;
          color: #6b5200;
        }
        .switch-notice ul { list-style: none; margin-top: 6px; }
        .switch-notice li { padding: 2px 0; }
        .switch-notice li.ok { color: #1f8a4c; font-weight: 600; }
        .switch-notice .reason { color: var(--muted); font-weight: 400; }

        /* ---------- Test case count picker ---------- */
        .count-group { margin-top: 16px; }
        .count-picker { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        .count-chip {
          min-width: 48px;
          padding: 8px 14px;
          border-radius: 999px;
          border: 1px solid var(--border);
          background: #fbfdfa;
          color: var(--text);
          font-weight: 600;
          font-size: 13px;
          cursor: pointer;
          font-family: inherit;
          transition: background 0.15s, border-color 0.15s, color 0.15s;
        }
        .count-chip:hover { border-color: var(--brand); }
        .count-chip.active {
          background: var(--brand-soft);
          border-color: var(--brand);
          color: var(--brand-darker);
        }
        .form-input.count-input { width: 96px; padding: 8px 12px; border-radius: 999px; font-size: 13px; }
        .form-input.count-input.active { border-color: var(--brand); background: var(--brand-soft); }
        .count-hint { font-size: 12px; color: var(--muted); margin-top: 6px; }

        /* ---------- Results summary ---------- */
        .summary-card {
          background: linear-gradient(180deg, #f6fbf3, #fbfdfa);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 16px 18px;
          margin-bottom: 20px;
        }
        .summary-title { font-weight: 700; font-size: 14px; margin-bottom: 6px; }
        .summary-text { font-size: 14px; color: var(--text); line-height: 1.6; margin-bottom: 14px; }
        .summary-stats { display: flex; flex-wrap: wrap; gap: 10px; }
        .stat {
          background: #fff;
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 10px 14px;
          min-width: 96px;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 4px;
        }
        .stat-value { font-size: 1.35rem; font-weight: 800; color: var(--text); line-height: 1.1; }
        .stat-label { font-size: 12px; color: var(--muted); font-weight: 600; }

        /* ---------- Modal ---------- */
        .modal-backdrop {
          position: fixed; inset: 0;
          background: rgba(20, 30, 24, 0.45);
          backdrop-filter: blur(3px);
          display: flex; align-items: center; justify-content: center;
          padding: 16px;
          z-index: 100;
          animation: fadeUp 0.2s ease both;
        }
        .modal {
          width: 100%;
          max-width: 440px;
          background: var(--surface);
          border-radius: 18px;
          padding: 26px;
          box-shadow: 0 24px 60px rgba(0,0,0,0.25);
        }
        .modal-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
        .modal-header h3 { font-size: 1.2rem; font-weight: 800; }
        .modal-sub { font-size: 13px; color: var(--muted); margin-bottom: 18px; }
        .modal-actions { display: flex; gap: 10px; margin-top: 20px; }
        .modal-actions .modal-submit { margin-top: 0; flex: 1; }
        .secondary-btn {
          padding: 12px 20px;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: #fff;
          color: var(--text);
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
        }
        .secondary-btn:hover:not(:disabled) { background: #f4f7f3; }

        /* ---------- Approve test cases & send to Jira ---------- */
        .results-table .approve-col { width: 44px; text-align: center; padding-left: 10px; padding-right: 4px; }
        .approve-col input { width: 17px; height: 17px; accent-color: var(--brand-dark); cursor: pointer; vertical-align: middle; }
        .approve-col input:disabled { cursor: default; }
        .results-table tbody tr.row-approved { background: #f1faf4; }
        .sent-chip {
          display: inline-block;
          margin: 4px 0 0 10px;
          font-size: 11.5px;
          font-weight: 700;
          color: var(--brand-darker);
          background: var(--brand-soft);
          border: 1px solid rgba(0,200,83,0.35);
          border-radius: 999px;
          padding: 2px 9px;
          text-decoration: none;
        }
        a.sent-chip:hover { text-decoration: underline; }

        .approve-panel {
          margin-top: 22px;
          background: #f8fbf6;
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 16px 18px;
        }
        .approve-head { margin-bottom: 12px; }
        .approve-title { font-weight: 700; font-size: 15px; }
        .approve-sub { font-size: 13px; color: var(--muted); }
        .approve-controls { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 14px 18px; }
        .approve-field { min-width: 160px; }
        .form-input.approve-project { margin-bottom: 0; width: 180px; text-transform: uppercase; }
        .approve-link {
          display: inline-flex; align-items: center; gap: 8px;
          font-size: 13px; color: var(--text); cursor: pointer; padding-bottom: 8px;
        }
        .approve-link input { width: 16px; height: 16px; accent-color: var(--brand-dark); }
        .submit-btn.approve-btn { margin-top: 0; width: auto; min-width: 240px; margin-left: auto; }
        @media (max-width: 600px) { .submit-btn.approve-btn { width: 100%; margin-left: 0; } }
        .approve-msg { margin-top: 12px; margin-bottom: 0; }
        .approve-msg ul { margin: 6px 0 0 18px; }
        .approve-result { margin-top: 12px; }
      `}</style>

      <div className="container">
        <div className="header">
          <span className="badge-pill">
            <span className="badge-dot"></span>
            AI-Powered Test Generation
          </span>
          <h1 className="title">User Story to <span className="accent">Tests</span></h1>
          <p className="subtitle">Turn user stories into comprehensive, structured test cases in seconds.</p>
        </div>

        <div className="workspace">
          <form onSubmit={handleSubmit} className="form-container">
            {configError && <div className="inline-error">{configError}</div>}

            {/* Row 1: AI engine + Jira side by side */}
            <div className="form-row panels-row">
              {config && (
                <ModelSelector
                  providers={config.providers}
                  provider={provider}
                  model={model}
                  autoSwitch={autoSwitch}
                  onProviderChange={handleProviderChange}
                  onModelChange={setModel}
                  onAutoSwitchChange={setAutoSwitch}
                />
              )}

              {config?.jira.enabled && (
                <div>
                  <JiraPanel onStorySelected={handleStorySelected} />
                </div>
              )}
            </div>

            {/* Row 2: story title (full width) */}
            <div className="form-group">
              <label htmlFor="storyTitle" className="form-label">
                Story Title <span className="req">*</span>
              </label>
              <input
                type="text"
                id="storyTitle"
                className="form-input"
                value={formData.storyTitle}
                onChange={(e) => handleInputChange('storyTitle', e.target.value)}
                placeholder="Enter the user story title..."
                required
                spellCheck={false}
                data-gramm="false"
                data-gramm_editor="false"
                data-enable-grammarly="false"
              />
            </div>

            {/* Row 3: description | acceptance criteria | additional info */}
            <div className="form-row cols-3">
            <div className="form-group">
              <label htmlFor="description" className="form-label">
                Description
              </label>
              <textarea
                id="description"
                className="form-textarea tall"
                value={formData.description}
                onChange={(e) => handleInputChange('description', e.target.value)}
                placeholder="Additional description (optional)..."
                spellCheck={false}
                data-gramm="false"
                data-gramm_editor="false"
                data-enable-grammarly="false"
              />
            </div>

            <div className="form-group">
              <label htmlFor="acceptanceCriteria" className="form-label">
                Acceptance Criteria <span className="req">*</span>
              </label>
              <textarea
                id="acceptanceCriteria"
                className="form-textarea tall"
                value={formData.acceptanceCriteria}
                onChange={(e) => handleInputChange('acceptanceCriteria', e.target.value)}
                placeholder="Enter the acceptance criteria..."
                required
                spellCheck={false}
                data-gramm="false"
                data-gramm_editor="false"
                data-enable-grammarly="false"
              />
            </div>

            <div className="form-group">
              <label htmlFor="additionalInfo" className="form-label">
                Additional Info
              </label>
              <textarea
                id="additionalInfo"
                className="form-textarea tall"
                value={formData.additionalInfo}
                onChange={(e) => handleInputChange('additionalInfo', e.target.value)}
                placeholder="Any additional information (optional)..."
                spellCheck={false}
                data-gramm="false"
                data-gramm_editor="false"
                data-enable-grammarly="false"
              />
            </div>
            </div>

            {/* Row 4: categories | count | generate */}
            <div className="form-row options-row">
            <div className="form-group count-group">
              <div className="label-row">
                <span className="form-label">
                  Test Categories <span className="req">*</span>
                </span>
                <button
                  type="button"
                  className="link-btn select-all"
                  onClick={() => setSelectedCategories(allCategoriesSelected ? [] : [...CATEGORY_ORDER])}
                >
                  {allCategoriesSelected ? 'Clear all' : 'Select all'}
                </button>
              </div>
              <div className="category-pills" role="group" aria-label="Test categories">
                {TEST_CATEGORIES.map(c => {
                  const active = selectedCategories.includes(c.name)
                  return (
                    <button
                      key={c.name}
                      type="button"
                      className={`cat-pill ${active ? 'active' : ''}`}
                      aria-pressed={active}
                      title={c.hint}
                      onClick={() => toggleCategory(c.name)}
                    >
                      <span className="cat-pill-icon" aria-hidden="true">{active ? '✓' : c.icon}</span>
                      {c.name}
                    </button>
                  )
                })}
              </div>
              <div className={`count-hint ${selectedCategories.length === 0 ? 'hint-error' : ''}`}>
                {selectedCategories.length === 0
                  ? 'Select at least one category.'
                  : `${selectedCategories.length} of ${CATEGORY_ORDER.length} selected. Test cases will be generated only for these.`}
              </div>
            </div>

            <div className="form-group count-group">
              <label htmlFor="testCaseCount" className="form-label">
                Number of Test Cases
              </label>
              <div className="count-picker">
                <button
                  type="button"
                  className={`count-chip ${testCaseCount === '' ? 'active' : ''}`}
                  onClick={() => setTestCaseCount('')}
                >
                  Auto
                </button>
                {COUNT_PRESETS.map(n => (
                  <button
                    key={n}
                    type="button"
                    className={`count-chip ${testCaseCount === String(n) ? 'active' : ''}`}
                    onClick={() => setTestCaseCount(String(n))}
                  >
                    {n}
                  </button>
                ))}
                <input
                  id="testCaseCount"
                  type="number"
                  min={1}
                  max={MAX_TEST_CASES}
                  inputMode="numeric"
                  className={`form-input count-input ${isCustomCount ? 'active' : ''}`}
                  placeholder="Custom"
                  value={isCustomCount ? testCaseCount : ''}
                  onChange={e => setTestCaseCount(e.target.value)}
                />
              </div>
              <div className="count-hint">
                {testCaseCount === '' ? 'AI decides how many test cases are needed.' : `Generates exactly ${testCaseCount} test case(s) (max ${MAX_TEST_CASES}).`}
              </div>
            </div>
            </div>

            <div className="form-actions">
              <button
                type="submit"
                className="submit-btn"
                disabled={isLoading || (config !== null && config.providers.length === 0)}
              >
                {isLoading && <span className="btn-spinner"></span>}
                {isLoading ? 'Generating...' : '✨ Generate Test Cases'}
              </button>
            </div>
          </form>

          <div className="output-col" ref={outputRef}>
              {error && (
                <div className="error-banner">
                  <span>⚠️</span>
                  {error}
                </div>
              )}

              {isLoading && (
                <div className="loading">
                  <span className="big-spinner"></span>
                  Generating test cases...
                </div>
              )}

              {!isLoading && !results && !error && (
                <div className="placeholder-card">
                  <div className="placeholder-icon">🧪</div>
                  <div className="placeholder-title">Your test cases will appear here</div>
                  <p className="placeholder-text">
                    Fill in the story details above and hit Generate. We'll craft
                    positive, negative, edge, and more test cases for you.
                  </p>
                  <div className="placeholder-hints">
                    {selectedCategories.map(c => (
                      <span key={c} className="meta-chip">{c}</span>
                    ))}
                  </div>
                </div>
              )}

              {!isLoading && results && (
                <div className="results-container">
                  <div className="results-header">
                    <h2 className="results-title">Generated Test Cases</h2>
                    <div className="results-meta">
                      <span className="meta-chip">{results.cases.length} test case(s)</span>
                      {results.providerName && <span className="meta-chip">Provider: {results.providerName}</span>}
                      {results.model && <span className="meta-chip">Model: {results.model}</span>}
                      {results.promptTokens > 0 && (
                        <span className="meta-chip">Tokens: {results.promptTokens + results.completionTokens}</span>
                      )}
                    </div>
                    {results.attempts && results.attempts.length > 1 && (
                      <div className="switch-notice">
                        <strong>🔁 Auto-switched model.</strong>
                        <ul>
                          {results.attempts.map((a, i) => (
                            <li key={i} className={a.ok ? 'ok' : 'fail'}>
                              {a.ok ? '✅' : '❌'} {a.providerName} / {a.model}
                              {a.reason && <span className="reason"> — {a.reason}</span>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  <div className="summary-card">
                    <div className="summary-title">📋 Summary</div>
                    {results.summary && <p className="summary-text">{results.summary}</p>}
                    <div className="summary-stats">
                      <div className="stat">
                        <div className="stat-value">{results.cases.length}</div>
                        <div className="stat-label">
                          Total{results.requestedCount ? ` / ${results.requestedCount} requested` : ''}
                        </div>
                      </div>
                      {categoryCounts(results.cases).map(([cat, n]) => (
                        <div key={cat} className="stat">
                          <div className="stat-value">{n}</div>
                          <span className={`cat-badge ${categoryClass(cat)}`}>{cat}</span>
                        </div>
                      ))}
                    </div>
                    {(() => {
                      const covered = new Set(results.cases.map(c => c.category))
                      const missing = (results.requestedCategories || []).filter(c => !covered.has(c))
                      return missing.length > 0 ? (
                        <div className="story-warn">Not covered: {missing.join(', ')}</div>
                      ) : null
                    })()}
                    {results.requestedCount && results.cases.length < results.requestedCount && (
                      <div className="story-warn">
                        The model returned fewer test cases than requested. Try again or pick another model.
                      </div>
                    )}
                  </div>

                  <div className="table-container">
                    <table className="results-table">
                      <thead>
                        <tr>
                          <th className="approve-col">
                            <input
                              type="checkbox"
                              aria-label="Select all test cases for approval"
                              title="Select all"
                              checked={allApprovalSelected}
                              disabled={selectableCases.length === 0}
                              onChange={toggleAllApprovals}
                            />
                          </th>
                          <th>Test Case ID</th>
                          <th>Title</th>
                          <th>Category</th>
                          <th>Expected Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results.cases.map((testCase: TestCase) => (
                          <Fragment key={testCase.id}>
                            <tr className={`row-main ${approvalSelection.has(testCase.id) ? 'row-approved' : ''}`}>
                              <td className="approve-col">
                                <input
                                  type="checkbox"
                                  aria-label={`Approve ${testCase.id}`}
                                  checked={sentCases.has(testCase.id) || approvalSelection.has(testCase.id)}
                                  disabled={sentCases.has(testCase.id)}
                                  title={sentCases.has(testCase.id) ? 'Already sent to Jira' : 'Select to approve'}
                                  onChange={() => toggleApproval(testCase.id)}
                                />
                              </td>
                              <td>
                                <div
                                  className={`test-case-id ${expandedTestCases.has(testCase.id) ? 'expanded' : ''}`}
                                  onClick={() => toggleTestCaseExpansion(testCase.id)}
                                >
                                  <span className={`expand-icon ${expandedTestCases.has(testCase.id) ? 'expanded' : ''}`}>
                                    ▶
                                  </span>
                                  {testCase.id}
                                </div>
                                {sentCases.has(testCase.id) && (() => {
                                  const sent = sentCases.get(testCase.id)!
                                  return sent.url
                                    ? <a className="sent-chip" href={sent.url} target="_blank" rel="noreferrer">✓ {sent.key}</a>
                                    : <span className="sent-chip">✓ {sent.key}</span>
                                })()}
                              </td>
                              <td>{testCase.title}</td>
                              <td>
                                <span className={`cat-badge ${categoryClass(testCase.category)}`}>
                                  {testCase.category}
                                </span>
                              </td>
                              <td>{testCase.expectedResult}</td>
                            </tr>
                            {expandedTestCases.has(testCase.id) && (
                              <tr key={`${testCase.id}-details`}>
                                <td colSpan={5}>
                                  <div className="expanded-details">
                                    <h4 className="details-title">Test Steps for {testCase.id}</h4>
                                    <div className="step-labels">
                                      <div>Step ID</div>
                                      <div>Step Description</div>
                                      <div>Test Data</div>
                                      <div>Expected Result</div>
                                    </div>
                                    {testCase.steps.map((step, index) => (
                                      <div key={index} className="step-item">
                                        <div className="step-header">
                                          <div className="step-id">S{String(index + 1).padStart(2, '0')}</div>
                                          <div className="step-description">{step}</div>
                                          <div className="step-test-data">{testCase.testData || 'N/A'}</div>
                                          <div className="step-expected">
                                            {index === testCase.steps.length - 1 ? testCase.expectedResult : 'Step completed successfully'}
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {results.cases.length > 0 && (
                    <ApproveTestCases
                      status={config?.testManagement}
                      selectedCases={results.cases.filter(c => approvalSelection.has(c.id) && !sentCases.has(c.id))}
                      linkedStory={linkedStory}
                      onExported={handleExported}
                    />
                  )}
                </div>
              )}
            </div>
        </div>
      </div>
    </div>
  )
}

export default App
