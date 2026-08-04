# ADR-006 — Multitenancy obligatorio por tenant_id

| Campo | Valor |
|---|---|
| **Estado** | **Aceptado** |
| **Fecha** | 2026-06-24 |
| **Decisor(es)** | Arquitecto TI |
| **Features** | `002`, `006`, `007`, `009`, `010` |

## Contexto
Varias empresas mineras LATAM comparten la plataforma. Fuga de datos entre tenants es inaceptable contractualmente.

## Decisión
Todo dato de negocio incluye `tenant_id`. Toda query y endpoint filtra por tenant de sesión. Denegar por defecto (Art. 1 y 6 Constitución).

## Consecuencias
- Migración 16 en `db_scripts/`; tests de aislamiento obligatorios en CI
- Ningún PR mergeable sin verificación multitenant
