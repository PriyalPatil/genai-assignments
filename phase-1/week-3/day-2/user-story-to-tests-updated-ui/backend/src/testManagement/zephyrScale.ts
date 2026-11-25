/**
 * Zephyr (formerly Zephyr Scale) for Jira Cloud — REST API v2.
 * Docs: https://support.smartbear.com/zephyr-scale-cloud/api-docs/
 *
 * .env:
 *   ZEPHYR_API_TOKEN=...  (Jira > profile picture > Zephyr API Access Tokens > Create access token)
 *   ZEPHYR_API_BASE=...   (optional; region: US default, EU https://eu.api.zephyrscale.smartbear.com/v2,
 *                          AU https://au.api.zephyrscale.smartbear.com/v2, DE https://de.api.zephyrscale.smartbear.com/v2)
 *
 * Not supported: legacy Zephyr Squad / Zephyr Essential, which use a different API.
 */
import { requestJson } from './http'
import {
  ExportRequest,
  ExportResult,
  TestManagementAdapter,
  TestManagementError,
  env,
  toSteps
} from './types'
import type { TestCase } from '../schemas'

const NAME = 'Zephyr'
const DEFAULT_BASE = 'https://api.zephyrscale.smartbear.com/v2'
const MAX_STEPS_PER_REQUEST = 100

const token = () => env('ZEPHYR_API_TOKEN', 'ZEPHYR_SCALE_API_TOKEN', 'ZEPHYR_TOKEN')
const base = () => (env('ZEPHYR_API_BASE', 'ZEPHYR_SCALE_API_BASE') || DEFAULT_BASE).replace(/\/+$/, '')

/** Zephyr labels can't contain spaces: "Edge Case" -> "Edge-Case" */
const label = (s: string) => s.trim().replace(/\s+/g, '-')

function objective(tc: TestCase): string {
  const parts = [`Category: ${tc.category}`, `Generated test case id: ${tc.id}`, `Expected result: ${tc.expectedResult}`]
  return parts.map(escapeHtml).join('<br>')
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export const zephyrScaleAdapter: TestManagementAdapter = {
  id: 'zephyr',
  name: NAME,

  missingConfig() {
    return token() ? [] : ['ZEPHYR_API_TOKEN']
  },

  async exportTests(req: ExportRequest): Promise<ExportResult> {
    const result: ExportResult = { tool: 'zephyr', toolName: NAME, created: [], failed: [], warnings: [] }
    const headers = { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', Accept: 'application/json' }
    const call = <T>(path: string, body: unknown) =>
      requestJson<T>(NAME, `${base()}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })

    const storyIssueId = req.story?.id ? Number(req.story.id) : undefined
    if (req.story && !storyIssueId) {
      result.warnings.push(`Could not link to ${req.story.key}: its Jira issue id is unknown. Load the story from Jira to link it.`)
    }

    for (const tc of req.cases) {
      // 1. Create the test case
      let key: string
      try {
        const created = await call<{ id: number; key: string }>('/testcases', {
          projectKey: req.projectKey,
          name: tc.title.slice(0, 255),
          objective: objective(tc),
          precondition: tc.testData ? escapeHtml(`Test data: ${tc.testData}`) : undefined,
          labels: ['AI-generated', label(tc.category)].filter(Boolean)
        })
        if (!created?.key) throw new TestManagementError(`${NAME} did not return a test case key`)
        key = created.key
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        // Same problem for every case (bad token / project / permission) — stop instead of repeating it
        if (err instanceof TestManagementError && [401, 403, 404].includes(err.status)) {
          const hint = err.status === 404 ? ` — check that project "${req.projectKey}" exists and Zephyr is enabled for it, and that ZEPHYR_API_BASE matches your region.` : ''
          for (const rest of req.cases.slice(req.cases.indexOf(tc))) {
            result.failed.push({ sourceId: rest.id, error: message + hint })
          }
          break
        }
        result.failed.push({ sourceId: tc.id, error: message })
        continue
      }
      result.created.push({ sourceId: tc.id, key })

      // 2. Steps: OVERWRITE replaces the empty step Zephyr adds automatically; sequential to keep order
      try {
        const steps = toSteps(tc).map(s => ({
          inline: { description: escapeHtml(s.action), testData: escapeHtml(s.data), expectedResult: escapeHtml(s.result) }
        }))
        for (let i = 0; i < steps.length; i += MAX_STEPS_PER_REQUEST) {
          await call(`/testcases/${encodeURIComponent(key)}/teststeps`, {
            mode: i === 0 ? 'OVERWRITE' : 'APPEND',
            items: steps.slice(i, i + MAX_STEPS_PER_REQUEST)
          })
        }
      } catch (err) {
        result.warnings.push(`${key} was created but its steps could not be added: ${(err as Error).message}`)
      }

      // 3. Coverage link to the Jira story
      if (storyIssueId) {
        try {
          await call(`/testcases/${encodeURIComponent(key)}/links/issues`, { issueId: storyIssueId })
        } catch (err) {
          result.warnings.push(`${key} was created but could not be linked to ${req.story!.key}: ${(err as Error).message}`)
        }
      }
    }
    return result
  }
}
