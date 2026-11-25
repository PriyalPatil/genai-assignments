/**
 * AIO Tests for Jira Cloud.
 * Docs: https://tcms.aiojiraapps.com/aio-tcms/api/v1/openapi.json
 *       https://aiosupport.atlassian.net/wiki/spaces/AioTests/pages/2025521186
 *
 * .env:
 *   AIO_API_TOKEN=...   (Jira > AIO Tests > gear > My Settings > API Token)
 *   AIO_API_BASE=...    (optional; copy from the same page — EU sites use https://tcms-prod-eu.aiojiraapps.com/aio-tcms/api/v1)
 */
import { requestJson } from './http'
import {
  ExportRequest,
  ExportResult,
  TestManagementAdapter,
  TestManagementError,
  env,
  formatCaseDescription,
  toSteps
} from './types'

const NAME = 'AIO Tests'
const DEFAULT_BASE = 'https://tcms.aiojiraapps.com/aio-tcms/api/v1'

const token = () => env('AIO_API_TOKEN', 'AIO_TESTS_API_TOKEN', 'AIO_TOKEN')
const base = () => (env('AIO_API_BASE', 'AIO_API_BASE_URL') || DEFAULT_BASE).replace(/\/+$/, '')

interface AioCase {
  ID: number
  key: string
}

export const aioAdapter: TestManagementAdapter = {
  id: 'aio',
  name: NAME,

  missingConfig() {
    return token() ? [] : ['AIO_API_TOKEN']
  },

  async exportTests(req: ExportRequest): Promise<ExportResult> {
    const result: ExportResult = { tool: 'aio', toolName: NAME, created: [], failed: [], warnings: [] }
    const url = `${base()}/project/${encodeURIComponent(req.projectKey)}/testcase`
    const headers = { Authorization: `AioAuth ${token()}`, 'Content-Type': 'application/json', Accept: 'application/json' }
    // AIO accepts the Jira issue key or id for requirements
    const requirement = req.story ? [req.story.id || req.story.key] : undefined

    // No bulk create endpoint: one request per case (rate limit is 60/min per IP; 429s are retried)
    for (const tc of req.cases) {
      try {
        const created = await requestJson<AioCase>(NAME, url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            title: tc.title,
            description: formatCaseDescription(tc),
            steps: toSteps(tc).map(s => ({ stepType: 'TEXT', step: s.action, data: s.data, expectedResult: s.result })),
            ...(requirement ? { jiraRequirementIDs: requirement } : {})
          })
        })
        if (!created?.key) throw new TestManagementError(`${NAME} did not return a test case key`)
        result.created.push({ sourceId: tc.id, key: created.key })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        // Same problem for every case (bad token / project) — stop instead of repeating it
        if (err instanceof TestManagementError && [401, 403, 404].includes(err.status)) {
          const hint = err.status === 404 ? ` — check that project "${req.projectKey}" exists and AIO Tests is enabled for it.` : ''
          for (const rest of req.cases.slice(req.cases.indexOf(tc))) {
            result.failed.push({ sourceId: rest.id, error: message + hint })
          }
          break
        }
        result.failed.push({ sourceId: tc.id, error: message })
      }
    }
    return result
  }
}
