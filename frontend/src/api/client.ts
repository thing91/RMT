import axios, { type AxiosError } from 'axios'
import type { ApiErrorBody, ApiErrorDetail } from './types'

export const TOKEN_STORAGE_KEY = 'rmt_token'

export const api = axios.create({
  baseURL: '/api/v1',
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY)
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

export function apiStatus(error: unknown): number | undefined {
  return (error as AxiosError)?.response?.status
}

/** The structured `{code, message, reasons, ...}` detail some endpoints
 * return (locks, version conflicts, workflow refusals), if present. */
export function apiErrorDetail(error: unknown): ApiErrorDetail | null {
  const detail = (error as AxiosError<ApiErrorBody>)?.response?.data?.detail
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) return detail as ApiErrorDetail
  return null
}

export function apiErrorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  const axiosError = error as AxiosError<ApiErrorBody>
  const detail = axiosError?.response?.data?.detail

  if (typeof detail === 'string') return detail

  // FastAPI's own request-validation errors (malformed body/params, as
  // opposed to our app-level HTTPExceptions) return `detail` as a list of
  // {loc, msg, type} objects rather than a string.
  if (Array.isArray(detail)) {
    return detail
      .map((d) => (typeof d === 'string' ? d : (d as { msg?: string })?.msg))
      .filter(Boolean)
      .join(' ') || fallback
  }

  if (detail && typeof detail === 'object') {
    const d = detail as ApiErrorDetail
    const reasons = (d.reasons ?? []).filter(
      (r) => !['signature_required', 'signature_failed', 'comment_required', 'wrong_state'].includes(r),
    )
    return [d.message, ...reasons].filter(Boolean).join(' ') || fallback
  }

  return fallback
}

/** Fire-and-forget request that survives the page unloading — used to
 * release an edit lock when the tab closes. `sendBeacon` can't carry an
 * Authorization header, so the token travels in the body instead. */
export function beacon(path: string): void {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY)
  if (!token) return
  const blob = new Blob([JSON.stringify({ token })], { type: 'application/json' })
  navigator.sendBeacon(`/api/v1${path}`, blob)
}
