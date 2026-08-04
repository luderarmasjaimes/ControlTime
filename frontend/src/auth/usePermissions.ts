import { useCallback, useEffect, useState } from 'react'
import { getSession } from './authStorage'
import { authFetch } from './authApi'
import { log } from '../lib/logger'

/**
 * ADR-079: hook único y reutilizable de RBAC para toda la SPA — cualquier
 * módulo (reportes, alarmas, dispositivos, administración) consulta el
 * mismo permiso real del usuario en vez de repetir comparaciones de
 * `session.role` hardcodeadas por componente (el drift que ADR-036/063 ya
 * habían corregido puntualmente, pero sin un mecanismo central).
 *
 * Consume `GET /api/auth/permissions` (`handleMyPermissions`,
 * notification_routes.cpp) — endpoint ya existente, resuelto server-side vía
 * `auth::effectiveRole`/`permissionsForRole`, pero nunca consumido desde el
 * frontend hasta este fix (solo el editor de matriz de administración usaba
 * el endpoint hermano `/matrix`). El backend sigue siendo la única autoridad
 * real: esto solo evita mostrar acciones que el servidor rechazará.
 */

interface PermissionsData {
  role: string
  isAdmin: boolean
  permissions: Set<string>
}

const EMPTY: PermissionsData = { role: '', isAdmin: false, permissions: new Set() }

interface CacheEntry {
  key: string
  data: PermissionsData
}

let cache: CacheEntry | null = null
let inflight: Promise<PermissionsData> | null = null
const listeners = new Set<() => void>()

function sessionKey(): string {
  const session = getSession()
  if (!session?.userId) return ''
  return `${session.userId}:${session.tenantId || ''}`
}

async function loadPermissions(key: string): Promise<PermissionsData> {
  if (cache && cache.key === key) return cache.data
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const response = await authFetch('/api/auth/permissions')
      if (!response.ok) return EMPTY
      const payload = await response.json().catch(() => ({}))
      const data: PermissionsData = {
        role: typeof payload?.role === 'string' ? payload.role : '',
        isAdmin: payload?.is_admin === true,
        permissions: new Set(Array.isArray(payload?.permissions) ? payload.permissions : []),
      }
      cache = { key, data }
      listeners.forEach((notify) => notify())
      return data
    } catch (err) {
      log.warn('[usePermissions] no se pudo cargar /api/auth/permissions', err)
      return EMPTY
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** Invalida la caché — llamar tras logout explícito para no arrastrar el permiso de la sesión anterior si la SPA no recarga la página. */
export function invalidatePermissionsCache(): void {
  cache = null
}

export interface UsePermissionsResult {
  role: string
  isAdmin: boolean
  /** true si el usuario tiene `code` (admin siempre true, igual que `auth::hasPermission` en el backend). */
  hasPermission: (code: string) => boolean
  /** true mientras se resuelve el primer fetch de la sesión/tenant activos — evita parpadeo de acciones antes de conocer el permiso real. */
  loading: boolean
}

export function usePermissions(): UsePermissionsResult {
  const key = sessionKey()
  const [data, setData] = useState<PermissionsData>(() =>
    cache && cache.key === key ? cache.data : EMPTY,
  )
  const [loading, setLoading] = useState(() => Boolean(key) && !(cache && cache.key === key))

  useEffect(() => {
    let cancelled = false
    if (!key) {
      setData(EMPTY)
      setLoading(false)
      return undefined
    }
    if (cache && cache.key === key) {
      setData(cache.data)
      setLoading(false)
      return undefined
    }
    setLoading(true)
    loadPermissions(key).then((result) => {
      if (!cancelled) {
        setData(result)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [key])

  useEffect(() => {
    const notify = () => {
      if (cache && cache.key === key) setData(cache.data)
    }
    listeners.add(notify)
    return () => {
      listeners.delete(notify)
    }
  }, [key])

  const hasPermission = useCallback(
    (code: string) => data.isAdmin || data.permissions.has(code),
    [data],
  )

  return { role: data.role, isAdmin: data.isAdmin, hasPermission, loading }
}
