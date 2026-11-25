import express from 'express'
import { z } from 'zod'
import { TestCaseSchema } from '../schemas'
import { getSelectedAdapter, getTestManagementStatus } from '../testManagement'
import { TestManagementError } from '../testManagement/types'

export const testManagementRouter = express.Router()

const ExportSchema = z.object({
  projectKey: z
    .string()
    .trim()
    .min(1, 'Jira project key is required')
    .regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'Jira project key must look like "PROJ"')
    .transform(s => s.toUpperCase()),
  story: z
    .object({
      key: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/, 'Story key must look like "PROJ-123"'),
      id: z.string().trim().regex(/^\d+$/).optional()
    })
    .optional(),
  /** Only the test cases the user selected and approved */
  cases: z.array(TestCaseSchema).min(1, 'Select at least one test case to approve').max(50, 'At most 50 test cases at a time')
})

testManagementRouter.get('/status', (_req, res) => {
  res.json(getTestManagementStatus())
})

/** Sends the approved test cases to the test management tool configured in .env. */
testManagementRouter.post('/export', async (req, res) => {
  const status = getTestManagementStatus()
  const adapter = getSelectedAdapter()
  if (!status.enabled || !adapter) {
    res.status(503).json({ error: status.problem || 'Test management integration is not configured' })
    return
  }

  const parsed = ExportSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map(i => i.message).join(', ') })
    return
  }

  try {
    const result = await adapter.exportTests(parsed.data)
    console.log(
      `[${adapter.name}] exported ${result.created.length}/${parsed.data.cases.length} test case(s) to ${parsed.data.projectKey}` +
        (result.failed.length ? `, ${result.failed.length} failed` : '')
    )
    // 502 only when nothing at all was created, so the UI can still show partial success
    res.status(result.created.length === 0 ? 502 : 200).json(
      result.created.length === 0
        ? { error: result.failed[0]?.error || 'No test cases were created', ...result }
        : result
    )
  } catch (err) {
    if (err instanceof TestManagementError) {
      res.status(err.status >= 400 && err.status < 600 ? err.status : 502).json({ error: err.message })
      return
    }
    console.error('Test management export error:', err)
    res.status(500).json({ error: `Unexpected error sending test cases to ${adapter.name}` })
  }
})
