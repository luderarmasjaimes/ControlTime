# MEMO EJECUTIVO PARA GERENCIA GENERAL

## Decision recomendada sobre infraestructura objetivo para AURIXA

**Fecha**: 14 de mayo de 2026  
**Dirigido a**: Gerencia General  
**Preparado por**: Arquitectura TI Senior LATAM

## 1. Decision que se recomienda

Se recomienda autorizar la salida a cotizacion formal de una infraestructura empresarial en Lima para la plataforma AURIXA, bajo un modelo de **nube privada empresarial o virtualizacion dedicada**, descartando la figura de VPS comercial generico para una operacion minera critica 24x7.

Como arquitectura base de evaluacion, se recomienda trabajar sobre la siguiente combinacion:

1. **Sitio primario: Cirion LIM1**
2. **Sitio secundario: GTD Lurin**

## 2. Por que esta decision es la correcta

La plataforma AURIXA soporta una operacion distribuida en costa, sierra y selva del Peru, con componente de telemetria y necesidad de continuidad operativa. En ese contexto, la infraestructura no debe evaluarse solo por precio unitario de hosting, sino por capacidad de garantizar:

1. Continuidad del servicio.
2. Recuperacion rapida ante falla.
3. Control local de informacion y operacion.
4. Soporte empresarial real.
5. Baja latencia nacional y mejor respuesta hacia campo.

## 3. Beneficio para la compania

Adoptar una arquitectura primario-secundario en Lima entrega tres beneficios directos a la compania:

1. **Menor riesgo operativo** al evitar dependencia de un unico entorno.
2. **Mayor control ejecutivo** sobre una plataforma critica para la operacion minera.
3. **Mejor visibilidad de costo y continuidad** al evaluar una infraestructura diseñada para cargas empresariales reales.

## 4. Lo que no se recomienda

No se recomienda contratar un VPS comercial basico o una solucion sin sitio secundario, porque eso mantendria exposicion innecesaria a caidas, menor control sobre recursos y menor capacidad contractual de respuesta ante incidentes criticos.

## 5. Siguiente paso sugerido

Se recomienda autorizar un **RFQ formal** con al menos cuatro proveedores: Cirion, GTD, Claro y WIN, manteniendo a Equinix como opcion premium adicional. El objetivo es comparar propuestas sobre una misma arquitectura de referencia y seleccionar la mejor combinacion entre continuidad, soporte, conectividad y costo.

## 6. Cierre ejecutivo

Desde una perspectiva de negocio, la recomendacion es avanzar con esta evaluacion porque permite transformar la necesidad de infraestructura en una decision controlada, con mejor proteccion para la operacion, menor riesgo de interrupcion y mayor capacidad de gestion para la compania.
