# Análisis SYS — inicio mes 2 y VPS de desarrollo

**Proyecto:** Etapa 1 Plataforma Reportabilidad (Jun–Nov 2026)  
**Fuente actualizada:** `Plataforma_Minera_ClickUp_v17.xlsx`  
**Cambio aplicado:** SYS no trabaja en **junio (mes 1)**; arranca en **julio (mes 2)**.

---

## 1. ¿Se puede mover SYS al segundo mes?

**Sí, es viable y ya está aplicado en el cronograma.**

| Antes | Después |
|---|---|
| DEV-001 (Git) en **junio** sem 1–2 | DEV-001 en **julio** 6–17 |
| DEV-002/003 en sem 5–8 (fin jun / jul) | DEV-002 jul 17–31, DEV-003 **31 jul – 7 ago** |
| QA-002 staging sem 5–6 | QA-002 **7–14 ago** (después del VPS dev) |
| SYS en junio ~100% carga | **0 tareas SYS en junio** |

**Junio (mes 1) queda para:** ARQ, BE, FE, QA — diseño, arquitectura, prototipos locales.  
**No se necesita VPS ni SYS** mientras el equipo usa laptops + `docker compose` local.

**Carga SYS tras el cambio:**

| Mes | Carga SYS |
|---|---|
| Junio | **0%** (sin tareas) |
| Julio | ~92% |
| Agosto | ~94% |
| Sep–Nov | ~100% (infra productiva + GoLive) |

---

## 2. ¿Desde cuándo necesitamos el VPS de desarrollo?

### Línea de tiempo de ambientes

```
Jun 2026          Jul 2026              Ago 2026              Oct 2026           Nov 2026
│                 │                     │                     │                  │
│  Laptops        │  DEV-001 Git        │  DEV-003 VPS DEV ★  │  DEV-005 VPS PROD│  GoLive
│  docker local   │  DEV-002 Docker     │  DEV-004 VPS STAGING│  P2-M5 + VPS-*   │
│  (sin VPS)      │                     │  QA-002 staging     │                  │
```

| Ambiente | Cuándo contratar | Tarea | Fechas actuales |
|---|---|---|---|
| **Ninguno (local)** | Jun – mid Jul 2026 | — | Desarrollo en laptops |
| **VPS DESARROLLO** | **~31 jul 2026** | DEV-003 | 2026-07-31 → 2026-08-07 |
| **VPS STAGING / QA** | **~7 ago 2026** | DEV-004, QA-002 | 2026-08-07 → 2026-08-28 |
| **VPS PRODUCCIÓN** | **~oct 2026** | DEV-005, P2-M5-003 | 2026-10-01 → 2026-10-16 |
| **VPS respaldo** | Oct 2026 | VPS-004 | Activo-Pasivo |

### Tamaño sugerido VPS desarrollo (DEV-003)

- **8 vCPU / 32 GB RAM / 500 GB NVMe**
- Ubuntu 22.04 LTS, Docker, todos los servicios del `docker-compose`
- Acceso: VPN/SSH por rol (BE, FE, QA, IA)

### ¿Por qué no antes de fin de julio?

1. **DEV-002** debe terminar los Dockerfiles (17–31 jul).
2. En **junio–inicio julio** backend/frontend avanzan con mocks y compose local.
3. El VPS dev se justifica cuando hay **integración compartida** (varios devs, IA, sensores simulados).

---

## 3. Descripciones SYS mejoradas

Todas las tareas SYS/DevOps clave usan ahora este formato en ClickUp:

- **OBJETIVO** — qué se hace
- **PARA LA MINA** — beneficio operativo
- **ENTREGABLE** — qué se entrega
- **VPS REQUERIDO** — ninguno / desarrollo / staging / producción
- **DEPENDE DE** — tarea previa
- **ÉXITO** — criterio verificable

Tareas actualizadas: `DEV-001` a `DEV-005`, `SYS-I01` a `SYS-I14`, `IA-M03`, `P1-M4-004`, `P2-M5-001/002/003`, `VPS-001/002/003`, `QA-002`.

---

## 4. Archivos de revisión SYS

| Archivo | Contenido |
|---|---|
| `docs/SYS_Etapa1_Solo_SYS.md` | 18 tareas exclusivas SYS |
| `docs/SYS_Etapa1_Compartidas.md` | 40 tareas SYS + otros recursos |
| `docs/SYS_Etapa1_Tareas_Revision.csv` | Export completo |

Regenerar:

```bash
python scripts/generate_clickup_import.py
python scripts/generate_clickup_nueva_plataforma.py
python scripts/extract_sys_etapa1.py
```

---

## 5. Recomendación gerencial

1. **Junio:** no contratar VPS; presupuesto SYS = 0 infra.
2. **Semana del 28 jul 2026:** orden de compra VPS desarrollo (DEV-003).
3. **Primera semana ago 2026:** VPS staging para QA (DEV-004).
4. **Octubre 2026:** VPS producción + respaldo (bloque P2-M5 / VPS-*).
