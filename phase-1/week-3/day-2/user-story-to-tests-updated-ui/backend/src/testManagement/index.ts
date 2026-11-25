import { TestManagementAdapter, TestManagementToolId, env } from './types'
import { xrayAdapter } from './xray'
import { zephyrScaleAdapter } from './zephyrScale'
import { aioAdapter } from './aio'

const ADAPTERS: Record<TestManagementToolId, TestManagementAdapter> = {
  xray: xrayAdapter,
  zephyr: zephyrScaleAdapter,
  aio: aioAdapter
}

const ALIASES: Record<string, TestManagementToolId> = {
  xray: 'xray',
  zephyr: 'zephyr',
  'zephyr-scale': 'zephyr',
  zephyrscale: 'zephyr',
  aio: 'aio',
  'aio-tests': 'aio',
  aiotests: 'aio'
}

/** The tool chosen with TEST_MANAGEMENT_TOOL in .env, or undefined when not set / unknown. */
export function getSelectedAdapter(): TestManagementAdapter | undefined {
  const raw = env('TEST_MANAGEMENT_TOOL')?.toLowerCase()
  const id = raw ? ALIASES[raw] : undefined
  return id ? ADAPTERS[id] : undefined
}

export interface TestManagementStatus {
  /** True when a tool is selected and all its required settings are present */
  enabled: boolean
  tool?: TestManagementToolId
  toolName?: string
  /** Default Jira project key for new test cases (TEST_MANAGEMENT_PROJECT_KEY) */
  defaultProjectKey?: string
  /** Why the feature is unavailable, for display in the UI */
  problem?: string
}

export function getTestManagementStatus(): TestManagementStatus {
  const raw = env('TEST_MANAGEMENT_TOOL')
  const defaultProjectKey = env('TEST_MANAGEMENT_PROJECT_KEY')
  if (!raw) {
    return { enabled: false, defaultProjectKey, problem: 'Set TEST_MANAGEMENT_TOOL (xray, zephyr or aio) in .env to send approved test cases to Jira.' }
  }
  const adapter = getSelectedAdapter()
  if (!adapter) {
    return { enabled: false, defaultProjectKey, problem: `Unknown TEST_MANAGEMENT_TOOL "${raw}". Use xray, zephyr or aio.` }
  }
  const missing = adapter.missingConfig()
  if (missing.length) {
    return {
      enabled: false,
      tool: adapter.id,
      toolName: adapter.name,
      defaultProjectKey,
      problem: `${adapter.name} is selected but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing in .env.`
    }
  }
  return { enabled: true, tool: adapter.id, toolName: adapter.name, defaultProjectKey }
}
