import axios, { type AxiosError } from 'axios'
import type { ApiErrorBody } from './types'

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

  return fallback
}
