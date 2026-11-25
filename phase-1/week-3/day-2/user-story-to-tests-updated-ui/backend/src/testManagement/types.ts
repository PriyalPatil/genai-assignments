import type { TestCase } from '../schemas'

/** Jira test management apps this backend can send approved test cases to. */
export type TestManagementToolId = 'xray' | 'zephyr' | 'aio'

export interface ExportRequest {
  /** Jira project key the test cases are created in, e.g. "SCRUM" */
  projectKey: string
  /** Jira story the test cases were generated from (optional). Used to link tests to the story. */
  story?: { key: string; id?: string }
  cases: TestCase[]
}

export interface ExportedCase {
  /** Test case id from the generator, e.g. "TC-001" */
  sourceId: string
  /** Key/id of the test in the test management tool, e.g. "SCRUM-42" or "SCRUM-T12" */
  key: string
  url?: string
}

export interface FailedCase {
  sourceId: string
  error: string
}

export interface ExportResult {
  tool: TestManagementToolId
  toolName: string
  created: ExportedCase[]
  failed: FailedCase[]
  /** Non-fatal problems, e.g. tests created but linking to the story failed */
  warnings: string[]
}

export interface TestManagementAdapter {
  id: TestManagementToolId
  name: string
  /** Names of required .env variables that are missing (empty = ready to use) */
  missingConfig(): string[]
  exportTests(req: ExportRequest): Promise<ExportResult>
}

export class TestManagementError extends Error {
  constructor(message: string, public status: number = 502) {
    super(message)
  }
}

/** Reads the first non-empty env variable from the list. */
export function env(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n]
    if (v && v.trim()) return v.trim()
  }
  return undefined
}

/** Turns a non-2xx response into a readable error message. */
export async function describeHttpError(res: Response, toolName: string): Promise<string> {
  const text = await res.text().catch(() => '')
  let detail = ''
  try {
    const j = JSON.parse(text)
    detail =
      j.message || j.error || j.errorMessage ||
      (Array.isArray(j.errors) ? j.errors.map((e: any) => e.message || e).join('; ') : '') ||
      (Array.isArray(j.errorMessages) ? j.errorMessages.join('; ') : '')
  } catch {
    detail = text
  }
  // Some tools (e.g. AIO Tests) return HTML snippets in error bodies
  detail = String(detail || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
  if (res.status === 401) return `${toolName} rejected the API credentials (401). Check the token in .env.`
  if (res.status === 403) return `${toolName} denied access (403)${detail ? `: ${detail}` : ''}. Check the token's permissions and that the app is enabled for the project.`
  return `${toolName} error ${res.status}${detail ? `: ${detail}` : ''}`
}

/** Plain-text step list used where a tool has no separate step fields. */
export function formatCaseDescription(tc: TestCase): string {
  const lines = [`Category: ${tc.category}`, `Generated test case id: ${tc.id}`]
  if (tc.testData) lines.push(`Test data: ${tc.testData}`)
  lines.push(`Expected result: ${tc.expectedResult}`)
  return lines.join('\n')
}

/**
 * Steps in the same shape the UI shows: every step expects "Step completed successfully"
 * except the last, which expects the test case's expected result.
 */
export function toSteps(tc: TestCase): Array<{ action: string; data: string; result: string }> {
  const steps = tc.steps.length ? tc.steps : [tc.title]
  return steps.map((action, i) => ({
    action,
    data: tc.testData || '',
    result: i === steps.length - 1 ? tc.expectedResult : 'Step completed successfully'
  }))
}
