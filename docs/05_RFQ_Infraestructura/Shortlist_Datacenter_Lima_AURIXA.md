# SHORTLIST DE DATA CENTER Y VPS EMPRESARIAL EN LIMA - AURIXA

**Cliente**: TIME TELEMETRY S.A.C.  
**RUC**: 20601669316  
**Contacto**: Luder Armas Jaimes - Senior IT Architect  
**Fecha**: 14 de mayo de 2026  
**Objetivo**: Identificar los mejores proveedores en Lima, Peru, para migracion de AWS a una arquitectura VPS empresarial nacional para plataforma minera 24x7.

---

## 1. Criterio de seleccion

Se evaluaron proveedores y sitios de data center en Lima con foco en los siguientes criterios:

1. Presencia real en Lima Metropolitana.
2. Condicion Tier III o equivalente reportada publicamente.
3. Capacidad de operar infraestructura empresarial critica.
4. Opciones de conectividad y continuidad.
5. Posibilidad de alojar una solucion tipo VPS empresarial, nube privada o virtualizacion dedicada.
6. Ajuste al caso de uso minero nacional con operacion 24x7 y sitios en costa, sierra y selva.

## 2. Hallazgo principal

Para esta solucion no conviene pedir un "VPS" en sentido comercial basico. Conviene pedir una de estas dos modalidades:

1. **Nube privada empresarial en Lima** sobre cluster dedicado o recursos reservados.
2. **Infraestructura virtualizada dedicada** sobre hosts enterprise con HA, replicacion y respaldo administrado.

La razon es simple: varios requisitos del proyecto, como vCPU dedicadas, IOPS garantizados, failover real, RTO menor a 5 minutos, firewall administrado, DDoS, snapshots y monitoreo 24x7, se atienden mejor con una arquitectura de private cloud o virtualizacion dedicada que con un VPS compartido tradicional.

## 3. Shortlist recomendado

### 3.1 Cirion LIM1 - Mejor perfil general para carga critica empresarial

**Ubicacion reportada**: Av. Manuel Olguin 395, Lima  
**Fortalezas publicamente visibles**:

1. Data center carrier-neutral.
2. Tier 3 reportado en directorio de mercado.
3. Certificaciones reportadas: ISO 27001 e ISAE 3402.
4. Fuerte posicion regional en conectividad y data center.
5. Plataforma enfocada en infraestructura digital critica para empresas.

**Por que entra al shortlist**:

Cirion tiene mejor ajuste cuando la prioridad es combinar data center, conectividad, carrier neutrality y madurez regional. Para una plataforma minera con telemetria 24x7, es de los candidatos mas solidos para levantar un entorno primario o un entorno de contingencia serio.

**Riesgos o puntos a validar en RFQ**:

1. Si ofrecen VPS empresarial administrado o si la mejor figura sera private cloud/dedicated virtualization.
2. Garantia formal de IOPS, snapshots, anti-DDoS y tiempos de atencion critica.
3. SLA contractual real para HA y failover automatizado.

### 3.2 Equinix LM1 - Mejor perfil premium de ecosistema y neutralidad

**Ubicacion reportada**: Calle Centauro 115, Santiago de Surco, Lima  
**Fortalezas publicamente visibles**:

1. Site Tier III reportado.
2. Carrier-neutral.
3. Certificacion ISO 27001 reportada.
4. Servicio de remote hands.
5. Ecosistema premium de interconexion.

**Por que entra al shortlist**:

Equinix es una opcion muy fuerte si el objetivo es montar infraestructura en una instalacion premium y luego consumir virtualizacion administrada por partner o MSP. Es especialmente fuerte cuando se valora neutralidad, interconexion y ecosistema.

**Riesgos o puntos a validar en RFQ**:

1. Si la propuesta seria directa como servicio o a traves de partner local.
2. Si pueden entregar la capa de VPS empresarial administrado con HA y backups, o si solo el data center base.
3. Costo total comparado con otras opciones regionales.

### 3.3 GTD Lurin - Mejor candidato para sitio secundario o DR serio en Lima sur

**Ubicacion reportada**: Macropolis, Lurin, Lima  
**Fortalezas publicamente visibles**:

1. Tier 3 reportado.
2. Inversion mayor a USD 50 millones reportada.
3. 960 racks y 20 MW de capacidad reportados.
4. Doble sala de acceso de fibra y conectividad redundante reportada.
5. Seguridad 24x7 y sistemas avanzados de deteccion/extincion reportados.

**Por que entra al shortlist**:

GTD Lurin tiene muy buen perfil para continuidad y resiliencia. Por su escala y ubicacion, encaja especialmente bien como segundo sitio para alta disponibilidad o DR, evitando concentrar todo en el mismo microentorno urbano.

**Riesgos o puntos a validar en RFQ**:

1. Oferta exacta de virtualizacion dedicada o private cloud en Peru.
2. SLA real de RTO y automatizacion de failover.
3. Latencia real hacia operadores moviles y zonas mineras con trafico nacional.

### 3.4 Claro Data Center Villa El Salvador - Fuerte opcion si pesa conectividad nacional y entorno telco

**Ubicacion reportada**: Av. El Sol 2246, Villa El Salvador, Lima  
**Fortalezas publicamente visibles**:

1. Tier 3 reportado.
2. Public cloud servers reportados en directorio de mercado.
3. Integracion fuerte con red telco nacional.
4. Potencial ventaja comercial para trafico y conectividad movil nacional.

**Por que entra al shortlist**:

Para una solucion minera con presencia en zonas remotas, GPRS/3G/4G y conectividad variable, Claro puede ser muy competitivo por la combinacion de data center y red nacional. Es un proveedor que vale la pena cotizar si la variable de conectividad hacia campo pesa mucho.

**Riesgos o puntos a validar en RFQ**:

1. Carrier neutrality real del esquema ofrecido.
2. Nivel de customizacion del entorno VPS/virtualizacion.
3. Capacidades de segmentacion, VPN site-to-site, firewall administrado y anti-DDoS dentro del paquete.

### 3.5 WIN Empresas Santa Catalina - Buena opcion local para servicios administrados y DR complementario

**Ubicacion reportada**: Av. Santa Catalina 663, La Victoria, Lima  
**Fortalezas publicamente visibles**:

1. Tier 3 reportado.
2. TIA 942-B reportado.
3. Servicios administrados de backup y disaster recovery reportados.
4. Presencia de sitios de respaldo en Arequipa y Tacna reportada.

**Por que entra al shortlist**:

WIN puede ser una alternativa atractiva si se busca un operador local con servicios administrados, buen discurso de continuidad y flexibilidad comercial. Puede funcionar bien como opcion de contingencia, respaldo o nube privada empresarial.

**Riesgos o puntos a validar en RFQ**:

1. Nivel de madurez del NOC para incidentes criticos 24x7.
2. Carrier neutrality y peering nacional efectivo.
3. Capacidad de garantizar IOPS, HA, anti-DDoS y RTO objetivo.

## 4. Candidatos de segunda linea

### 4.1 TESAM Data Center

Puntos visibles:

1. Carrier-neutral reportado.
2. UPS y generadores redundantes reportados.
3. Servicios de colocation, hosting y cloud reportados.
4. Enfoque local y expansion proyectada.

Lectura ejecutiva:

Es un candidato interesante como proveedor local de menor escala relativa, pero requiere validacion comercial y operativa mas profunda antes de ponerlo al nivel de Cirion, Equinix, GTD o Claro.

### 4.2 InterNexa Lima

Puntos visibles:

1. Tier 3 reportado.
2. Buen perfil por herencia de conectividad regional.

Lectura ejecutiva:

Vale la pena cotizarlo si se busca una combinacion de data center y backbone, aunque la informacion publica util para tu caso es bastante mas limitada que en los candidatos principales.

### 4.3 IPXON Lima

Puntos visibles:

1. Tier 3 reportado.
2. Ofrece dedicated servers y VPS servers segun directorio.

Lectura ejecutiva:

Es util como referencia de mercado para comparar precio y flexibilidad de VPS, pero para operacion minera critica yo lo pondria por debajo de Cirion, Equinix, GTD, Claro y WIN hasta validar soporte, NOC y madurez local.

## 5. Ranking recomendado para TIME TELEMETRY

### Opcion A - Mejor balance enterprise y mineria critica

1. Cirion LIM1
2. GTD Lurin
3. Claro Data Center Villa El Salvador
4. Equinix LM1
5. WIN Empresas

### Opcion B - Si la prioridad es ecosistema premium y neutralidad

1. Equinix LM1
2. Cirion LIM1
3. GTD Lurin
4. WIN Empresas
5. Claro Data Center Villa El Salvador

### Opcion C - Si la prioridad es red nacional y conectividad hacia campo

1. Claro Data Center Villa El Salvador
2. Cirion LIM1
3. GTD Lurin
4. WIN Empresas
5. InterNexa Lima

## 6. Recomendacion de arquitectura de compra

Para la solucion minera AURIXA, la recomendacion no es comprar un unico VPS aislado. La compra deberia plantearse asi:

1. **Sitio primario en Lima metropolitana** con virtualizacion dedicada enterprise.
2. **Sitio secundario en otro punto de Lima** para failover o DR.
3. **Replicacion continua** de base de datos y snapshots programados.
4. **VPN site-to-site** con segmentacion por VLAN y firewall administrado.
5. **Backups externos** fuera del host primario.

### Combinaciones sugeridas

1. **Primario Cirion + Secundario GTD Lurin**: muy buen balance entre madurez, neutralidad y separacion geografica dentro de Lima.
2. **Primario Claro VES + Secundario Cirion**: buena opcion si el peso de conectividad nacional y trafico movil es decisivo.
3. **Primario Equinix + Secundario GTD**: opcion premium si la capa de servicios se arma con partner o MSP especializado.

## 7. Ajuste frente a tus requisitos minimos

### Requisitos que varios proveedores pueden cumplir, pero deben cotizarse formalmente

1. 16 a 24 vCPU dedicados.
2. 64 a 128 GB RAM ECC.
3. NVMe enterprise RAID1.
4. 20k IOPS garantizados.
5. Puerto dedicado de 1 Gbps.
6. Firewall administrado.
7. Snapshots automaticos.
8. Monitoreo 24x7.
9. SLA de 99.95% o superior.
10. Replicacion real y failover automatizado.

### Requisitos que no deben asumirse sin RFQ escrito

1. Transferencia ilimitada real sin letra chica.
2. Tiempo de respuesta menor a 15 minutos para severidad critica.
3. RTO menor a 5 minutos contractual.
4. Anti-DDoS administrado incluido sin costo adicional relevante.
5. IDS/IPS opcional con costo razonable.
6. Recuperacion granular incluida en el esquema base.

## 8. Recomendacion comercial inmediata

Si el objetivo es avanzar rapido, yo recomendaria solicitar RFQ formal a estos cuatro primero:

1. Cirion
2. GTD
3. Claro Empresas
4. WIN Empresas

Y mantener a Equinix como quinta conversacion orientada a colocation premium o a una solucion armada con partner.

## 9. Texto sugerido para el RFQ

Asunto sugerido: **Solicitud de propuesta - VPS empresarial / nube privada en Lima para plataforma minera critica 24x7**

Resumen sugerido:

"TIME TELEMETRY S.A.C., empresa peruana dedicada a soluciones tecnologicas para mineria, se encuentra evaluando la migracion de una plataforma nacional de telemetria minera 24x7 desde AWS hacia infraestructura empresarial en Lima, Peru. Requerimos una propuesta tecnica y economica para un esquema de VPS empresarial, nube privada o virtualizacion dedicada con alta disponibilidad, failover y monitoreo administrado, alineado a los requerimientos adjuntos."

## 10. Preguntas obligatorias para cada proveedor

1. Que modalidad recomiendan para este caso: VPS enterprise, private cloud o virtualizacion dedicada.
2. Si pueden garantizar vCPU dedicadas y IOPS minimos por contrato.
3. Si el firewall administrado y anti-DDoS estan incluidos o son adicionales.
4. Si el failover es automatizado o manual asistido.
5. Cual es el RTO y RPO comprometible por contrato.
6. Cual es el tiempo de respuesta para severidad critica.
7. Si tienen NOC local o regional 24x7.
8. Si soportan VPN site-to-site, VLAN, backups externos y recuperacion granular.
9. Si cuentan con referencias de cargas criticas industriales o mineras en Peru.
10. Si pueden ofrecer prueba de concepto o piloto corto.

## 11. Conclusiones ejecutivas

1. **Cirion y GTD** son los candidatos mas fuertes para un esquema enterprise serio con continuidad y madurez de infraestructura.
2. **Claro** merece RFQ si la conectividad nacional y la capilaridad telco pesan mucho en tu caso minero.
3. **Equinix** es muy fuerte como facility premium, pero podria encajar mejor via partner o MSP para entregar la capa completa de servicio.
4. **WIN** es una buena alternativa local para comparar flexibilidad comercial y servicios administrados.
5. Para esta carga critica, la compra debe pedirse como **private cloud empresarial o virtualizacion dedicada con HA**, no como VPS compartido convencional.

## 12. Fuentes consultadas

1. Cirion Technologies - portal corporativo de infraestructura digital y data center.
2. DataCenterMap - mercado de Lima, Peru.
3. DataCenterMap - fichas de Cirion LIM1, Equinix LM1, GTD Lurin, Claro Villa El Salvador, WIN Santa Catalina, TESAM, InterNexa e IPXON.
