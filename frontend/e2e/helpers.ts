import type { Page } from '@playwright/test'

/**
 * El shell principal (App.tsx) muestra un prompt "Mantenimiento de Usuarios"
 * en CADA carga de página para sesiones admin/supervisor (no solo en el
 * primer login real -- dispara en cualquier montaje con
 * `session?.company && canMaintain`, ver App.tsx). Las specs de e2e seedean
 * una sesión falsa admin/supervisor vía localStorage antes de `page.goto('/')`,
 * así que este prompt aparece siempre y bloquea cualquier click posterior
 * (p.ej. "Abrir Report") si no se descarta primero. No confundir con
 * `UserMaintenanceModal.tsx` (el modal real de mantenimiento, que sí se abre
 * a propósito en `user-maintenance.spec.ts`) -- este es solo el prompt de
 * "¿desea hacerlo ahora?" previo a ese modal.
 */
export async function dismissUserMaintenancePrompt(page: Page): Promise<void> {
  const dismissBtn = page.getByRole('button', { name: 'Ahora no' })
  if (await dismissBtn.isVisible().catch(() => false)) {
    await dismissBtn.click()
  }
}

/**
 * La navegación es de dos niveles (ADR-040): una categoría (p.ej.
 * "Reportes", "Mapas") que hay que abrir/expandir primero, y recién ahí
 * aparecen sus módulos ("Abrir Report", "Abrir Report v2", "Abrir Map",
 * etc.) como botones propios. Las specs viejas asumían una lista plana de
 * módulos visibles de entrada -- desactualizado desde que se introdujo ese
 * sistema de navegación.
 *
 * El nombre ACCESIBLE (ARIA) de cada botón de categoría es su `title`
 * (descripción larga, p.ej. "Mapa satelital de la operación y planos de
 * alta resolución."), NO la etiqueta corta visible ("Mapas") -- por eso
 * `getByRole('button', { name: 'Mapas' })` nunca matchea. Se busca por
 * TEXTO VISIBLE del botón en su lugar (el `<span>` interno sí dice
 * "Mapas"), con `.first()` porque el badge ("MAP", "Beta", etc.) queda
 * concatenado al mismo texto y podría, en teoría, dar más de un candidato.
 */
export async function openCategory(page: Page, categoryLabel: string): Promise<void> {
  const categoryBtn = page.locator('button').filter({ hasText: categoryLabel }).first()
  if (await categoryBtn.isVisible().catch(() => false)) {
    await categoryBtn.click()
  }
}

/**
 * "Mis Informes" (biblioteca de informes guardados, onOpenReportsAdmin) vive
 * dentro de la pestaña "Datos" del ribbon de ReportStudioV2 (RibbonToolbar.tsx,
 * grupo "Informes") -- no es visible con la pestaña "Inicio" (la que abre por
 * defecto). Hay que cambiar de pestaña del ribbon primero.
 *
 * Se usa texto visible (no accessible name/getByRole) para ambos clicks --
 * los botones del ribbon (RibbonBtn) llevan un `title` largo/descriptivo
 * distinto de su label corto visible, y distintas herramientas de
 * accesibilidad resuelven el nombre accesible de forma distinta para ese
 * patrón (title vs. contenido de texto) -- filtrar por texto visible evita
 * la ambigüedad por completo.
 */
export async function openMisInformes(page: Page): Promise<void> {
  await page.locator('button').filter({ hasText: 'Datos' }).first().click()
  await page.locator('button').filter({ hasText: 'Mis Informes' }).first().click()
}

export interface RealLoginCreds {
  company: string
  username: string
  password: string
}

const DEFAULT_BACKEND_URL = 'http://localhost:8082'

/**
 * Hace un login REAL contra el backend (POST /api/auth/login/password) y
 * siembra la sesion resultante en localStorage antes de `page.goto('/')`.
 *
 * Reemplaza el patron anterior de inyectar un token falso
 * (`token: 'tok_e2e_admin'`, etc.) que rompia con el endurecimiento de
 * ADR-029: cualquier llamada autenticada real que el backend rechazara (401)
 * disparaba el logout automatico ("Sesion expirada...") y vaciaba el
 * localStorage relevante antes de que el test pudiera hacer sus asserts. Con
 * un access_token real y valido, el flujo de refresh/backend funciona sin
 * intervencion adicional.
 */
export interface RealLoginResult {
  token: string
  userId: string
  tenantId: string
  company: string
  username: string
  fullName: string
  backendUrl: string
}

export async function realLogin(
  page: Page,
  creds: RealLoginCreds,
  backendUrl: string = process.env.VITE_BACKEND_URL || DEFAULT_BACKEND_URL,
): Promise<RealLoginResult> {
  const response = await page.request.post(`${backendUrl}/api/auth/login/password`, {
    data: creds,
  })
  const body = await response.json()
  if (body.status !== 'authenticated' || !body.user?.access_token) {
    throw new Error(`realLogin: fallo el login real para ${creds.username}@${creds.company}: ${JSON.stringify(body)}`)
  }

  const user = body.user
  const session = {
    userId: user.id,
    username: user.username,
    fullName: user.full_name || '',
    company: user.company,
    tenantId: user.tenant_id || '',
    role: (user.role || '').toLowerCase(),
    loginType: 'user',
    token: user.access_token,
    accessTokenExpiresAt: new Date(Date.now() + (user.expires_in || 900) * 1000).toISOString(),
    loggedAt: new Date().toISOString(),
  }

  await page.addInitScript((sessionData) => {
    localStorage.clear()
    localStorage.setItem('mining_auth_session_v1', JSON.stringify(sessionData))
  }, session)

  return {
    token: user.access_token,
    userId: user.id,
    tenantId: user.tenant_id || '',
    company: user.company,
    username: user.username,
    fullName: user.full_name || '',
    backendUrl,
  }
}
