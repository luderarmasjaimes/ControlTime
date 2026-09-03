# TASKS-021 — Analítica multiserie y zonas

- [x] T1 Crear esquema `sensor_zones` y relación multitenant.
- [x] T2 Implementar catálogo jerárquico tipo/zona/dispositivo.
- [x] T3 Implementar consulta histórica agregada con límites.
- [x] T4 Implementar selector de zona y sensores.
- [x] T5 Implementar widget y selector de diez tipos de gráfico.
- [x] T6 Crear catálogo y telemetría sintética de demostración.
- [x] T7 Añadir pruebas contractuales y anti-IDOR del backend. *(2026-09-02: cerrado — `resolveAllowedSensorTenant` se extrajo a `backend/src/mining/sensor_tenant_resolver.cpp` (unidad de compilación propia, sin la cadena OpenCV/ONNX que bloqueaba el intento del 2026-08-30) y `backend/tests/test_sensor_anti_idor.cpp` ya compila y corre en el target liviano `beemetry_backend_tests`. Verificado con `docker build -f backend/Dockerfile.verify` limpio (sin cache): 742 aserciones en 50 test cases, 100% passed, incluidas las 4 del guard anti-IDOR (sesión sin `tenant_id`, `tenant_id` propio, `tenant_id` vacío, y el caso real de IDOR — tenant ajeno sin membresía real → fail-closed). La rama de acceso cruzado REAL con Postgres vivo (`userBelongsToTenant` consultando `auth_user_tenant`) sigue sin cubrir por este test unitario — solo se verifica que sin BD el resultado es fail-closed, no que la concesión real funcione con datos reales.)*
- [ ] T8 Validar visualmente los diez tipos y estados vacíos.
- [ ] T9 Verificar exportación PDF/PPTX y unidades/ejes.
- [ ] T10 Incorporar la suite al gate CI y registrar evidencia E2E.
