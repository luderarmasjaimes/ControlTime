/** UUID fijo de demo en BD (28_mining_telemetry_uuid_tenant.sql) y fallback backend. */
export const TELEMETRY_DEFAULT_TENANT_ID = 'a0000001-0000-4000-8000-000000000001'

export function telemetryTenantIdFromSession(session: { tenantId?: string; tenant_id?: string } | null | undefined): string {
    const t = session?.tenantId ?? session?.tenant_id
    if (typeof t === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t.trim())) {
        return t.trim().toLowerCase()
    }
    return TELEMETRY_DEFAULT_TENANT_ID
}
