# MATRIZ COMPARATIVA - DATA CENTER LIMA PARA AURIXA

**Objetivo**: Comparar los principales proveedores candidatos contra los requerimientos de la plataforma minera AURIXA.  
**Lectura**: `Alto` = fuerte ajuste probable, `Medio` = ajuste posible con validacion comercial, `Bajo` = ajuste incierto o menos favorable para el caso.

| Criterio | Cirion LIM1 | GTD Lurin | Claro VES | Equinix LM1 | WIN Empresas |
|---|---|---|---|---|---|
| Presencia real en Lima | Alto | Alto | Alto | Alto | Alto |
| Tier III reportado | Alto | Alto | Alto | Alto | Alto |
| Carrier neutral | Alto | Medio | Medio | Alto | Medio |
| Madurez enterprise regional | Alto | Alto | Alto | Alto | Medio |
| Ajuste para private cloud / virtualizacion dedicada | Alto | Alto | Medio | Medio | Medio |
| Ajuste para carga critica 24x7 | Alto | Alto | Alto | Alto | Medio |
| Conectividad nacional | Alto | Medio | Alto | Medio | Medio |
| Soporte a continuidad y DR | Alto | Alto | Medio | Medio | Alto |
| Potencial para sitio primario | Alto | Medio | Alto | Medio | Medio |
| Potencial para sitio secundario | Alto | Alto | Medio | Medio | Alto |
| Ajuste comercial para mineria Peru | Alto | Alto | Alto | Medio | Medio |
| Riesgo de depender de partner externo | Bajo | Bajo | Bajo | Alto | Bajo |

## Lectura ejecutiva por proveedor

### Cirion LIM1

1. Mejor balance entre data center, conectividad, carrier neutrality y perfil enterprise.
2. Fuerte candidato para sitio primario.
3. Tambien puede funcionar como secundario si se combina con otro operador en Lurin o Lima sur.

### GTD Lurin

1. Muy fuerte para continuidad, redundancia y DR.
2. Candidato natural para sitio secundario o esquema activo-pasivo serio.
3. Debe validarse si la capa de virtualizacion dedicada en Peru cubre exactamente el modelo requerido.

### Claro Villa El Salvador

1. Buen candidato cuando la prioridad es conectividad nacional y capilaridad telco.
2. Muy interesante si la plataforma depende mucho de trafico movil y zonas remotas.
3. Debe validarse flexibilidad de arquitectura y neutralidad.

### Equinix LM1

1. Facility premium con muy buen ecosistema.
2. Excelente opcion si se arma una solucion con MSP o partner que entregue la capa administrada.
3. Menos directo si lo que se busca es un servicio llave en mano puramente local.

### WIN Empresas

1. Alternativa local razonable para comparar flexibilidad, backup y DR.
2. Puede ser valioso como sitio secundario o propuesta administrada.
3. Debe validarse capacidad contractual en IOPS, RTO, DDoS y tiempos de respuesta criticos.

## Ranking recomendado para comite

### Ranking general

1. Cirion LIM1
2. GTD Lurin
3. Claro Villa El Salvador
4. Equinix LM1
5. WIN Empresas

### Ranking para arquitectura recomendada

1. Primario: Cirion LIM1
2. Secundario: GTD Lurin
3. Alternativa conectividad nacional: Claro Villa El Salvador
4. Alternativa premium con partner: Equinix LM1
5. Alternativa local administrada: WIN Empresas

## Decision sugerida de comite

1. Autorizar RFQ formal a Cirion, GTD, Claro y WIN.
2. Mantener conversacion adicional con Equinix para opcion premium o via partner.
3. Solicitar a todos propuesta bajo modalidad `private cloud empresarial` o `virtualizacion dedicada`, no solo VPS comercial generico.
