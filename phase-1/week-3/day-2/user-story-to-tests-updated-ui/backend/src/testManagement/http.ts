import { TestManagementError, describeHttpError } from './types'

const MAX_RETRY_WAIT_MS = 65_000

/**
 * fetch + JSON with a timeout, readable errors, and one retry after HTTP 429
 * (rate limited), waiting for the Retry-After header.
 */
export async function requestJson<T>(
  toolName: string,
  url: string,
  init: RequestInit,
  { timeoutMs = 30_000, retryOn429 = true }: { timeoutMs?: number; retryOn429?: boolean } = {}
): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    throw new TestManagementError(`Could not reach ${toolName}: ${(err as Error).message}`, 502)
  }

  if (res.status === 429 && retryOn429) {
    const retryAfter = Number(res.headers.get('retry-after'))
    const waitMs = Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5_000, MAX_RETRY_WAIT_MS)
    console.warn(`[${toolName}] rate limited, retrying in ${Math.round(waitMs / 1000)}s`)
    await new Promise(r => setTimeout(r, waitMs))
    return requestJson<T>(toolName, url, init, { timeoutMs, retryOn429: false })
  }

  if (!res.ok) throw new TestManagementError(await describeHttpError(res, toolName), res.status)

  const text = await res.text()
  if (!text) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    // Some APIs (e.g. Xray authenticate) return a bare string
    return text as unknown as T
  }
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
