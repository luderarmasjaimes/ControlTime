# 🟢 ESTADO DEL SISTEMA - 23/03/2026 18:03

## ✅ SERVICIOS ACTIVOS Y SALUDABLES

| Servicio | Puerto | URL | Estado | Descripción |
|----------|--------|-----|--------|-------------|
| **Frontend** | 5173 | http://localhost:5173 | 🟢 HEALTHY | UI React/Vite con MapLibre GL |
| **Backend API** | 8081 | http://localhost:8081 | 🟢 HEALTHY | C++ Boost.Asio con conversión GDAL |
| **Backend TLS** | 8443 | https://localhost:8443 | 🟢 HEALTHY | Gateway Mining con certificados |
| **Tile Server** | 8000 | http://localhost:8000 | 🟢 UP | MBTiles con mbtileserver |
| **TimescaleDB** | 5432 | localhost:5432 | 🟢 HEALTHY | PostgreSQL 15 + TimescaleDB |
| **Mining Report UI** | 8090 | http://localhost:8090 | 🟢 UP | UI Editor |
| **Gateway Tester UI** | 8080 | http://localhost:8080 | 🟢 UP | Testing Interface |

---

## 📋 CAPACIDADES DEL SISTEMA

```json
{
  "ecw_supported": false,
  "gdal_formats": ["GeoTIFF", "GTiff", "VRT"],
  "conversion_pipeline": "GDAL + OpenCV",
  "output_format": "MBTiles",
  "min_zoom": 0,
  "max_zoom": 18,
  "compression_options": ["JPEG", "PNG", "WEBP"],
  "resampling_methods": ["NEAREST", "BILINEAR", "CUBIC", "CUBICSPLINE"],
  "database": "TimescaleDB (PostgreSQL 15)"
}
```

---

## 🚀 ACCESO RÁPIDO A LA APLICACIÓN

### Interfaz Principal
- **URL**: [http://localhost:5173](http://localhost:5173)
- **Usuarios Demo**: Ver `data/auth/users.json`
- **Funcionalidad**: 
  - Dashboard de monitoreo satelital
  - Editor de mapas
  - Conversión ECW ↔ MBTiles
  - Visualización de tiles
  - Reportes avanzados

### APIs Disponibles

#### Health Check
```bash
curl http://localhost:8081/health
```

#### Capacidades
```bash
curl http://localhost:8081/api/capabilities
```

#### Listar Tiles
```bash
curl http://localhost:8000/data/
```

---

## 📁 ESTRUCTURA DE DATOS

```
data/
├── auth/          → Credenciales de usuarios (users.json)
├── incoming/      → Archivos ECW/GeoTIFF a procesar
│   └── input.ecw          (archivo de ejemplo)
│   └── smoke_test.mbtiles (tiles de prueba)  
├── tiles/         → MBTiles generados
│   └── fast_test.mbtiles
│   └── smoke_test.mbtiles
│   └── test_app_conversion.mbtiles
└── demo/          → Assets demo
```

---

## 🧪 PRUEBAS RECOMENDADAS

### 1️⃣ Test de Smoke (Recomendado - Automatizado)
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-test.ps1
```

### 2️⃣ Test E2E con Playwright
```bash
cd frontend
npm test
```

### 3️⃣ Test Manual de Conversión
```json
POST http://localhost:8081/api/convert
Content-Type: application/json

{
  "input_path": "/data/incoming/input.ecw",
  "output_name": "test_output.mbtiles",
  "min_zoom": 0,
  "max_zoom": 18,
  "compression": "JPEG",
  "quality": 85,
  "resampling": "BILINEAR"
}
```

### 4️⃣ Test de Base de Datos
```bash
psql -h localhost -U sensors -d sensors_db -c "SELECT version();"
```

---

## 📊 SCHEMAS DE BASE DE DATOS

| Schema | Tablas | Propósito |
|--------|--------|----------|
| `public` | users, audit_logs | Autenticación y auditoría |
| `telemetry` | sensor_data, hypertables | Series temporales de sensores |
| `mining` | reports, tasks | Reportes y procesos |
| `biometric` | face_enrollments, face_comparisons | Datos biométricos |

---

## 🔐 SEGURIDAD

- ✅ TLS 1.3 en puerto 8443
- ✅ Certificados autofirmados (certs/)
- ✅ Autenticación básica configurada
- ✅ Base de datos con contraseña
- ✅ Auditoría de accesos activa

---

## 📝 CONFIGURACIÓN DE VARIABLES

`.env` sugerido (opcional):
```env
BIOMETRIC_DNN_ENABLE=false
BIOMETRIC_DNN_THRESHOLD=0.72
BIOMETRIC_DNN_LABELS=glasses,hat,mask,makeup
AUTH_ADMIN_USERS=admin
DERMALOG_REQUIRED=false
```

---

## 🛑 DETENER SERVICIOS

```bash
docker-compose down
```

---

## 📞 LOGS EN VIVO

```bash
# Frontend
docker-compose logs -f frontend

# Backend
docker-compose logs -f web

# Base de datos
docker-compose logs -f db

# Todos
docker-compose logs -f
```

---

**Generado**: 2026-03-23 18:03  
**Estado**: ✅ TODOS LOS SERVICIOS OPERACIONALES
