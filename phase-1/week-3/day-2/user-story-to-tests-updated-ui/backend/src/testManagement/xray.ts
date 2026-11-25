/**
 * Xray for Jira Cloud — REST API v2 bulk test import.
 * Docs: https://docs.getxray.app/space/XRAYCLOUD/44577089/Authentication+-+REST+v2
 *       https://docs.getxray.app/space/XRAYCLOUD/44577092/Importing+Tests+-+REST+v2
 *
 * .env:
 *   XRAY_CLIENT_ID=...       (Jira settings > Apps > Xray > API Keys > Create API Key)
 *   XRAY_CLIENT_SECRET=...
 *   XRAY_API_BASE=...        (optional region: https://eu.xray.cloud.getxray.app, https://us..., https://au...)
 *   XRAY_TEST_LINK_TYPE=Test (optional; Jira link type used for test coverage)
 *
 * Bulk import is used because it creates the Test issues AND links them to the story using only
 * Xray credentials. It is asynchronous: we start a job and poll its status.
 */
import { requestJson, sleep } from './http'
import {
  ExportRequest,
  ExportResult,
  TestManagementAdapter,
  TestManagementError,
  env,
  formatCaseDescription,
  toSteps
} from './types'

const NAME = 'Xray'
const DEFAULT_BASE = 'https://xray.cloud.getxray.app'
const TOKEN_TTL_MS = 23 * 60 * 60 * 1000 // tokens last 24h
const POLL_INTERVAL_MS = 1500
const JOB_TIMEOUT_MS = 120_000

const clientId = () => env('XRAY_CLIENT_ID')
const clientSecret = () => env('XRAY_CLIENT_SECRET')
const base = () => (env('XRAY_API_BASE', 'XRAY_BASE_URL') || DEFAULT_BASE).replace(/\/+$/, '').replace(/\/api\/v2$/, '')
const linkType = () => env('XRAY_TEST_LINK_TYPE') || 'Test'

let cachedToken: { value: string; expires: number; key: string } | null = null

async function getToken(forceRefresh = false): Promise<string> {
  const cacheKey = `${base()}|${clientId()}`
  if (!forceRefresh && cachedToken && cachedToken.key === cacheKey && cachedToken.expires > Date.now()) {
    return cachedToken.value
  }
  const token = await requestJson<string>(NAME, `${base()}/api/v2/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId(), client_secret: clientSecret() })
  }).catch(err => {
    if (err instanceof TestManagementError && err.status === 401) {
      throw new TestManagementError('Xray rejected XRAY_CLIENT_ID / XRAY_CLIENT_SECRET (or the Xray license is not valid).', 401)
    }
    throw err
  })
  if (typeof token !== 'string' || !token) throw new TestManagementError('Xray authentication returned no token')
  cachedToken = { value: token, expires: Date.now() + TOKEN_TTL_MS, key: cacheKey }
  return token
}

interface JobStatus {
  status: 'pending' | 'working' | 'failed' | 'successful' | 'partially_successful' | 'unsuccessful'
  progress?: string[]
  result?: {
    errors?: Array<{ elementNumber: number; errors: Record<string, string> | string }>
    issues?: Array<{ elementNumber: number; id: string; key: string; self?: string }>
  }
}

/** Xray allows one import job per user at a time, so jobs from this server run one after another. */
let queue: Promise<unknown> = Promise.resolve()
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.catch(() => undefined)
  return run
}

/** "https://site.atlassian.net/rest/api/2/issue/123" + "PROJ-5" -> "https://site.atlassian.net/browse/PROJ-5" */
function browseUrl(self: string | undefined, key: string): string | undefined {
  if (!self) return undefined
  const m = self.match(/^(https?:\/\/.+?)\/rest\/api\//)
  return m ? `${m[1]}/browse/${key}` : undefined
}

export const xrayAdapter: TestManagementAdapter = {
  id: 'xray',
  name: NAME,

  missingConfig() {
    return [!clientId() && 'XRAY_CLIENT_ID', !clientSecret() && 'XRAY_CLIENT_SECRET'].filter(Boolean) as string[]
  },

  exportTests(req: ExportRequest): Promise<ExportResult> {
    return serialized(() => runImport(req))
  }
}

async function runImport(req: ExportRequest): Promise<ExportResult> {
  const result: ExportResult = { tool: 'xray', toolName: NAME, created: [], failed: [], warnings: [] }

  const tests = req.cases.map(tc => ({
    testtype: 'Manual',
    fields: {
      project: { key: req.projectKey },
      summary: tc.title.slice(0, 255),
      description: formatCaseDescription(tc),
      labels: ['AI-generated', tc.category.trim().replace(/\s+/g, '-')]
    },
    ...(req.story
      ? { update: { issuelinks: [{ add: { type: { name: linkType() }, outwardIssue: { key: req.story.key } } }] } }
      : {}),
    steps: toSteps(tc)
  }))

  const authed = async <T>(path: string, init: RequestInit): Promise<T> => {
    const call = async (token: string) =>
      requestJson<T>(NAME, `${base()}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' }
      })
    try {
      return await call(await getToken())
    } catch (err) {
      // Cached token may have expired early — refresh once
      if (err instanceof TestManagementError && err.status === 401) return call(await getToken(true))
      throw err
    }
  }

  const { jobId } = await authed<{ jobId: string }>('/api/v2/import/test/bulk', {
    method: 'POST',
    body: JSON.stringify(tests)
  })
  if (!jobId) throw new TestManagementError('Xray did not return an import job id')

  // Poll the job until it finishes
  const deadline = Date.now() + JOB_TIMEOUT_MS
  let status: JobStatus
  for (;;) {
    await sleep(POLL_INTERVAL_MS)
    status = await authed<JobStatus>(`/api/v2/import/test/bulk/${encodeURIComponent(jobId)}/status`, { method: 'GET' })
    if (!['pending', 'working'].includes(status.status)) break
    if (Date.now() > deadline) {
      throw new TestManagementError(
        `Xray import job ${jobId} is still running after ${JOB_TIMEOUT_MS / 1000}s. Check Jira shortly; the tests may still be created.`,
        504
      )
    }
  }

  for (const issue of status.result?.issues || []) {
    const tc = req.cases[issue.elementNumber]
    if (tc) result.created.push({ sourceId: tc.id, key: issue.key, url: browseUrl(issue.self, issue.key) })
  }
  for (const e of status.result?.errors || []) {
    const tc = req.cases[e.elementNumber]
    if (!tc) continue
    const msg = typeof e.errors === 'string' ? e.errors : Object.entries(e.errors || {}).map(([k, v]) => `${k}: ${v}`).join('; ')
    const hint = /issuelink|link/i.test(msg) && req.story
      ? ` (linking to ${req.story.key} failed — check the "${linkType()}" link type exists, or untick "Link to story")`
      : /issuetype|issue type|test type|testtype/i.test(msg)
        ? ` (make sure Xray's Test work type is enabled for project ${req.projectKey})`
        : ''
    result.failed.push({ sourceId: tc.id, error: (msg || 'Rejected by Xray') + hint })
  }

  // Anything Xray didn't report on
  const seen = new Set([...result.created.map(c => c.sourceId), ...result.failed.map(f => f.sourceId)])
  for (const tc of req.cases) {
    if (!seen.has(tc.id)) {
      result.failed.push({ sourceId: tc.id, error: `Xray import finished with status "${status.status}" without creating this test` })
    }
  }
  return result
}
