import {
  AppConfig,
  ExportTestsRequest,
  ExportTestsResult,
  GenerateRequest,
  GenerateResponse,
  JiraCredentials,
  JiraProject,
  JiraStory
} from './types'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8081/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) }
  })
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`)
  }
  return response.json() as Promise<T>
}

const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) })

export function getConfig(): Promise<AppConfig> {
  return request<AppConfig>('/config')
}

export async function generateTests(req: GenerateRequest): Promise<GenerateResponse> {
  try {
    return await post<GenerateResponse>('/generate-tests', req)
  } catch (error) {
    console.error('Error generating tests:', error)
    throw error instanceof Error ? error : new Error('Unknown error occurred')
  }
}

export function connectJira(creds: JiraCredentials) {
  return post<{ connected: boolean; baseUrl: string; user: { displayName: string; email?: string } }>('/jira/connect', creds)
}

export async function getJiraProjects(creds: JiraCredentials): Promise<JiraProject[]> {
  return (await post<{ projects: JiraProject[] }>('/jira/projects', creds)).projects
}

/** Sends only the approved test cases to the Jira test management tool configured on the server. */
export function exportApprovedTests(req: ExportTestsRequest): Promise<ExportTestsResult> {
  return post<ExportTestsResult>('/test-management/export', req)
}

export async function getJiraStories(creds: JiraCredentials, projectKey: string): Promise<JiraStory[]> {
  return (await post<{ stories: JiraStory[] }>('/jira/stories', { ...creds, projectKey })).stories
}
