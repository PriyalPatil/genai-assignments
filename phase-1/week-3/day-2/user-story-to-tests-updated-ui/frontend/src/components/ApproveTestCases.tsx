import { useEffect, useState } from 'react'
import { exportApprovedTests } from '../api'
import { ExportTestsResult, TestCase, TestManagementStatus } from '../types'

interface Props {
  status?: TestManagementStatus
  /** Test cases the user ticked (already filtered to the selected ones) */
  selectedCases: TestCase[]
  /** Jira story the cases were generated from, when it was loaded from Jira */
  linkedStory: { key: string; id: string } | null
  onExported: (result: ExportTestsResult) => void
}

/** "SCRUM-12" -> "SCRUM" */
function projectOf(issueKey: string): string {
  return issueKey.replace(/-\d+$/, '')
}

export function ApproveTestCases({ status, selectedCases, linkedStory, onExported }: Props) {
  const suggestedProject = linkedStory ? projectOf(linkedStory.key) : status?.defaultProjectKey || ''
  const [projectKey, setProjectKey] = useState(suggestedProject)
  const [linkToStory, setLinkToStory] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<ExportTestsResult | null>(null)

  // Follow the story/project the user loads from Jira
  useEffect(() => { setProjectKey(suggestedProject) }, [suggestedProject])

  const toolName = status?.toolName || 'Jira test management'
  const count = selectedCases.length

  const approve = async () => {
    const key = projectKey.trim().toUpperCase()
    if (!key) {
      setError('Enter the Jira project key to create the test cases in.')
      return
    }
    if (count === 0) {
      setError('Select at least one test case to approve.')
      return
    }
    setSending(true)
    setError(null)
    setLastResult(null)
    try {
      const useStory = linkedStory && linkToStory && projectOf(linkedStory.key) === key
      const result = await exportApprovedTests({
        projectKey: key,
        story: useStory ? { key: linkedStory.key, id: linkedStory.id } : undefined,
        cases: selectedCases
      })
      setLastResult(result)
      onExported(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to send test cases to ${toolName}`)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="approve-panel">
      <div className="approve-head">
        <div>
          <div className="approve-title">✅ Approve &amp; send to Jira</div>
          <div className="approve-sub">
            {status?.enabled
              ? <>Tick the test cases to approve. Only those are sent to <strong>{toolName}</strong>.</>
              : 'Tick the test cases to approve, then send them to your Jira test management tool.'}
          </div>
        </div>
      </div>

      {!status?.enabled && (
        <div className="inline-error">
          {status?.problem || 'Sending to Jira is not configured on the server.'}
        </div>
      )}

      <div className="approve-controls">
        <div className="approve-field">
          <label htmlFor="tmProjectKey" className="field-label">Jira project key</label>
          <input
            id="tmProjectKey"
            type="text"
            className="form-input compact approve-project"
            placeholder="e.g. SCRUM"
            value={projectKey}
            onChange={e => setProjectKey(e.target.value)}
            disabled={sending}
          />
        </div>

        {linkedStory && (
          <label className="approve-link">
            <input
              type="checkbox"
              checked={linkToStory}
              onChange={e => setLinkToStory(e.target.checked)}
              disabled={sending}
            />
            Link to story <strong>{linkedStory.key}</strong>
          </label>
        )}

        <button
          type="button"
          className="submit-btn approve-btn"
          onClick={approve}
          disabled={sending || count === 0 || !status?.enabled}
        >
          {sending && <span className="btn-spinner" />}
          {sending ? 'Sending…' : `Approve Test Cases${count ? ` (${count})` : ''}`}
        </button>
      </div>

      {error && <div className="inline-error approve-msg">{error}</div>}

      {lastResult && (
        <div className="approve-result">
          {lastResult.created.length > 0 && (
            <div className="story-loaded">
              ✅ {lastResult.created.length} test case(s) created in {lastResult.toolName}:{' '}
              {lastResult.created.map((c, i) => (
                <span key={c.key}>
                  {i > 0 && ', '}
                  {c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.key}</a> : <strong>{c.key}</strong>}
                </span>
              ))}
            </div>
          )}
          {lastResult.failed.length > 0 && (
            <div className="inline-error approve-msg">
              {lastResult.failed.length} test case(s) failed:
              <ul>
                {lastResult.failed.map(f => <li key={f.sourceId}>{f.sourceId}: {f.error}</li>)}
              </ul>
            </div>
          )}
          {lastResult.warnings.map((w, i) => <div key={i} className="story-warn">⚠️ {w}</div>)}
        </div>
      )}
    </div>
  )
}
