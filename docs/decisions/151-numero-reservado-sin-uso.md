# ADR-151 — Número reservado, sin decisión asociada

**Status**: N/A — número retirado, no representa ninguna decisión

**Fecha de cierre del hueco**: 2026-09-11

**Ámbito**: N/A

## Contexto

La auditoría del 2026-09-10 sobre `docs/decisions/` encontró que la
numeración salta de ADR-150 a ADR-153 — los números **151** y **152** nunca
tuvieron archivo, en ningún commit de este repositorio (verificado con
`git log --all` sobre ambos nombres de archivo, sin resultados). No hay
evidencia de que haya existido nunca una decisión redactada bajo estos
números ni de que se haya perdido contenido — es un salto de numeración,
no un archivo borrado.

## Decisión

Este proyecto numera sus ADR de forma correlativa y sin huecos (ver
`docs/decisions/README.md`, sección "Convención"). Renumerar los ADR-153 a
168 ya existentes para "correr" la numeración y ocupar este hueco se
descartó por el riesgo que implica: esos números ya están citados en
decenas de lugares — otros ADR, `specs/REGISTRY.md`, mensajes de commit ya
pusheados a `origin/2026-08-21`, y este mismo log — y el propio README
establece como principio no renumerar nada ya citado.

En su lugar, **se retira formalmente el número 151** con este archivo
mínimo: deja constancia explícita de que el hueco fue encontrado,
investigado (no hay contenido perdido) y cerrado a propósito, en vez de
dejarlo como una ambigüedad sin explicación para quien audite el log en el
futuro.

## Consecuencias

- La numeración de `docs/decisions/` queda sin huecos reales de nuevo
  (000–168 con archivo, incluidos 151 y 152 como "reservado, sin uso").
- Ninguna decisión de arquitectura existente cambia — este archivo no
  sustituye ni reabre ningún ADR.

## Referencias

- `docs/decisions/README.md` — bloque de auditoría 2026-09-10, hallazgo de
  numeración
- ADR-152 (mismo tratamiento, hueco gemelo)
