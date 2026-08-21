# MEMO EJECUTIVO PARA GERENCIA TI

## Recomendacion de arquitectura objetivo para AURIXA en Lima

**Fecha**: 14 de mayo de 2026  
**Dirigido a**: Gerencia TI  
**Preparado por**: Arquitectura TI Senior LATAM

## 1. Proposito

El presente memo tiene por objeto recomendar la arquitectura de infraestructura objetivo para la plataforma AURIXA, en el marco de la evaluacion de migracion desde AWS hacia una plataforma empresarial en Lima para operacion minera 24x7.

## 2. Recomendacion principal

Se recomienda adoptar una arquitectura **primario-secundario en Lima**, bajo modalidad de **nube privada empresarial o virtualizacion dedicada**, con la siguiente combinacion de referencia:

1. **Sitio primario: Cirion LIM1**
2. **Sitio secundario / continuidad: GTD Lurin**

## 3. Fundamento de la recomendacion

La recomendacion se sostiene en cuatro razones principales:

1. **Control y continuidad**: la arquitectura permite reducir dependencia de un unico sitio y ordenar la continuidad operativa bajo un modelo serio de replicacion y failover.
2. **Madurez enterprise**: ambos proveedores muestran un perfil adecuado para una carga critica de telemetria minera 24x7.
3. **Separacion operativa**: la combinacion de un sitio metropolitano con un segundo sitio en Lurin mejora la resiliencia frente a fallas mayores.
4. **Ajuste al caso peruano**: permite operar con foco en latencia nacional, mejor control local y soporte a una red de operaciones distribuidas en costa, sierra y selva.

## 4. Que se debe contratar

La compra no debe formularse como un VPS comercial generico. Debe formularse como:

**Infraestructura de nube privada empresarial o virtualizacion dedicada con alta disponibilidad, sitio secundario, replicacion continua, backups externos, monitoreo 24x7 y seguridad administrada.**

## 5. Componentes minimos requeridos

1. 16 a 24 vCPU dedicados.
2. 64 a 128 GB RAM ECC.
3. NVMe enterprise RAID1.
4. 20,000 IOPS garantizados como minimo.
5. Puerto dedicado de 1 Gbps.
6. Firewall administrado.
7. Anti-DDoS.
8. Snapshots automaticos.
9. Backups externos.
10. Monitoreo y NOC 24x7.
11. Replicacion continua.
12. VPN site-to-site y segmentacion VLAN.

## 6. Beneficio para TI

La combinacion Cirion + GTD entrega a TI una arquitectura con mejor gobernabilidad, mayor capacidad de continuidad, menor riesgo de concentracion y una base mas seria para soportar crecimiento posterior, auditoria y salida controlada a produccion.

## 7. Tabla comparativa senior enterprise mining

Como soporte de decision, se incorpora la siguiente tabla comparativa de lectura senior, enfocada en criterios relevantes para una operacion minera critica en Peru: latencia nacional, comportamiento para IoT, soporte local, resiliencia WAN, predictibilidad de costos, continuidad local y ajuste real al contexto minero.

| Parametro | AWS Sao Paulo | Cirion Lima | GTD Peru | WIN Empresas | Optical |
|---|---|---|---|---|---|
| Latencia Peru | Alta | Excelente | Excelente | Excelente | Muy buena |
| Tiempo respuesta IoT | Medio | Muy alto | Muy alto | Alto | Alto |
| Carrier Neutral | Parcial | Excelente | Muy bueno | Medio | Bueno |
| Tier III | Si | Si | Si | Parcial | Variable |
| Soporte local Peru | Bajo | Alto | Muy alto | Alto | Alto |
| Soporte 24x7 | Si | Si | Si | Si | Si |
| Resiliencia WAN | Muy alta | Muy alta | Muy alta | Alta | Alta |
| Costos predecibles | No | Si | Si | Si | Si |
| Cobro por egress | Si | No | No | No | No |
| Escalabilidad | Excelente | Alta | Alta | Media | Media |
| DR local Peru | No | Si | Si | Si | Si |
| Adecuado mineria critica | Medio | Excelente | Excelente | Bueno | Bueno |
| Operacion GPRS rural | Regular | Excelente | Excelente | Buena | Buena |
| SLA empresarial | Excelente | Excelente | Excelente | Bueno | Bueno |
| Certificaciones | Excelente | Excelente | Excelente | Media | Media |
| Madurez enterprise | Excelente | Excelente | Excelente | Media | Media |
| Recomendacion final | Secundario | Principal | Principal | Backup | Backup |

### 7.1 Lectura ejecutiva de la comparativa

La tabla confirma una conclusion importante para TI: **AWS Sao Paulo mantiene fortalezas globales y buena resiliencia, pero no ofrece la misma ventaja para latencia peruana, predictibilidad de costos ni disaster recovery local en Peru**. En contraste, **Cirion Lima y GTD Peru** aparecen como las alternativas con mejor equilibrio entre madurez enterprise, respuesta para telemetria e IoT, soporte local, continuidad y adecuacion para mineria critica.

Desde una mirada arquitectonica senior, WIN y Optical pueden cumplir un rol complementario como opciones de respaldo o backup comercial, pero no muestran el mismo peso relativo que Cirion y GTD para sostener la capa principal de una plataforma nacional de telemetria minera 24x7.

## 8. Decision sugerida

Se sugiere autorizar un **RFQ formal** a Cirion, GTD, Claro y WIN, manteniendo a Equinix como alternativa premium adicional. Sin embargo, la arquitectura objetivo recomendada para evaluacion comparativa y negociacion debe tomarse sobre la base **Cirion como primario y GTD como secundario**.

## 9. Cierre

Desde la perspectiva de arquitectura TI para industria minera en LATAM, esta recomendacion ofrece el mejor equilibrio entre control, resiliencia, madurez de infraestructura, soporte local y alineamiento con la criticidad operativa del proyecto AURIXA. La tabla comparativa incorporada refuerza que la decision correcta no es solo elegir un proveedor, sino definir una arquitectura principal y secundaria coherente con la realidad operacional del Peru.
