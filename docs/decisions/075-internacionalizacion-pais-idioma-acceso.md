# ADR-075 — País e idioma determinan la interfaz de acceso

**Status**: implemented, probado y desplegado localmente (2026-07-27)
**Fecha**: 2026-07-27
**Autores**: EC
**Ámbito**: plataforma
**Relación**: refina ADR-035/040/042/066/067/073; respeta ADR-001/025/029/074.

> Estado de despliegue auditado: frontend/backend recompilados y activados;
> contenedores saludables, Vitest 25/25 y smoke de autenticación completo.

## Contexto

Las pantallas de login y registro de persona/empresa tenían textos, ayudas y
errores embebidos en español. Ya existían preferencias de país/idioma y
endpoints de catálogo, pero el selector no se renderizaba y el cambio de país
no cambiaba el idioma. Además, el alta de empresa validaba siempre un RUC
peruano de 11 dígitos, por lo que Brasil, Canadá y Estados Unidos quedaban
operativamente bloqueados aunque figuraran en el catálogo.

El público incluye operadores mineros con poca experiencia en software. La
selección inicial debe ser evidente, persistente, de baja altura y no puede
depender de que la base de datos esté disponible para mostrar sus opciones
críticas.

## Decisión

1. La primera pantalla muestra un selector compacto de **País** y **Idioma**.
   Elegir país selecciona el idioma predeterminado:
   `PE→es-PE`, `BR→pt-BR`, `CA→fr-CA`, `US→en-US`. El idioma sigue siendo
   editable para casos bilingües.
2. La preferencia no sensible se persiste en `localStorage`; actualiza
   inmediatamente el contexto React y `<html lang>`. No contiene identidad,
   token, biometría ni datos de empresa.
3. Existe un diccionario tipado central para español, inglés, francés y
   portugués de Brasil. Login y registro de persona/empresa traducen títulos,
   subtítulos, pestañas, campos, placeholders, botones, estados de cámara,
   controles ICAO, roles, tooltips, errores y mensajes de éxito. El shell
   principal traduce categorías, módulos y acciones de cabecera.
4. Los nombres de países se obtienen con `Intl.DisplayNames` en el idioma
   activo; el catálogo del backend sigue aportando ISO, región, prefijo y
   locale. Hay fallback local de países/idiomas para que la pantalla de acceso
   siga utilizable si el backend o PostgreSQL aún no responde.
5. El prefijo telefónico visible sigue al país y teléfono/celular se normalizan
   a E.164 al enviar. Un valor ya escrito con `+` no recibe un segundo prefijo.
6. La validación fiscal es por país: RUC/SUNAT de 11 dígitos para Perú, CNPJ
   con sus dos dígitos verificadores para Brasil y número de 9 dígitos para
   Canadá/Estados Unidos. El texto dice “válido para el país”; no afirma una
   autorización tributaria o contractual que el sistema no consulta.
7. Se elimina el `window.alert()` del registro facial. Éxitos y errores se
   presentan dentro del panel, con `role="alert"` donde corresponde, coherente
   con ADR-073.
8. Tenant switcher, auditoría, avatar, mantenimiento y confirmaciones/avisos
   del editor usan el mismo diccionario. Los diálogos nativos se sustituyen por
   componentes accesibles, traducidos y automatizables.
9. Las claves internas de rutas, roles y módulos no se traducen. Solo cambia la
   presentación; API, RBAC y almacenamiento conservan identificadores estables.

## Compatibilidad y conflictos revisados

- **ADR-035**: extiende el alcance LATAM sin cambiar la topología edge/hub ni
  la soberanía por país.
- **ADR-040/042**: conserva los dos carriles, nombres cortos e identificadores
  internos; añade traducción a etiquetas/tooltips y mantiene la altura
  predecible.
- **ADR-001/025/074**: no envía datos a nube ni activa cámara por elegir país.
  Biometría, avatar y su gate legal permanecen sin cambios.
- **ADR-029**: idioma/país son preferencias públicas; los tokens continúan en
  el mecanismo seguro vigente y no se copian a esta preferencia.
- **ADR-066**: la empresa minera seleccionada continúa definiendo
  login/tenant. El documento fiscal del contratista no sustituye `company`.
  Se cierra la ambigüedad visual del hallazgo pendiente: la validación es
  estructural por país, no una certificación de pertenencia a la minera.
- **ADR-067**: no cambia el provisionamiento del tenant real ni reintroduce el
  fallback compartido.
- **ADR-073**: refuerza la prohibición práctica de diálogos nativos disruptivos
  en estos flujos.
- **ADR-076/077**: el smoke de esta decisión descubrió problemas transversales
  de ID/credenciales. No pertenecen a i18n y quedan formalizados por separado,
  sin inflar el estado de esta decisión.

No se encontró una decisión anterior que obligue a español único o a RUC
peruano para todos los países.

## Consecuencias

### Positivas

- Las cuatro pantallas de acceso mantienen el mismo orden y cambian de idioma
  sin recarga ni pérdida de datos del formulario.
- Un operador ve instrucciones cortas, botones grandes y mensajes accionables.
- Brasil ya no queda bloqueado por la longitud del RUC peruano.
- Catálogo y login degradan de forma segura cuando el backend no está listo.
- Lectores de pantalla, correctores y entrada de voz reciben el locale correcto.

### Riesgos y controles

- Canadá puede requerir variantes de Business Number y EE. UU. reglas de EIN
  más estrictas: la validación actual confirma estructura, no vigencia fiscal.
  Una integración con registros tributarios requerirá un ADR independiente,
  credenciales y análisis de privacidad.
- Los nombres propios de empresas mineras no se traducen: son razones sociales,
  no texto de interfaz.
- Nuevos textos deben agregarse como claves del diccionario; el tipo
  `Dictionary` obliga a mantener la misma superficie en los cuatro idiomas.

## Evidencia

- Frontend: `I18nProvider.tsx`, `PlatformRegionBar.tsx`, `AuthGateway.tsx`,
  `App.tsx`, `platformPrefs.ts`, `platformCatalog.ts`, `index.css`.
- Backend: `platform_routes.cpp` expone `default_locale`;
  `auth_routes.cpp` valida RUC/CNPJ/identificador norteamericano.
- TypeScript `tsc --noEmit`: OK.
- Build Vite de producción: OK.
- Vitest: 25/25, incluidos país→idioma, persistencia, teléfono E.164,
  `<html lang>`, avatar y confirmación accesible.
- Navegador real 1280×720: login persona/empresa y registro persona/empresa
  verificados en ES/PT/FR/EN; sin overflow horizontal o vertical. Países
  críticos traducidos con prefijo; `fr-CA` y `en-US` confirmados.
- Backend: `docker compose build web` OK; CMake/GNU enlazó
  `beemetry_backend` al 100 %.
- E2E real: registro, login por contraseña, login facial, auditoría filtrada,
  CSV, refresh HttpOnly con CSRF, rotación y logout: OK.
- Matriz fiscal real: PE/BR/US/CA válidos e inválidos: 8/8; se rechazan
  identificadores repetidos como `000…`.
- El smoke corrige el nombre vigente `csrf_token_v2`, genera identidades
  realmente únicas y muestra el error HTTP real. La auditoría detectó además
  IDs hexadecimales de longitud variable; `makeId()` ahora rellena siempre
  32 caracteres, compatibles con UUID compacto.
