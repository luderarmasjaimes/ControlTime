/**
 * navClickGuard.ts — diagnóstico SIEMPRE activo (no gateado por VITE_DEBUG,
 * a diferencia de logger.ts) para el reporte de usuario 2026-09-10: "el
 * avatar generando no me deja entrar a Informes/Reportes".
 *
 * La causa raíz encontrada esa sesión fue AvatarWidget.tsx (position: fixed,
 * zIndex 9998) pudiendo posicionarse sobre el header/nav (.mining-nav-rail,
 * sin z-index propio) y tapando físicamente el click del botón de menú por
 * debajo -- ya corregido ahí (TOP_SAFE_ZONE) y en index.css (z-index en
 * .mining-nav-rail). Este módulo queda instalado en PRODUCCIÓN como red de
 * seguridad: si el mismo síntoma ("no puedo entrar a tal menú") vuelve a
 * reportarse -- por este widget, por cualquier otro overlay futuro (un
 * modal que no se cerró bien, un toast, etc.) -- este guard lo deja escrito
 * en la consola del navegador en el momento exacto en que ocurre, en vez de
 * depender de reproducirlo en vivo para diagnosticarlo (justo lo que faltó
 * la primera vez: sin esto, la única pista fue la descripción del usuario).
 *
 * Mecanismo: en cada pointerdown, compara qué elemento va a recibir
 * realmente el evento (document.elementsFromPoint, en orden de z-index) con
 * si había un botón de menú en ese mismo punto. Si el botón de menú existe
 * pero no es el receptor real, algo se interpuso -- se loguea el receptor
 * real y el botón tapado con su selector + bounding rect, para poder
 * identificar el elemento sin necesidad de reproducir el bug con el propio
 * navegador.
 */

const NAV_BUTTON_SELECTOR =
    '.enterprise-main-btn, .enterprise-sub-btn, .mining-nav-rail button, .mining-nav-arrow'

let installedCleanup: (() => void) | null = null

function describeElement(el: Element): string {
    const tag = el.tagName.toLowerCase()
    const id = el.id ? `#${el.id}` : ''
    const cls =
        typeof el.className === 'string' && el.className.trim()
            ? `.${el.className.trim().split(/\s+/).join('.')}`
            : ''
    const rect = el.getBoundingClientRect()
    const text = (el.textContent || '').trim().slice(0, 40)
    return (
        `<${tag}${id}${cls}>` +
        ` rect=(${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)})` +
        (text ? ` text="${text}"` : '')
    )
}

function onPointerDown(event: PointerEvent): void {
    // elementsFromPoint devuelve TODO lo que hay en ese punto, en orden de
    // pintado (de arriba hacia abajo) -- el primero es el que de verdad
    // recibiría el click.
    let stack: Element[] = [];
    try {
        stack = document.elementsFromPoint(event.clientX, event.clientY)
    } catch {
        return // no debería fallar en un navegador real, pero nunca debe romper la app si lo hace
    }
    if (stack.length === 0) return

    const realTarget = stack[0]
    if (realTarget.closest(NAV_BUTTON_SELECTOR)) return // llegó bien, nada que reportar

    const coveredNavButton = stack.find((el) => el.closest(NAV_BUTTON_SELECTOR))
    if (!coveredNavButton) return // no había ningún botón de menú en este punto, no es el caso que nos interesa

    // eslint-disable-next-line no-console -- diagnóstico deliberado, siempre visible (ver comentario arriba)
    console.error(
        '[NAV_CLICK_GUARD] posible click bloqueado: había un botón de menú en este punto, pero otro elemento lo tapa.',
        {
            point: `(${event.clientX}, ${event.clientY})`,
            elementoQueRecibeElClick: describeElement(realTarget),
            botonDeMenuTapado: describeElement(coveredNavButton.closest(NAV_BUTTON_SELECTOR) as Element),
        },
    )
}

/**
 * Instala el guard en `window` (captura, no burbuja -- necesita correr ANTES
 * que cualquier stopPropagation() de un handler específico). Idempotente:
 * llamarlo de nuevo con un guard ya instalado no duplica el listener.
 * Devuelve la función de limpieza (para el cleanup del useEffect que lo
 * instala).
 */
export function installNavClickGuard(): () => void {
    if (installedCleanup) return installedCleanup
    // eslint-disable-next-line no-console
    console.info(
        '[NAV_CLICK_GUARD] activo -- detecta clicks al menú bloqueados por otro elemento por encima ' +
            '(hallazgo real 2026-09-10, ver AvatarWidget.tsx TOP_SAFE_ZONE).',
    )
    window.addEventListener('pointerdown', onPointerDown, true)
    installedCleanup = () => {
        window.removeEventListener('pointerdown', onPointerDown, true)
        installedCleanup = null
    }
    return installedCleanup
}
