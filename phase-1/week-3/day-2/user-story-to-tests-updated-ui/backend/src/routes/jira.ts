import express from 'express'
import { z } from 'zod'
import { JiraClient, JiraError, isJiraEnabled } from '../jira/jiraClient'

export const jiraRouter = express.Router()

const CredentialsSchema = z.object({
  email: z.string().trim().email('A valid email is required'),
  baseUrl: z.string().trim().min(1, 'Jira URL is required')
})

const StoriesSchema = CredentialsSchema.extend({
  projectKey: z.string().trim().min(1, 'Project key is required')
})

// Every Jira route is unavailable unless JIRA_API_KEY is configured
jiraRouter.use((_req, res, next) => {
  if (!isJiraEnabled()) {
    res.status(404).json({ error: 'Jira integration is not configured (JIRA_API_KEY missing in .env)' })
    return
  }
  next()
})

function handleError(res: express.Response, err: unknown) {
  if (err instanceof JiraError) {
    res.status(err.status >= 400 && err.status < 600 ? err.status : 502).json({ error: err.message })
    return
  }
  console.error('Jira route error:', err)
  res.status(500).json({ error: 'Unexpected error talking to Jira' })
}

function parse<T>(schema: z.ZodType<T>, body: unknown, res: express.Response): T | undefined {
  const result = schema.safeParse(body)
  if (!result.success) {
    res.status(400).json({ error: result.error.issues.map(i => i.message).join(', ') })
    return undefined
  }
  return result.data
}

/** Validate credentials and return the Jira user. */
jiraRouter.post('/connect', async (req, res) => {
  const creds = parse(CredentialsSchema, req.body, res)
  if (!creds) return
  try {
    const client = new JiraClient(creds)
    const me = await client.myself()
    res.json({ connected: true, baseUrl: client.url, user: { displayName: me.displayName, email: me.emailAddress } })
  } catch (err) {
    handleError(res, err)
  }
})

jiraRouter.post('/projects', async (req, res) => {
  const creds = parse(CredentialsSchema, req.body, res)
  if (!creds) return
  try {
    const projects = await new JiraClient(creds).listProjects()
    res.json({ projects })
  } catch (err) {
    handleError(res, err)
  }
})

jiraRouter.post('/stories', async (req, res) => {
  const body = parse(StoriesSchema, req.body, res)
  if (!body) return
  try {
    const stories = await new JiraClient(body).listStories(body.projectKey)
    res.json({ stories })
  } catch (err) {
    handleError(res, err)
  }
})
