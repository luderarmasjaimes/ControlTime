# 🚀 GUÍA COMPLETA DE PRUEBA DEL SISTEMA

**Generado**: 23/03/2026  
**Estado**: ✅ TODO OPERACIONAL  

---

## 📍 ACCESO A SERVICIOS

### 🌐 Interfaz Web Principal
```
URL: http://localhost:5173
```

### 🔌 API Backend
```
URL: http://localhost:8081
Health: http://localhost:8081/health
Capabilities: http://localhost:8081/api/capabilities
```

### 🗺️ Tile Server (Visor de Mapas)
```
URL: http://localhost:8000
```

---

## 👤 CREDENCIALES DE PRUEBA

**Usuario Demo Available**:
- **Username**: smoke_20260311182640
- **DNI**: 91182640
- **Company**: Minera Raura
- **Rol**: Smoke Tester
- **Biometric**: Disponible (face_template configurado)

---

## 📦 ARCHIVOS DISPONIBLES PARA PROCESAMIENTO

### Entrada (data/incoming)
- ✅ `input.ecw` - Archivo georreferenciado ECW
- ✅ `smoke_test_geo.tif` - GeoTIFF de prueba georreferenciado
- ✅ `smoke_test.jpg` - Imagen de prueba
- ✅ `test_geo.tif` - Imagen de prueba georreferenciada

### Tiles Generados (data/tiles)
- ✅ `smoke_test.mbtiles` - Tiles de prueba (Ready)
- ✅ `test_geo.mbtiles` - Tiles de prueba (Ready)
- ✅ `fast_test.mbtiles` - Tiles rápidos (Ready)
- ✅ `test_app_conversion.mbtiles` - Tiles conversión app (Ready)

---

## 🧪 PRUEBAS DISPONIBLES

### ✅ Prueba 1: Endpoint de Salud
```bash
curl http://localhost:8081/health
```
**Resultado Esperado**:
```json
{
  "status": "ok"
}
```

---

### ✅ Prueba 2: Capacidades del Sistema
```bash
curl http://localhost:8081/api/capabilities
```
**Resultado Esperado**:
```json
{
  "ecw_supported": false,
  "gdal_formats": ["GeoTIFF", "GTiff", "VRT"],
  "conversion_pipeline": "GDAL",
  "output_format": "MBTiles"
}
```

---

### ✅ Prueba 3: Conversión Básica de Tiles
**Endpoint**: `POST /api/convert`

```bash
curl -X POST http://localhost:8081/api/convert \
  -H "Content-Type: application/json" \
  -d '{
    "input_path": "/data/incoming/test_geo.tif",
    "output_name": "conv_prueba.mbtiles",
    "min_zoom": 0,
    "max_zoom": 14,
    "compression": "JPEG",
    "quality": 85,
    "resampling": "BILINEAR"
  }'
```

**Respuesta Esperada**:
```json
{
  "job_id": "xxxxx",
  "status": "queued|processing|completed",
  "output_path": "/data/tiles/conv_prueba.mbtiles",
  "progress": 0-100
}
```

---

### ✅ Prueba 4: Listar Tiles en Servidor
```bash
curl http://localhost:8000/data/
```

---

### ✅ Prueba 5: Frontend UI
1. Abre [http://localhost:5173](http://localhost:5173)
2. **Login**:
   - Username: `smoke_20260311182640`
   - Biometric: Face (si está configurado)
3. **Dashboard**: Visualiza datos de sensores y mapas
4. **Editor**: Rica edición de capas geoespaciales
5. **Tiles**: Carga y visualiza tiles generados

---

### ✅ Prueba 6: Base de Datos (TimescaleDB)

```bash
# Conectar a DB desde host Windows
psql -h localhost -U sensors -d sensors_db
```

**Credenciales**:
- Host: localhost
- Port: 5432
- User: sensors
- Password: sensors_pass
- Database: sensors_db

**Consultas de Prueba**:
```sql
-- Ver versión y componentes
SELECT version();

-- Contar usuarios registrados
SELECT COUNT(*) as usuarios FROM public.users;

-- Ver tablas disponibles
\dt

-- Ver hypertables (series temporales)
SELECT * FROM timescaledb_information.hypertables;

-- Consultar datos de sensores
SELECT * FROM telemetry.sensor_data LIMIT 10;

-- Ver logs de auditoría
SELECT * FROM public.audit_logs ORDER BY created_at DESC LIMIT 10;
```

---

### ✅ Prueba 7: Logs en Vivo

**Backend**:
```bash
docker-compose logs -f web
```

**Frontend**:
```bash
docker-compose logs -f frontend
```

**Database**:
```bash
docker-compose logs -f db
```

**Todos los servicios**:
```bash
docker-compose logs -f
```

---

### ✅ Prueba 8: Smoke Test Automatizado
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-test.ps1
```

Este script:
1. Valida disponibilidad de servicios
2. Genera imagen de prueba
3. Ejecuta georreferenciación
4. Realiza conversión a MBTiles
5. Verifica publicación de tiles
6. Valida accesibilidad del frontend

---

### ✅ Prueba 9: E2E Tests con Playwright
```bash
cd frontend
npm install  # Si no está hecho
npm test     # Ejecutar tests
```

Tests disponibles:
- `dashboard.spec.ts` - Dashboard funcionalidad
- `editor.spec.ts` - Editor de mapas
- `editor-save.spec.ts` - Guardar cambios
- `report-v2-admin.spec.ts` - Reportes admin
- `user-maintenance.spec.ts` - Gestión de usuarios

---

### ✅ Prueba 10: Monitoreo de Sistema

**Estado de contenedores**:
```bash
docker stats
```

**Uso de disco**:
```bash
docker system df
```

**Tamaño de volúmenes**:
```bash
docker volume ls -q | xargs docker volume inspect
```

---

## 🔍 PROBLEMAS COMUNES Y SOLUCIONES

| Problema | Causa | Solución |
|----------|-------|----------|
| Frontend no carga | Contenedor no saludable | `docker-compose restart frontend` |
| API retorna 500 | Backend no conectado a DB | `docker-compose logs web` |
| Tiles no se visualizan | Tile server no cargado | `docker-compose restart tileserver` |
| DB sin datos | Scripts no ejecutados | Revisar `docker-compose logs db` |
| Conversión lenta | Recursos limitados | Aumentar memoria Docker |

---

## 📊 MÉTRICAS ESPERADAS

| Métrica | Valor |
|---------|-------|
| Backend Startup | ~10-15 segundos |
| DB Ready | ~10 segundos |
| Frontend Build | ~30-45 segundos |
| Conversión 512x512 GeoTIFF → MBTiles (14 zooms) | ~5-10 segundos |
| Tile Server Response | <50ms |
| Frontend First Paint | <2 segundos |

---

## ⚙️ CONFIGURACIÓN ACTUAL

```yaml
Servicios Activos:
  - Frontend: React/Vite en puerto 5173
  - Backend: C++ Boost en puerto 8081
  - TLS Gateway: Puerto 8443
  - Tile Server: puerto 8000
  - Database: TimescaleDB en puerto 5432

Volúmenes Compartidos:
  - ./data:/data (compartido entre host y contenedores)
  - db_data: volumen Docker para persistencia de DB

Redes:
  - bridge: conecta todos los servicios

Certificados:
  - ./certs/server.crt (TLS)
  - ./certs/server.key (TLS privada)
```

---

## 🛑 DETENER TODO

```bash
docker-compose down

# Con limpieza completa (perderá datos)
docker-compose down -v
```

---

## 📝 NOTAS IMPORTANTES

1. **ECW No Soportado**: Sin licencia GDAL ECW, solo se procesan GeoTIFF/VRT
2. **Biometría**: Configurada de prueba sin Dermalog SDK real
3. **Datos Persistentes**: Almacenados en `./data/` y volumen `db_data`
4. **Certificados**: Autofirmados en `./certs/`
5. **Admin User**: `admin` (por defecto)

---

**✅ SISTEMA LISTO PARA PRUEBAR TODAS LAS FUNCIONALIDADES**
