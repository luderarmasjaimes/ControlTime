# ADR-171 — Página pública de BEEMETRY: alcance de marketing/promoción y datos 100% ilustrativos

**Status**: implemented (formalizado 2026-09-11 — el código ya existía sin ADR, ver "Contexto")
**Fecha**: 2026-09-11
**Autores**: Luder Armas (formalización retroactiva, con Claude Code)
**Ámbito**: marketing (nuevo — ver "Ámbitos futuros" en README.md)

## Contexto

`frontend/src/components/Home/` (24+ componentes: `HomePage.tsx`, secciones de
producto, roadmap público, un dashboard "en vivo" simulado, un modal de
reconocimiento facial simulado, testimonios) llegó al repositorio como parte
de una entrega de otra máquina/desarrollador, sin ADR propio — una auditoría
de conformidad contra el registro de ADRs (2026-09-11) lo encontró como la
única pieza de superficie pública nueva sin documentar, y con tres problemas
de contenido que ameritaban corrección antes de considerarlo listo para
publicarse:

1. `MiningUnitsSection.tsx` atribuía citas textuales inventadas, con nombre y
   cargo también inventados, a **empresas mineras reales** (Alpayana, Cerro
   Verde, Antamina) — sin ningún aviso de que eran ilustrativas. Según la
   propia actualización de ADR-134, ningún cliente tiene la plataforma en uso
   todavía: esas citas nunca fueron dichas por nadie en esas empresas.
2. `FacialScanModal.tsx` simulaba "RECONOCIMIENTO FACIAL BIOMÉTRICO" con una
   barra de progreso por `setInterval` — sin cámara, sin backend, sin ninguna
   llamada real — mientras el producto SÍ tiene biometría real funcionando
   dentro de la plataforma autenticada (ADR-142 y siguientes). La demo
   pública no avisaba que era una animación.
3. `HomePage.tsx` dejaba el nombre real de un desarrollador del proyecto
   ("Ing. Luder Armas") como dato de prueba dentro del estado demo
   (`userState`), junto con una empresa mineray real ("Alpayana Cía.
   Minera") y un DNI inventado — mezclando una persona real con una empresa
   real en un flujo de demostración pública, sin relación con ninguna de
   las dos.

Este ADR formaliza el **alcance** de la página pública (qué es y qué no es) y
corrige esos tres puntos — sigue la norma de este log: "una decisión
arquitectónica sin ADR no existe" (README.md).

## Decisión

1. **`Home/` es la página principal pública de BEEMETRY, con función de
   promoción/marketing/publicidad** — vive fuera de la autenticación
   (`App.tsx::App`, rama `!session`), y es lo primero que ve cualquier
   visitante antes de iniciar sesión. Su propósito es comunicar el producto
   (secciones de módulos, ventajas, roadmap, cursos) y facilitar el contacto
   comercial (botón de WhatsApp) — no es parte del producto autenticado ni
   sustituye ninguna pantalla de ReportStudioV2/Dashboard.

2. **Todo dato de persona, empresa o resultado mostrado en `Home/` es
   ficticio por diseño**, mientras BEEMETRY siga sin clientes reales en
   producción (ADR-134). Regla dura: ningún nombre de persona real
   (empleado, desarrollador, cliente) ni ninguna razón social de una empresa
   minera que exista realmente puede aparecer en este árbol de componentes,
   ni en testimonios, ni en datos de demostración, ni en el estado de la
   sesión simulada.
   - `MiningUnitsSection.tsx`: las tres unidades mineras de los testimonios
     pasan a ser ficticias ("Unidad Minera Demostración", "Complejo Minero
     Los Andes", "Minera del Sur") y la sección lleva una insignia visible
     "Testimonios ilustrativos — plataforma en desarrollo, sin clientes en
     producción todavía" (clave i18n `mining.testimonialsDisclaimer`, ES/EN/
     FR/PT).
   - `HomePage.tsx`: el `userState` de la demo interactiva pasa a
     `name: 'Ing. Demo Beemetry'`, `company: 'Unidad Minera Demostración'`,
     `dniOrRuc: '00000000'`.
   - `LiveSystemDashboard.tsx` (el panel "en vivo" que se activa al
     completar la demo facial) lleva un aviso permanente en la cabecera:
     "Panel de demostración — plataforma en desarrollo, datos ilustrativos".

3. **Toda simulación de una función real de producto debe declararse como
   simulación, en el propio componente, de forma visible (no solo en un
   comentario de código)**. `FacialScanModal.tsx` ahora lleva una insignia
   "Simulación de demostración — sin cámara ni servidor real" y su copy de
   estado ("Verificando credenciales...", "¡BIOMETRÍA CONFIRMADA!") se
   reescribió para no implicar comunicación real con un servidor
   ("Simulando verificación biométrica...", "Demostración completa...").

4. **No se retira ni se simplifica el roadmap público**
   (`FutureImplementationsSection.tsx`/`roadmapData.ts`): la auditoría de
   origen no encontró ninguna afirmación ahí que contradijera el estado real
   documentado en el registro de ADRs (nada marcado "disponible" que en
   realidad sea `proposed`/`deferred`). Se mantiene sin cambios; queda como
   trabajo futuro si se detecta una divergencia concreta.

## Consecuencias

### Positivas
- Cierra el hallazgo de mayor riesgo reputacional/legal de la auditoría: ya
  no hay una cita fabricada atribuida por nombre a una empresa minera real
  que podría negar haberla dicho.
- La demo biométrica pública deja de poder confundirse con la biometría real
  del producto (que sí es real y sí está documentada, ADR-142/145/146/162).
- Dato de prueba con nombre real de un desarrollador ya no viaja en el
  bundle público del sitio.

### Negativas / Trade-offs
- Los testimonios ilustrativos, aunque ahora con empresas ficticias y
  aviso visible, siguen siendo contenido inventado presentado como ejemplo
  de valor del producto — aceptado como práctica de marketing pre-lanzamiento
  siempre que lleve el aviso; debe reemplazarse por testimonios reales en
  cuanto existan clientes reales dispuestos a darlos (no resuelto por este
  ADR, es una decisión de negocio futura).
- El roadmap público (`FutureImplementationsSection.tsx`) sigue sin ADR
  propio que documente quién aprobó su contenido — queda fuera del alcance
  de este ADR, que se limita a los tres hallazgos de contenido ya
  identificados.

## Alternativas descartadas

### Quitar por completo los testimonios y la demo biométrica
Habría cerrado el riesgo de raíz, pero elimina una pieza real de la
propuesta de valor de marketing (mostrar el producto en acción antes del
login) sin necesidad — el aviso explícito + datos ficticios ya resuelve el
riesgo de atribución falsa sin sacrificar la demo.

### Dejar los nombres de empresas reales solo con un aviso de "ilustrativo"
Se descartó: un aviso pequeño no compensa el peso de ver el nombre de una
empresa minera real y reconocible junto a una cita inventada — el estándar
adoptado es no usar el nombre real en absoluto para este tipo de contenido
fabricado, con el aviso como refuerzo adicional, no como única mitigación.

## Referencias
- `frontend/src/components/Home/HomePage.tsx`
- `frontend/src/components/Home/components/MiningUnitsSection.tsx`
- `frontend/src/components/Home/components/FacialScanModal.tsx`
- `frontend/src/components/Home/components/LiveSystemDashboard.tsx`
- `frontend/src/i18n/I18nProvider.tsx` (`mining.testimonialsDisclaimer`)
- ADR-134 (hallazgo crítico de autoregistro — confirma que ningún cliente usa la plataforma todavía)
- ADR-142, 145, 146, 162 (biometría real del producto, para contraste con la simulación pública)
