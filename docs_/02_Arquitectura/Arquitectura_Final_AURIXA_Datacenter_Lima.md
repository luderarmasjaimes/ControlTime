# ARQUITECTURA FINAL RECOMENDADA - AURIXA EN LIMA

## 1. Recomendacion ejecutiva

La arquitectura final recomendada para AURIXA es un esquema **primario-secundario en Lima**, con **virtualizacion dedicada enterprise**, **replicacion continua**, **VPN site-to-site**, **backups externos** y **failover controlado**, evitando depender de un solo VPS o de un unico punto de falla.

La combinacion recomendada es:

1. **Sitio primario: Cirion LIM1**
2. **Sitio secundario / DR: GTD Lurin**

Esta recomendacion responde mejor al objetivo de TIME TELEMETRY: operar una plataforma nacional de telemetria minera 24x7 con mayor control local, continuidad, baja latencia nacional y soporte a conectividad dificil en Peru.

## 2. Principios de diseno

1. Alta disponibilidad real, no solo respaldo manual.
2. Separacion fisica razonable entre primario y secundario.
3. Control local en Lima Metropolitana.
4. Baja latencia para operacion nacional.
5. Seguridad por capas.
6. Recuperacion rapida ante falla mayor.
7. Observabilidad y monitoreo 24x7.

## 3. Topologia recomendada

### Sitio primario

1. Cluster de virtualizacion dedicada en Lima.
2. VM principal de aplicacion.
3. VM de base de datos primaria.
4. VM de integraciones y servicios de mensajeria.
5. Firewall virtual o administrado.
6. Segmentacion por VLAN para aplicacion, datos, gestion y respaldo.

### Sitio secundario

1. Cluster equivalente o nodo de contingencia en segundo data center.
2. Replica continua de base de datos.
3. Replica de snapshots y respaldos criticos.
4. Capacidad de levantar servicios criticos ante falla del primario.

### Conectividad

1. VPN site-to-site entre ambos sitios.
2. Acceso seguro para usuarios administrativos.
3. Enlaces redundantes y monitoreados.
4. Priorizacion de trafico critico de telemetria y servicios operativos.

## 4. Dimensionamiento objetivo inicial

### Nodo principal

1. 16 a 24 vCPU dedicados.
2. 64 a 128 GB RAM ECC.
3. NVMe enterprise RAID1.
4. IOPS garantizados iguales o mayores a 20,000.
5. Puerto dedicado de 1 Gbps.

### Nodo secundario

1. Capacidad equivalente o escalable para failover.
2. Almacenamiento replicado.
3. Recursos reservados para contingencia.

## 5. Servicios minimos que deben quedar contratados

1. Monitoreo 24x7.
2. Firewall administrado.
3. Anti-DDoS.
4. Snapshots automaticos.
5. Backups externos.
6. Politica de retencion.
7. Recuperacion granular.
8. NOC 24x7.
9. Soporte critico empresarial.
10. Reporte de SLA mensual.

## 6. Modelo de continuidad recomendado

### Escenario normal

1. El sitio primario opera toda la carga productiva.
2. El secundario replica continuamente datos y configuracion critica.
3. Los backups se almacenan fuera del host primario.

### Escenario de falla parcial

1. Si cae una VM o un host del cluster primario, la carga se reubica dentro del mismo sitio.
2. Si se degrada almacenamiento o red, el monitoreo genera alerta critica inmediata.

### Escenario de falla mayor del sitio primario

1. Se activa el sitio secundario con datos replicados.
2. El objetivo contractual debe ser un RTO menor a 5 minutos si el proveedor realmente lo soporta.
3. Si el proveedor no puede garantizar ese RTO, debe definirse un RTO realista y formalmente comprometido.

## 7. Seguridad recomendada

1. VLAN separadas por rol.
2. VPN site-to-site para integraciones y acceso administrativo.
3. Firewall con reglas de minimo privilegio.
4. Anti-DDoS en borde.
5. IDS/IPS opcional segun costo-beneficio.
6. MFA para accesos de administracion.
7. Bitacora centralizada y retencion de logs.

## 8. Recomendacion de compra

La compra debe pedirse como:

**"Infraestructura de nube privada empresarial o virtualizacion dedicada en Lima, con alta disponibilidad, sitio secundario, replicacion continua, backups externos, monitoreo y seguridad administrada"**

No se recomienda formular la compra solo como `VPS`, porque eso invita propuestas de menor nivel de control, menor garantia de recursos y menor capacidad contractual de continuidad.

## 9. Fases sugeridas de implementacion

### Fase 1 - RFQ y evaluacion

1. Envio de RFQ a proveedores shortlist.
2. Comparacion tecnica y economica.
3. Validacion de SLA, RTO, RPO y NOC.

### Fase 2 - Provisionamiento

1. Provisionamiento del sitio primario.
2. Provisionamiento del sitio secundario.
3. Configuracion de red, seguridad y backups.

### Fase 3 - Migracion controlada

1. Replica inicial desde AWS.
2. Pruebas funcionales y de rendimiento.
3. Prueba de failover.
4. Cutover programado.

### Fase 4 - Estabilizacion

1. Monitoreo intensivo post migracion.
2. Ajustes de performance.
3. Validacion de continuidad.

## 10. Conclusion ejecutiva

La mejor arquitectura para AURIXA no es un VPS aislado, sino un esquema empresarial en Lima con dos sitios, recursos dedicados y gobierno de continuidad. Bajo ese criterio, la combinacion **Cirion LIM1 como primario** y **GTD Lurin como secundario** es la recomendacion mas solida para iniciar el proceso de RFQ y negociacion.
