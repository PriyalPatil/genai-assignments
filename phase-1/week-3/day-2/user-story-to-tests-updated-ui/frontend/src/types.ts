export interface GenerateRequest {
  storyTitle: string
  acceptanceCriteria: string
  description?: string
  additionalInfo?: string
  provider?: string
  model?: string
  autoSwitch?: boolean
  testCaseCount?: number
  categories?: string[]
}

export interface TestCase {
  id: string
  title: string
  steps: string[]
  testData?: string
  expectedResult: string
  category: string
}

export interface AttemptLog {
  provider: string
  providerName: string
  model: string
  ok: boolean
  reason?: string
}

export interface GenerateResponse {
  summary?: string
  requestedCount?: number
  requestedCategories?: string[]
  cases: TestCase[]
  model?: string
  provider?: string
  providerName?: string
  attempts?: AttemptLog[]
  promptTokens: number
  completionTokens: number
}

export interface ProviderInfo {
  id: string
  name: string
  defaultModel: string
  models: string[]
  /** Set when the live model list could not be fetched (e.g. invalid API key) */
  error?: string
}

export interface AppConfig {
  providers: ProviderInfo[]
  autoSwitchDefault: boolean
  jira: {
    enabled: boolean
  }
  /** Jira test management app that approved test cases are sent to */
  testManagement?: TestManagementStatus
}

export interface TestManagementStatus {
  enabled: boolean
  tool?: 'xray' | 'zephyr' | 'aio'
  toolName?: string
  defaultProjectKey?: string
  problem?: string
}

export interface ExportTestsRequest {
  projectKey: string
  story?: { key: string; id?: string }
  cases: TestCase[]
}

export interface ExportedCase {
  sourceId: string
  key: string
  url?: string
}

export interface ExportTestsResult {
  tool: string
  toolName: string
  created: ExportedCase[]
  failed: Array<{ sourceId: string; error: string }>
  warnings: string[]
}

export interface JiraCredentials {
  email: string
  baseUrl: string
}

export interface JiraProject {
  id: string
  key: string
  name: string
}

export interface JiraStory {
  /** Numeric Jira issue id */
  id: string
  key: string
  summary: string
  status?: string
  issueType?: string
  priority?: string
  labels: string[]
  description: string
  acceptanceCriteria: string
  url: string
}
