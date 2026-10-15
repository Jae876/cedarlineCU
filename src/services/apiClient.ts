export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

type ApiRequestOptions = RequestInit & { sessionScope?: 'user' | 'admin' | 'none' }

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const isAdminRoute = path.startsWith('/api/admin/')
  const { sessionScope, ...requestOptions } = options
  const scope = sessionScope || (isAdminRoute ? 'admin' : 'user')
  const token = scope === 'none' ? null : localStorage.getItem(scope === 'admin' ? 'adminToken' : 'token')
  const headers = new Headers(requestOptions.headers)
  if (requestOptions.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(path, {
    ...requestOptions,
    headers,
    credentials: 'include',
    cache: 'no-store',
  })
  const text = await response.text()
  let payload: Record<string, unknown> = {}
  if (text) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>
    } catch {
      payload = { message: text }
    }
  }
  if (!response.ok) {
    if (response.status === 401 && token) clearSession(scope === 'admin')
    const message = String(payload.error || payload.message || `Request failed (${response.status}).`)
    throw new ApiError(message, response.status)
  }
  return payload as T
}

export function persistSession(token: string, user: unknown, admin = false) {
  localStorage.setItem(admin ? 'adminToken' : 'token', token)
  localStorage.setItem(admin ? 'adminUser' : 'user', JSON.stringify(user))
  localStorage.setItem(admin ? 'adminAuthTime' : 'authTime', Date.now().toString())
}

export function clearSession(admin = false) {
  localStorage.removeItem(admin ? 'adminToken' : 'token')
  localStorage.removeItem(admin ? 'adminUser' : 'user')
  localStorage.removeItem(admin ? 'adminAuthTime' : 'authTime')
}
