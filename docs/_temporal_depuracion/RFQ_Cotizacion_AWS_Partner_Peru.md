<![CDATA[
---

# SOLICITUD DE COTIZACIÓN (RFQ)

## Servicios de Infraestructura Cloud AWS  
## Plataforma de Monitoreo y Gestión Documental para Operaciones Mineras

---

**Documento**: RFQ-AURIXA-AWS-2026-001  
**Fecha**: ____________________  
**Clasificación**: Confidencial  
**Válido hasta**: 30 días calendario desde la fecha de emisión  

---

**EMPRESA SOLICITANTE:**  
Razón Social: BEEMETRY S.A.C.  
RUC: ____________________  
Dirección: ____________________  
Ciudad: Lima, Perú  
Contacto Técnico: ____________________  
Cargo: Arquitecto TI Senior / CTO  
Correo: ____________________  
Teléfono: ____________________  

---

**DIRIGIDO A:**  
AWS Authorized Partner — Perú  
Área: Ventas Cloud / Consultoría IoT Industrial  

---

## 1. OBJETO DE LA SOLICITUD

BEEMETRY S.A.C. solicita cotización formal por la provisión de **servicios de infraestructura cloud Amazon Web Services (AWS)** para el proyecto **"Plataforma Integral de Monitoreo y Gestión Documental para Operaciones Mineras" (Proyecto AURIXA)**.

El proyecto contempla una plataforma de telemetría industrial de alto rendimiento con las siguientes características:

- **10,000 sensores industriales** transmitiendo cada 60 segundos (24×7×365)
- **Monitoreo en tiempo real** con latencia <200ms
- **Retención de datos** por 4 años (normativa legal y compliance minero)
- **Cobertura geográfica**: Minas en la costa y sierra del Perú, con oficinas en Lima
- **Arquitectura dual-database**: QuestDB (tiempo real) + TimescaleDB (histórico)
- **Dual-stream processing**: Kinesis (alarmas críticas) + Kafka/MSK (procesamiento C++)
- **IA embebida**: Biometría facial, detección de EPP (cascos/chalecos), anomalías
- **Duración del contrato AWS**: Mínimo 12 meses, con proyección a 48 meses

---

## 2. REGIÓN AWS REQUERIDA

| Tipo | Región | Justificación |
|------|--------|--------------|
| **Principal (Producción)** | **sa-east-1 (São Paulo, Brasil)** | Región más cercana a Perú (~50ms latencia desde Lima) |
| **DR / Read Replica** | us-east-1 (Virginia, USA) | Disaster Recovery geográfico, Read Replica cross-region |

---

## 3. DETALLE DE SERVICIOS REQUERIDOS

### 3.1 Compute — Amazon EC2

| # | Instancia | Tipo | Cantidad | Uso | SO |
|---|----------|------|----------|-----|-----|
| 1 | Motor Backend C++ (WebSocket, alarmas) | c6i.2xlarge (8 vCPU, 16 GB) | 2 | 24×7 | Amazon Linux 2023 |
| 2 | QuestDB (base de datos tiempo real) | i4i.2xlarge (8 vCPU, 64 GB, NVMe) | 1 | 24×7 | Amazon Linux 2023 |
| 3 | Python ML/IA (biometría, OpenCV, anomalías) | g5.xlarge (4 vCPU, 16 GB, GPU A10G) | 1 | 24×7 | Amazon Linux 2023 |
| 4 | Frontend + API Gateway | t3.large (2 vCPU, 8 GB) | 2 | 24×7 | Amazon Linux 2023 |
| 5 | ETL Worker | t3.medium (2 vCPU, 4 GB) | 1 | 24×7 | Amazon Linux 2023 |
| 6 | Bastion Host (acceso seguro) | t3.micro (2 vCPU, 1 GB) | 1 | 24×7 | Amazon Linux 2023 |

**Solicitar cotización en modalidades:**
- On-Demand (referencia)
- Compute Savings Plan 1 año (pago parcial)
- Compute Savings Plan 3 años (pago parcial)

### 3.2 Storage — Amazon EBS

| # | Asociado a | Tipo EBS | Capacidad | IOPS |
|---|-----------|---------|-----------|------|
| 1 | Motor C++ (×2) | gp3 | 100 GB c/u | 3,000 |
| 2 | QuestDB | io2 Block Express | 500 GB | 10,000 |
| 3 | Python ML | gp3 | 200 GB | 3,000 |
| 4 | Frontend (×2) | gp3 | 50 GB c/u | 3,000 |
| 5 | ETL Worker | gp3 | 50 GB | 3,000 |

### 3.3 Base de Datos — Amazon RDS for PostgreSQL

| # | Configuración | Detalle |
|---|--------------|---------|
| 1 | **Producción** | db.r6g.2xlarge, PostgreSQL 16, **Multi-AZ**, 500 GB gp3 |
| 2 | **DR Cross-Region** | db.r6g.large, PostgreSQL 16, Single-AZ, Read Replica en us-east-1 |
| 3 | Backup automático | Retención 35 días, PITR habilitado |
| 4 | Extensiones | TimescaleDB, PostGIS, pg_stat_statements |

**Solicitar cotización en modalidades:**
- On-Demand (referencia)
- Reserved Instance 1 año (pago parcial)
- Reserved Instance 3 años (pago parcial)

### 3.4 Streaming — Amazon MSK Serverless (Apache Kafka)

| Parámetro | Valor |
|-----------|-------|
| Tipo | MSK Serverless |
| Particiones | 120 |
| Retención | 7 días |
| Throughput entrada | ~216 GB/mes (~8.3 KB/s sostenido) |
| Throughput salida | ~432 GB/mes (2 consumer groups) |
| Región | sa-east-1 |

### 3.5 Streaming — Amazon Kinesis Data Streams

| Parámetro | Valor |
|-----------|-------|
| Modo capacidad | On-Demand |
| Shards estimados | 8 |
| Retención | 7 días (Extended) |
| Enhanced Fan-Out consumers | 2 |
| Throughput | ~167 registros/segundo |

### 3.6 Amazon Kinesis Data Firehose

| Parámetro | Valor |
|-----------|-------|
| Origen | Kinesis Data Streams |
| Destino | Amazon S3 |
| Formato conversión | Parquet (Apache Parquet) |
| Dynamic Partitioning | Sí (por sensor_type, date) |
| Volumen | ~216 GB/mes |

### 3.7 AWS IoT Core

| Parámetro | Valor |
|-----------|-------|
| Dispositivos conectados | 10,000 |
| Protocolo | MQTT v3.1.1 / MQTT v5 |
| Conexión | 24×7 (siempre conectados) |
| Mensajes/mes | ~432,000,000 (432M) |
| Tamaño promedio mensaje | ~500 bytes |
| Rules Engine | Activo (routing a Kinesis + MSK) |
| Device Shadow | Activo (10,000 shadows) |
| Device Registry | Activo (10,000 devices) |
| Autenticación | Certificados X.509 |

### 3.8 Amazon S3 — Almacenamiento Tiered (4 años)

| Clase de almacenamiento | Datos estimados | Lifecycle |
|------------------------|-----------------|-----------|
| S3 Standard | ~650 GB (0-90 días) | Automático |
| S3 Standard-IA | ~1.6 TB (90 días - 1 año) | Transición automática 90 días |
| S3 Glacier Instant Retrieval | ~2.6 TB (1-2 años) | Transición automática 365 días |
| S3 Glacier Deep Archive | ~5.2 TB (2-4 años) | Transición automática 730 días |
| S3 Cross-Region Replication | 216 GB/mes a us-east-1 | Continuo |
| S3 Object Lock | Habilitado (compliance mode) | Retención legal |

**Formatos almacenados**: Apache Parquet (telemetría), JSON (metadata), binarios (documentos .miningreport)

### 3.9 Amazon Athena + AWS Glue

| Servicio | Configuración |
|---------|--------------|
| Athena | ~100 queries/mes, ~10 GB scan promedio por query |
| Glue Data Catalog | 10 tablas, ~100 particiones |
| Glue Crawler | 1 crawler diario, ~5 min ejecución |

### 3.10 Networking

| # | Servicio | Configuración |
|---|---------|--------------|
| 1 | **VPN Site-to-Site #1** | Lima (oficinas) → sa-east-1 |
| 2 | **VPN Site-to-Site #2** | Mina Costa → sa-east-1 |
| 3 | **VPN Site-to-Site #3** | Mina Sierra → sa-east-1 |
| 4 | **NAT Gateway** | 1 unidad en sa-east-1, ~500 GB/mes procesado |
| 5 | **Application Load Balancer (ALB)** | 1 ALB, ~20 LCU promedio |
| 6 | **Route 53** | 1 hosted zone, ~10M queries/mes, latency-based routing |
| 7 | **CloudFront** | 1 distribución, ~100 GB transfer/mes, Origin: ALB |
| 8 | **Elastic IPs** | 3 IPs estáticas (todas en uso) |
| 9 | **Data Transfer OUT** | ~200 GB/mes a internet |
| 10 | **Data Transfer Inter-AZ** | ~500 GB/mes |
| 11 | **Data Transfer Cross-Region** | ~216 GB/mes (sa-east-1 → us-east-1) |

### 3.11 Seguridad

| # | Servicio | Configuración |
|---|---------|--------------|
| 1 | **AWS KMS** | 5 Customer Managed Keys, rotación automática, ~1M API calls/mes |
| 2 | **AWS WAF** | 1 Web ACL, 10 reglas, ~10M requests/mes |
| 3 | **AWS Certificate Manager** | Certificados SSL/TLS públicos (gratuitos) |
| 4 | **AWS Secrets Manager** | 10 secrets con rotación |
| 5 | **Amazon GuardDuty** | Habilitado en sa-east-1 |
| 6 | **AWS CloudTrail** | 1 trail, data events S3 habilitados |

### 3.12 Monitoreo y Observabilidad

| # | Servicio | Configuración |
|---|---------|--------------|
| 1 | **Amazon Managed Grafana** | 1 workspace, 3 editors, 5 viewers |
| 2 | **Amazon CloudWatch** | 50 custom metrics, 50 GB logs/mes, 30 alarmas, 3 dashboards |
| 3 | **AWS X-Ray** | ~1M traces/mes |

### 3.13 CI/CD

| # | Servicio | Configuración |
|---|---------|--------------|
| 1 | **AWS CodePipeline** | 2 pipelines activos |
| 2 | **AWS CodeBuild** | 100 builds/mes, 5 min promedio, general1.large |
| 3 | **Amazon ECR** | 10 repositorios, ~20 GB storage |

### 3.14 Serverless y Mensajería

| # | Servicio | Configuración |
|---|---------|--------------|
| 1 | **AWS Lambda** | ~432M invocaciones/mes, 200ms promedio, 256 MB memoria |
| 2 | **Amazon SNS** | ~100K notificaciones/mes (alarmas) |
| 3 | **Amazon SES** | ~10K emails/mes (reportes, alertas) |
| 4 | **Amazon SQS** | ~10M mensajes/mes (dead letter queues) |

### 3.15 Soporte

| Plan | Justificación |
|------|--------------|
| **AWS Business Support** | Sistema productivo 24×7 en minería. Requiere respuesta <1 hora para casos críticos y acceso a Trusted Advisor completo. |

---

## 4. FORMATO DE COTIZACIÓN SOLICITADO

Solicitamos que la cotización incluya:

| # | Requerimiento |
|---|--------------|
| 1 | Desglose mensual por servicio AWS en USD |
| 2 | **Tres escenarios**: On-Demand / Savings Plan 1 año / Savings Plan 3 años |
| 3 | Costo de implementación/consultoría del Partner (si aplica) |
| 4 | Proyección de costos a **12, 24 y 48 meses** |
| 5 | Descuentos aplicables por volumen o programas especiales |
| 6 | Disponibilidad de **créditos AWS** promocionales o de migración |
| 7 | Costo de un **TAM (Technical Account Manager)** si está disponible |
| 8 | Información sobre **Enterprise Discount Program (EDP)** si aplica |
| 9 | Forma de pago: mensual vs anual anticipado |
| 10 | Moneda de facturación: USD |

---

## 5. CRONOGRAMA DEL PROYECTO

| Fase | Período | Necesidad de Infraestructura |
|------|---------|------------------------------|
| **Desarrollo (Etapa 1)** | Meses 1-4 | Infraestructura reducida (dev/staging) |
| **Hardening (Etapa 2)** | Meses 5-6 | Infraestructura completa (producción) |
| **Go-Live** | Mes 7 | Producción con Savings Plans activos |
| **Operación continua** | Mes 7-48 | Producción estable, crecimiento gradual |

**Fecha estimada de inicio**: ____________________  
**Necesidad de cuenta AWS activa**: 30 días antes del inicio  

---

## 6. PREGUNTAS ESPECÍFICAS PARA EL PARTNER

1. ¿Cuentan con experiencia en proyectos **IoT industrial en minería** en Perú?
2. ¿Tienen la **AWS IoT Competency** o alguna competencia relevante certificada?
3. ¿Pueden proveer soporte técnico **en español** desde Perú?
4. ¿Ofrecen servicios de **arquitectura y revisión** (Well-Architected Review)?
5. ¿Cuál es el tiempo de respuesta para activación de la cuenta y los servicios?
6. ¿Pueden gestionar una **llamada técnica con AWS Solutions Architects** para validar la arquitectura?
7. ¿Tienen experiencia con **VPN Site-to-Site** en zonas mineras remotas del Perú (sierra >4,000 msnm)?
8. ¿Ofrecen **capacitación AWS** para el equipo técnico del cliente?
9. ¿Pueden apoyar con la **optimización de costos** post-implementación (Cost Optimization Review)?
10. ¿Cuáles son las condiciones de **SLA del Partner** para soporte local?

---

## 7. CRITERIOS DE EVALUACIÓN DEL PARTNER

| Criterio | Peso |
|----------|------|
| Precio competitivo (3 escenarios) | 30% |
| Experiencia en IoT/minería en Perú | 25% |
| Certificaciones y competencias AWS | 15% |
| Soporte local en español | 15% |
| Capacidad de consultoría arquitectónica | 10% |
| Créditos o beneficios adicionales | 5% |

---

## 8. PLAZO DE RESPUESTA

Solicitamos que la cotización sea entregada dentro de los **15 días hábiles** posteriores a la recepción de este documento.

La cotización debe ser enviada a:  
**Correo**: ____________________  
**Atención**: ____________________  
**Referencia**: RFQ-AURIXA-AWS-2026-001  

---

## 9. CONFIDENCIALIDAD

La información contenida en este documento es de carácter **CONFIDENCIAL**. El Partner se compromete a no divulgar, compartir ni utilizar la información técnica y comercial aquí descrita para fines distintos a la elaboración de la cotización solicitada.

---

## 10. ANEXOS DISPONIBLES BAJO SOLICITUD

| Anexo | Descripción |
|-------|-------------|
| A | SOW del proyecto (Statement of Work) — Alcance completo |
| B | Arquitectura técnica detallada (diagramas C4, flujo de datos) |
| C | Análisis de volumetría de datos (10K sensores, 4 años) |
| D | Requisitos de seguridad y compliance |

---

**Firma del Solicitante:**

Nombre: ____________________  
Cargo: ____________________  
Empresa: BEEMETRY S.A.C.  
Fecha: ____________________  
Firma: ____________________  

---

*Documento generado como parte del proceso de adquisición del proyecto AURIXA.*  
*Ref: SOW-AURIXA-2026-001 / RFQ-AURIXA-AWS-2026-001*
]]>
