# ADR-152 — Número reservado, sin decisión asociada

**Status**: N/A — número retirado, no representa ninguna decisión

**Fecha de cierre del hueco**: 2026-09-11

**Ámbito**: N/A

## Contexto

Mismo hallazgo y mismo tratamiento que ADR-151: la numeración de
`docs/decisions/` salta de ADR-150 a ADR-153. El número **152**, igual que
el 151, nunca tuvo archivo en ningún commit de este repositorio (verificado
con `git log --all`, sin resultados). No hay evidencia de contenido perdido.

## Decisión

Se retira formalmente el número 152 con este archivo mínimo, por el mismo
motivo que ADR-151: renumerar los ADR ya existentes (153 en adelante) para
ocupar el hueco se descarta por el riesgo de romper referencias ya citadas
y pusheadas al repositorio remoto — no se renumera nada ya citado, por
convención de este log.

## Consecuencias

- Junto con ADR-151, cierra el hueco de numeración señalado en la auditoría
  del 2026-09-10.
- Ninguna decisión de arquitectura existente cambia.

## Referencias

- `docs/decisions/README.md` — bloque de auditoría 2026-09-10, hallazgo de
  numeración
- ADR-151 (mismo tratamiento, hueco gemelo)
