import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { getSession } from '../../auth/authStorage'
import {
    createAvatarAnimation,
    fetchAvatarAnimationVideo,
    getAvatarAnimationStatus,
    type AvatarAnimationKind,
} from '../../auth/authApi'

// Avatar animado en producto (ADR-150, extendido por ADR-164): widget
// flotante persistente, montado una sola vez en el shell del dashboard
// (junto a ConfirmActionHost, ver App.tsx) para que sobreviva la navegación
// entre pestañas. "welcome" se sigue disparando solo, automáticamente, al
// iniciar sesión (comportamiento sin cambios). Los demás kinds
// (onboarding/report/alarm_loop) se disparan desde cualquier otro
// componente del árbol vía requestSupportAvatar(), mismo patrón imperativo
// por CustomEvent que ya usa ConfirmActionDialog.tsx
// (requestConfirmation/requestNotice) -- evita prop drilling o un contexto
// nuevo para algo que ya tiene un precedente en este repo.
//
// Restricción real de GPU (avatar_animation_engine: un solo worker, cola
// tope 3, ~200-300s por render, ver ADR-150/164): mientras haya una
// animación en curso ('queued'/'rendering'), cualquier request nuevo se
// ignora en vez de encolarse -- ningún trigger de este widget debe poder
// saturar la cola compartida con otros usuarios.
//
// "kpi" NO tiene disparador todavía (ADR-164: sin punto de acción explícita
// real en la UI de dashboards/KPI) -- se deja fuera a propósito, no se
// dispara nunca desde este widget en esta pasada.

const SUPPORT_AVATAR_EVENT = 'beemetry-support-avatar-request'
const AUTH_RESET_EVENT = 'beemetry-auth-session-cleared'
const POLL_INTERVAL_MS = 4000
const MAX_POLL_ATTEMPTS = 90 // ~6 min, generoso sobre los 200-300s medidos (ADR-150)
const WIDGET_WIDTH = 220
const WIDGET_MARGIN = 12
// Hallazgo real, sesión 2026-09-10 (reporte de usuario: "el avatar generando
// no me deja entrar a Informes/Reportes"): el widget es `position: fixed`
// con zIndex 9998 -- muy por encima del header/nav (`.mining-nav-rail`,
// z-index implícito, ver App.tsx/index.css), que NO es `position: fixed` y
// vive arriba de la pantalla (dos franjas de `HorizontalNavRail`, ~39px c/u,
// con las pestañas reales como "Informes/Reportes"). Sin este límite,
// `clampPosition`/`reclamp` (abajo) solo evitaban que el widget quedara
// FUERA de la pantalla, pero permitían arrastrarlo (o restaurar una posición
// guardada de una sesión anterior) hasta pegado al borde superior --
// exactamente encima del nav. Al estar por encima en z-index, el widget
// capturaba el click destinado al botón del menú por debajo: no era el
// avatar "bloqueando" nada a nivel de red/backend, era este widget
// tapándolo físicamente. Reservar esta franja superior (generosa: cubre
// header + ambas filas de nav) hace que el widget nunca pueda solaparse con
// la navegación, sin importar dónde lo arrastre el usuario o qué posición
// tenga guardada de antes de este fix (`loadSavedPosition` re-clampea al
// cargar).
const TOP_SAFE_ZONE = 160

// Hallazgo real, sesión 2026-09-09 (usuario 09637600/ALPAYANA): el guard de
// "ya está corriendo una animación" vivía en refs de React
// (`startedWelcomeRef`/`busyRef`), que se REINICIAN si el componente se
// desmonta y vuelve a montar -- confirmado en vivo con un navegador real:
// AvatarWidget se remonta varias veces durante una misma carga de página
// (mountId distinto en cada log de montaje), cada remonte con refs frescos
// que volvían a disparar `runAnimation('welcome')` desde cero, apilando
// ciclos de sondeo huérfanos (el anterior nunca se cancela porque su propio
// cleanup no llega a ejecutarse a tiempo) -- decenas de peticiones
// GET status/download repetidas contra el mismo job. Variables de MÓDULO en
// vez de refs: sobreviven a cualquier remonte del componente dentro de la
// misma carga de página (solo se reinician con un reload real), así que un
// remonte ya no puede volver a disparar la misma animación.
let welcomeAutoTriggeredThisPageLoad = false
let animationInFlight = false

/** Hallazgo real, sesión 2026-09-09 (usuario 09637600/ALPAYANA): "hice
 * login nuevo pero no veo ni escucho nada" -- `welcomeAutoTriggeredThisPageLoad`
 * (arriba) soluciona el remonte-en-bucle, pero como efecto secundario real
 * también bloqueaba un login GENUINO posterior en la misma pestaña (logout
 * + login sin recargar la página): el guard sigue en `true` desde el
 * primer login, así que el segundo login nunca vuelve a disparar el
 * "welcome" -- silencio total, sin error, exactamente el síntoma
 * reportado. `clearSession()` (authStorage.ts) tampoco limpiaba los flags
 * `beemetry_avatar_shown_v1_*` de sessionStorage, mismo problema por otra
 * vía. Se resuelve con un evento (mismo patrón imperativo que
 * `requestSupportAvatar` en este archivo) en vez de un import directo
 * entre authStorage.ts/authApi.ts y este componente -- ambos módulos de
 * auth ya son importados POR este archivo, así que un import inverso
 * crearía un ciclo. */
function resetAvatarWidgetTriggers(): void {
    welcomeAutoTriggeredThisPageLoad = false
    animationInFlight = false
    try {
        const staleKeys: string[] = []
        for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i)
            if (key && key.startsWith('beemetry_avatar_shown_v1_')) staleKeys.push(key)
        }
        staleKeys.forEach((key) => sessionStorage.removeItem(key))
    } catch {
        // No crítico -- ver wasAlreadyShown/markShown más abajo, mismo criterio.
    }
}

type WidgetState = 'idle' | 'queued' | 'rendering' | 'ready' | 'error' | 'unavailable'

interface SupportAvatarRequest {
    kind: AvatarAnimationKind
    /** Identificador opcional para deduplicar (ej. reportId, alarmId) --
     * sin esto, el flag de "ya mostrado" es por kind (una vez por sesión). */
    dedupeKey?: string
}

/** Pide que el widget dispare una animación de un kind distinto a
 * "welcome" (onboarding/report/alarm_loop). Se ignora si ya hay una
 * animación en curso (ver comentario de restricción de GPU arriba) o si
 * este mismo (kind, dedupeKey) ya se mostró en la sesión. */
export function requestSupportAvatar(kind: AvatarAnimationKind, dedupeKey?: string): void {
    window.dispatchEvent(
        new CustomEvent<SupportAvatarRequest>(SUPPORT_AVATAR_EVENT, { detail: { kind, dedupeKey } }),
    )
}

function shownFlagKey(kind: AvatarAnimationKind, dedupeKey?: string): string {
    return `beemetry_avatar_shown_v1_${kind}${dedupeKey ? `_${dedupeKey}` : ''}`
}

function wasAlreadyShown(kind: AvatarAnimationKind, dedupeKey?: string): boolean {
    try {
        return sessionStorage.getItem(shownFlagKey(kind, dedupeKey)) === '1'
    } catch {
        return false // sessionStorage restringido -- no bloquear el widget, ver AvatarWidget original.
    }
}

function markShown(kind: AvatarAnimationKind, dedupeKey?: string): void {
    try {
        sessionStorage.setItem(shownFlagKey(kind, dedupeKey), '1')
    } catch {
        // No crítico si falla (ventana privada, cuota, política de sitio).
    }
}

function clampPosition(x: number, y: number): { x: number; y: number } {
    const maxX = Math.max(WIDGET_MARGIN, window.innerWidth - WIDGET_WIDTH - WIDGET_MARGIN)
    // TOP_SAFE_ZONE en vez de WIDGET_MARGIN acá: ver comentario junto a la
    // constante -- el borde superior del widget nunca debe poder acercarse
    // al header/nav, no solo al borde de la pantalla.
    const maxY = Math.max(WIDGET_MARGIN, window.innerHeight - 80 - TOP_SAFE_ZONE)
    return { x: Math.min(Math.max(x, WIDGET_MARGIN), maxX), y: Math.min(Math.max(y, WIDGET_MARGIN), maxY) }
}

function loadSavedPosition(): { x: number; y: number } {
    try {
        const raw = localStorage.getItem('beemetry_avatar_widget_pos_v1')
        if (raw) {
            const parsed = JSON.parse(raw)
            if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
                return clampPosition(parsed.x, parsed.y)
            }
        }
    } catch {
        // localStorage restringido -- cae a la posición por defecto abajo.
    }
    return clampPosition(WIDGET_MARGIN, window.innerHeight - 80 - WIDGET_MARGIN)
}

/**
 * Reproductor del video animado (fondo transparente, WebM VP9+alfa).
 *
 * Hallazgo real, sesión 2026-09-09 (usuario 09637600/ALPAYANA, "se escucha
 * el audio pero no se ve el video"): reproducido en vivo -- un `<video>`
 * nativo con este archivo decodifica perfecto (readyState=4, dimensiones
 * correctas, sin error) y el audio suena, pero el frame nunca se pinta en
 * pantalla (área completamente negra). Confirmado con `ctx.drawImage(video,
 * 0, 0)` + muestreo de píxeles: los datos decodificados SÍ son correctos
 * (tonos de piel reales con alfa=255 donde es opaco, alfa=0 donde es
 * transparente) -- el video y el navegador decodifican bien, pero el
 * COMPOSITADO nativo del elemento `<video>` con canal alfa VP9 falla en
 * pantalla. Es una categoría de bug conocida de Chromium (video VP9-alfa
 * decodifica bien pero no compone visualmente en ciertas rutas de
 * aceleración por hardware), no un problema de este pipeline.
 *
 * Workaround real: en vez de mostrar el `<video>` directamente, se decodifica
 * en uno oculto (fuera de pantalla, sigue manejando audio normalmente) y se
 * dibuja cada frame a mano en un `<canvas>` visible vía
 * `requestAnimationFrame` + `drawImage` -- la misma llamada que ya se probó
 * en vivo que SÍ pinta el contenido real. El canvas 2D no pasa por la ruta
 * de composición que falla, así que evita el bug en vez de perseguirlo.
 */
function AlphaVideoCanvas({ src }: { src: string }) {
    const videoRef = useRef<HTMLVideoElement | null>(null)
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const rafRef = useRef<number | null>(null)
    const contentDetectedRef = useRef(false)
    const [ready, setReady] = useState(false)
    const [playing, setPlaying] = useState(false)
    const [muted, setMuted] = useState(false)
    // Fracciones verticales (0-1) del lienzo con contenido real -- ver
    // detección más abajo. top=0/bottom=1 = sin recortar (todavía no se
    // detectó).
    const [contentTop, setContentTop] = useState(0)
    const [contentBottom, setContentBottom] = useState(1)
    // Actualización 2026-09-09 (continuación): el usuario pidió eliminar
    // TODAS las zonas en blanco grandes, no solo arriba/abajo -- medido en
    // vivo (mismo canvas real, escaneo por columna): el sujeto no llena el
    // ancho del lienzo 3:4, deja columnas blancas a los lados (medido
    // firstContentCol≈13.5%, lastContentCol≈79.8% del ancho). Mismo
    // criterio que el recorte vertical: se detecta el borde real y se
    // recorta con el mismo patrón `position:absolute` + desplazamiento.
    const [contentLeft, setContentLeft] = useState(0)
    const [contentRight, setContentRight] = useState(1)
    const [aspect, setAspect] = useState<number | null>(null)

    // Hallazgo real, sesión 2026-09-09 (pedido explícito del usuario tras ver
    // el primer resultado con posición corregida): el lienzo compuesto por
    // avatar_engine deja un margen en blanco real debajo del busto (el
    // usuario/hombros no llenan todo el 3:4 del lienzo) -- confirmado
    // píxel a píxel: contenido real (alfa>0) hasta ~y=1000-1100 de 2048,
    // opaco BLANCO (no transparente) de ahí para abajo. No es un bug del
    // segmentador de fondo transparente (matting.py) -- ese margen nunca
    // tuvo persona ni fondo real de cámara detrás, es lienzo propio del
    // compuesto del avatar estático. En vez de tocar avatar_engine (afecta
    // TODOS los avatares, requeriría la misma verificación por lotes que
    // el resto de este repo), se detecta el borde inferior real del
    // contenido en el frame ya decodificado y se recorta la presentación
    // acá -- el widget nunca debe mostrar el margen en blanco.
    //
    // Actualización 2026-09-09 (mismo hallazgo, esta vez ARRIBA): el usuario
    // reportó una segunda franja blanca, esta encima del pelo -- medido en
    // vivo con el navegador real: y=0 a ~90 (de 2048) es opaco blanco
    // (r=249,g=251,b=248, alfa=255, el mismo color de fondo del avatar
    // estático), transición real recién en y≈100-140. Es el margen fijo de
    // aire (`target_top_y = canvas_h * 0.05`, ver ADR-141) agregado por el
    // fix de recorte de pelo de esta misma sesión -- el MISMO problema que
    // el margen inferior, nunca antes recortado porque el primer intento de
    // este fix solo miraba el borde de ABAJO. Ahora se detecta también el
    // borde SUPERIOR real (misma lógica, escaneando de arriba hacia abajo)
    // y se recorta simétricamente.
    const detectContentBounds = (
        ctx: CanvasRenderingContext2D,
        canvas: HTMLCanvasElement
    ) => {
        try {
            const { data, height, width } = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const rowStride = width * 4
            // No alcanza con "opaco" (alfa>40): el fondo BLANCO propio del
            // avatar estático (ADR-074/141, "fondo blanco real") queda
            // opaco por diseño -- un segmentador entrenado con fotos reales
            // no distingue una imagen YA estilizada de fondo plano blanco
            // de una persona real con ropa blanca, así que ese margen
            // termina alfa=255 igual que la cara. Se exige ADEMÁS que el
            // píxel no sea casi-blanco (algún canal por debajo de 235) para
            // contar como "contenido real" -- deja pasar piel/pelo/ropa con
            // color, descarta el margen plano.
            const rowHasRealContent = (y: number): boolean => {
                let realCount = 0
                const rowStart = y * rowStride
                for (let x = 0; x < width; x += 8) {
                    const i = rowStart + x * 4
                    const isOpaque = data[i + 3] > 40
                    const isNearWhite = data[i] > 235 && data[i + 1] > 235 && data[i + 2] > 235
                    if (isOpaque && !isNearWhite) {
                        realCount++
                        if (realCount > 4) return true
                    }
                }
                return false
            }
            let firstContentRow = 0
            for (let y = 0; y < height; y++) {
                if (rowHasRealContent(y)) { firstContentRow = y; break }
            }
            let lastContentRow = height - 1
            for (let y = height - 1; y >= 0; y--) {
                if (rowHasRealContent(y)) { lastContentRow = y; break }
            }
            // Mismo criterio, eje horizontal: columna con >4 píxeles reales
            // (opaco Y no-casi-blanco) en un muestreo cada 8px de alto.
            const colHasRealContent = (x: number): boolean => {
                let realCount = 0
                for (let y = 0; y < height; y += 8) {
                    const i = y * rowStride + x * 4
                    const isOpaque = data[i + 3] > 40
                    const isNearWhite = data[i] > 235 && data[i + 1] > 235 && data[i + 2] > 235
                    if (isOpaque && !isNearWhite) {
                        realCount++
                        if (realCount > 4) return true
                    }
                }
                return false
            }
            let firstContentCol = 0
            for (let x = 0; x < width; x++) {
                if (colHasRealContent(x)) { firstContentCol = x; break }
            }
            let lastContentCol = width - 1
            for (let x = width - 1; x >= 0; x--) {
                if (colHasRealContent(x)) { lastContentCol = x; break }
            }
            // Actualización 2026-09-09 (corrección tras regresión real): el
            // intento anterior (margen -1.5%/+6%) medía bien en teoría pero
            // en vivo (`getImageData` sobre el canvas real, columna x=768)
            // dio firstContentRow=100 (4.9%) y lastContentRow=1116 (54.5%)
            // -- el margen de +6% sumaba HASTA 60.5%, es decir volvía a
            // incluir ~123px de blanco opaco puro que la detección ya había
            // excluido correctamente. Ese blanco reintroducido a propósito
            // ERA la franja que el usuario reportó como "peor, más grande".
            // `rowHasRealContent` ya exige que el pixel no sea casi-blanco
            // (canal <=235) para contar como contenido, así que el borde
            // detectado ya cae al final de la transición real, no hace
            // falta un colchón grande -- unos pocos px de aire alcanzan.
            // Actualización 2026-09-09 (continuación): el usuario pidió un
            // recorte recto explícito de ~2% del alto VISIBLE (no del
            // lienzo nativo completo) en el borde inferior, más fácil de
            // razonar que perseguir el último px de remanente blanco --
            // ~2% de la fracción visible (bottom-top≈0.51) son ~0.01 en
            // fracción del lienzo nativo. Se resta directo del margen
            // anterior (+0.012) en vez de sumar aire, así el corte queda
            // justo en el borde real detectado, sin remanente.
            const top = Math.min(0.45, Math.max(0, firstContentRow / height - 0.004))
            const bottom = Math.max(0.4, Math.min(1, lastContentRow / height + 0.002))
            setContentTop(top)
            setContentBottom(bottom)
            // Mismo margen chico que arriba/abajo (unos pocos px de aire,
            // no un colchón grande) -- misma justificación: el umbral
            // "no-casi-blanco" ya deja el borde detectado al final de la
            // transición real.
            const left = Math.min(0.45, Math.max(0, firstContentCol / width - 0.006))
            const right = Math.max(0.55, Math.min(1, lastContentCol / width + 0.006))
            setContentLeft(left)
            setContentRight(right)
        } catch {
            // getImageData puede fallar si el canvas quedó "tainted" -- no
            // debería pasar (mismo origen), pero no vale la pena romper la
            // reproducción por esto si ocurre.
        }
    }

    useEffect(() => {
        const video = videoRef.current
        const canvas = canvasRef.current
        if (!video || !canvas) return
        const ctx = canvas.getContext('2d')
        contentDetectedRef.current = false
        setContentTop(0)
        setContentBottom(1)
        setContentLeft(0)
        setContentRight(1)

        // Hallazgo real, sesión 2026-09-09: algo MÁS en esta SPA (probablemente
        // un hook/observer compartido para canvases "nítidos en retina" --
        // este dashboard usa Konva/ECharts, que suelen traer uno) le cambia
        // `canvas.width`/`height` a este canvas después de montado, sin que
        // este componente lo pida -- medido en vivo: quedaba en 628×178 (la
        // misma proporción que su tamaño CSS × devicePixelRatio 1.5) en vez
        // de 1536×2048, el tamaño real del video. Fijarlo una sola vez en
        // 'loadedmetadata' no alcanza porque lo que sea que lo cambia corre
        // DESPUÉS. Reafirmar el tamaño correcto en cada tick de rAF, justo
        // antes de dibujar, gana la carrera sin importar cuándo corra lo que
        // interfiere -- confirmado en vivo que forzarlo antes de cada draw()
        // sí pinta el contenido real.
        let framesDrawn = 0
        const draw = () => {
            if (ctx && video.videoWidth > 0 && video.videoHeight > 0) {
                if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth
                if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight
                ctx.clearRect(0, 0, canvas.width, canvas.height)
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
                framesDrawn += 1
                // Espera unos frames (evita detectar sobre el primer frame,
                // que a veces todavía no tiene datos reales pintados) y solo
                // una vez -- getImageData sobre un lienzo 1536×2048 no es
                // gratis, no tiene sentido repetirlo en cada tick.
                if (!contentDetectedRef.current && framesDrawn === 5) {
                    contentDetectedRef.current = true
                    detectContentBounds(ctx, canvas)
                }
            }
            rafRef.current = requestAnimationFrame(draw)
        }

        const onLoadedMetadata = () => {
            if (video.videoWidth > 0 && video.videoHeight > 0) {
                canvas.width = video.videoWidth
                canvas.height = video.videoHeight
                setAspect(video.videoWidth / video.videoHeight)
            }
        }
        const onLoaded = () => setReady(true)
        const onPlay = () => setPlaying(true)
        const onPause = () => setPlaying(false)
        video.addEventListener('loadedmetadata', onLoadedMetadata)
        video.addEventListener('loadeddata', onLoaded)
        video.addEventListener('play', onPlay)
        video.addEventListener('pause', onPause)
        video.addEventListener('ended', onPause)
        // Si el metadata ya estaba listo antes de que este efecto corriera
        // (ej. video cacheado por el navegador), el evento 'loadedmetadata'
        // ya disparó y no volverá a hacerlo -- fijar las dimensiones acá
        // también, de una vez, cubre ese caso.
        onLoadedMetadata()

        rafRef.current = requestAnimationFrame(draw)

        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current)
            video.removeEventListener('loadedmetadata', onLoadedMetadata)
            video.removeEventListener('loadeddata', onLoaded)
            video.removeEventListener('play', onPlay)
            video.removeEventListener('pause', onPause)
            video.removeEventListener('ended', onPause)
        }
    }, [src])

    const togglePlay = () => {
        const video = videoRef.current
        if (!video) return
        if (video.paused) void video.play()
        else video.pause()
    }

    const toggleMute = (event: ReactMouseEvent) => {
        event.stopPropagation()
        const video = videoRef.current
        if (!video) return
        video.muted = !video.muted
        setMuted(video.muted)
    }

    return (
        // Pedido explícito del usuario (2026-09-09): el avatar debe verse
        // sin fondo propio, mezclado con el fondo real de la plataforma --
        // `background: 'transparent'` (antes '#000', un remanente del
        // `<video>` nativo original) deja ver el fondo oscuro del propio
        // contenedor del widget (`rgba(15,18,26,0.92)`, ver más abajo) a
        // través de las zonas realmente transparentes del video (alfa=0).
        //
        // El wrapper recorta los márgenes blancos arriba Y abajo (ver
        // `detectContentBounds` arriba, pedido explícito del usuario tras
        // ver el primer resultado, extendido a ambos bordes tras el
        // segundo reporte con la franja superior): `visibleFraction` es la
        // porción vertical del lienzo con contenido real: el wrapper mide
        // esa fracción de la altura natural del canvas (`aspect-ratio`) y
        // `overflow: hidden` esconde el resto. El canvas mantiene su
        // proporción REAL sin recortar (`aspectRatio: aspect`) pero se
        // desplaza hacia arriba (`top` negativo, en % de la altura del
        // wrapper) exactamente lo necesario para que el borde superior
        // real del contenido quede pegado al borde superior del wrapper.
        <div
            style={{
                position: 'relative',
                width: '100%',
                background: 'transparent',
                overflow: 'hidden',
                aspectRatio: aspect
                    ? String(
                          (aspect * (contentRight - contentLeft)) / (contentBottom - contentTop)
                      )
                    : undefined,
            }}
        >
            <video
                ref={videoRef}
                src={src}
                autoPlay
                playsInline
                style={{ position: 'absolute', left: -9999, width: 1, height: 1 }}
            />
            <canvas
                ref={canvasRef}
                onClick={togglePlay}
                style={{
                    position: 'absolute',
                    left: `${-(contentLeft / (contentRight - contentLeft)) * 100}%`,
                    width: `${100 / (contentRight - contentLeft)}%`,
                    aspectRatio: aspect ? String(aspect) : undefined,
                    top: `${-(contentTop / (contentBottom - contentTop)) * 100}%`,
                    cursor: 'pointer',
                    opacity: ready ? 1 : 0,
                }}
            />
            {ready && (
                <button
                    type="button"
                    onClick={toggleMute}
                    aria-label={muted ? 'Activar audio' : 'Silenciar'}
                    style={{
                        position: 'absolute',
                        right: 6,
                        bottom: 6,
                        width: 26,
                        height: 26,
                        borderRadius: '50%',
                        border: 'none',
                        background: 'rgba(0,0,0,0.55)',
                        color: '#fff',
                        cursor: 'pointer',
                        fontSize: 13,
                        lineHeight: 1,
                    }}
                >
                    {muted ? '🔇' : '🔊'}
                </button>
            )}
            {ready && !playing && (
                <div
                    onClick={togglePlay}
                    style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        color: '#fff',
                        fontSize: 34,
                        background: 'rgba(0,0,0,0.15)',
                    }}
                >
                    ▶
                </div>
            )}
        </div>
    )
}

export function AvatarWidget() {
    const [state, setState] = useState<WidgetState>('idle')
    const [videoUrl, setVideoUrl] = useState<string | null>(null)
    const [dismissed, setDismissed] = useState(false)
    const [position, setPosition] = useState(() => loadSavedPosition())
    const objectUrlRef = useRef<string | null>(null)
    const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
    const containerRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        return () => {
            if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
        }
    }, [])

    // Hallazgo real, sesión 2026-09-09 (usuario 09637600/ALPAYANA, "se
    // escucha el audio pero no se ve el video"): el video SÍ decodifica y
    // pinta bien (confirmado píxel a píxel) -- el widget entero terminaba
    // renderizado fuera de la pantalla, arriba del viewport
    // (`getBoundingClientRect().y` negativo, `top` calculado en -230px).
    // Causa: el contenedor se ancla por `bottom: position.y` (crece hacia
    // arriba), y la posición por defecto (`loadSavedPosition`) asume una
    // altura fija de 80px -- válida para el estado chico ("Preparando tu
    // avatar…"), pero el widget con el video ya cargado mide ~320px real.
    // Con `bottom` grande (calculado para un widget de 80px) y una altura
    // real 4x mayor, el borde superior se va muy por encima del viewport.
    //
    // ResizeObserver en vez de un efecto atado a `[state, videoUrl]`: ese
    // enfoque re-clampeaba con la altura de CADA transición intermedia
    // (ej. el texto chico "Preparando tu avatar…" antes de que exista el
    // video), no necesariamente la altura FINAL una vez que el `<canvas>`
    // hijo termina de fijar su propio tamaño -- medido en vivo, seguía
    // quedando parcialmente fuera de pantalla. ResizeObserver reacciona al
    // tamaño real renderizado en cada cambio, sin depender de en qué orden
    // corren los efectos de este componente y el hijo.
    const isVisible = !(dismissed || state === 'idle' || state === 'unavailable' || state === 'error')

    useEffect(() => {
        // El contenedor NO EXISTE en el DOM mientras `state === 'idle'` (este
        // componente devuelve `null` más abajo) -- un efecto con deps `[]`
        // corría UNA vez, en el primer render, cuando `containerRef.current`
        // todavía era `null`, y nunca se reintentaba: el ResizeObserver
        // jamás llegaba a montarse. `isVisible` como dependencia hace que
        // este efecto se vuelva a ejecutar justo cuando el contenedor pasa
        // de no existir a existir.
        if (!isVisible) return
        const el = containerRef.current
        if (!el) return
        const reclamp = (height: number) => {
            if (height <= 0) return
            setPosition((current) => {
                // TOP_SAFE_ZONE acá también -- ver comentario junto a la
                // constante y en clampPosition: mismo criterio, esta vez con
                // la altura REAL del widget en vez de la aproximación de 80px.
                const maxY = Math.max(WIDGET_MARGIN, window.innerHeight - height - TOP_SAFE_ZONE)
                if (current.y <= maxY) return current
                return { ...current, y: maxY }
            })
        }
        // Diagnóstico SIEMPRE activo (no gateado por VITE_DEBUG, ver
        // navClickGuard.ts en frontend/src/lib): reporte 2026-09-10, "el
        // avatar generando no me deja entrar a Informes/Reportes". El fix
        // real es TOP_SAFE_ZONE (arriba) -- en operación normal esto nunca
        // debería loguear nada. Se deja como red de seguridad: si por
        // cualquier motivo (viewport nuevo/no contemplado, drag en curso,
        // cambio futuro de layout del nav) el widget vuelve a solaparse con
        // el header/nav real, queda escrito acá con el rect exacto de
        // ambos, en vez de depender de reproducir el bug para diagnosticarlo.
        const checkNavOverlap = () => {
            const widgetRect = el.getBoundingClientRect()
            const navEls = document.querySelectorAll('.mining-nav-rail')
            navEls.forEach((navEl) => {
                const navRect = navEl.getBoundingClientRect()
                const overlaps =
                    widgetRect.left < navRect.right &&
                    widgetRect.right > navRect.left &&
                    widgetRect.top < navRect.bottom &&
                    widgetRect.bottom > navRect.top
                if (overlaps) {
                    // eslint-disable-next-line no-console
                    console.error(
                        '[AVATAR_WIDGET] solapado con el nav -- puede estar tapando botones de menú.',
                        {
                            state,
                            widgetRect: `(${Math.round(widgetRect.left)},${Math.round(widgetRect.top)} ${Math.round(widgetRect.width)}x${Math.round(widgetRect.height)})`,
                            navRect: `(${Math.round(navRect.left)},${Math.round(navRect.top)} ${Math.round(navRect.width)}x${Math.round(navRect.height)})`,
                            navClass: navEl.className,
                        },
                    )
                }
            })
        }
        reclamp(el.getBoundingClientRect().height)
        checkNavOverlap()
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                reclamp(entry.contentRect.height)
            }
            checkNavOverlap()
        })
        observer.observe(el)
        return () => observer.disconnect()
    }, [isVisible, state])

    const runAnimation = (kind: AvatarAnimationKind, dedupeKey?: string) => {
        // animationInFlight (variable de módulo, no ref -- ver comentario
        // arriba) reemplaza el chequeo por `state` de la versión anterior:
        // ese dependía de que React ya hubiera aplicado el re-render antes
        // de la siguiente invocación, con una ventana real donde un segundo
        // disparo (remonte o evento) pasaba el guard. Acá se marca ANTES de
        // cualquier `await`, en el mismo tick que decide seguir adelante.
        if (animationInFlight) return // GPU de un solo worker -- nunca encolar un segundo request.
        if (wasAlreadyShown(kind, dedupeKey)) return
        animationInFlight = true

        let cancelled = false
        let attempts = 0
        let timer: ReturnType<typeof setTimeout> | null = null

        const finish = () => {
            animationInFlight = false
        }

        const poll = async (jobId: string) => {
            if (cancelled) return
            attempts += 1
            try {
                const status = await getAvatarAnimationStatus(jobId)
                if (status.status === 'success') {
                    const blob = await fetchAvatarAnimationVideo(jobId)
                    if (cancelled) return
                    const url = URL.createObjectURL(blob)
                    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
                    objectUrlRef.current = url
                    setVideoUrl(url)
                    setState('ready')
                    markShown(kind, dedupeKey)
                    setDismissed(false)
                    finish()
                    return
                }
                if (status.status === 'failed' || status.status === 'cancelled') {
                    // Hallazgo real, sesión 2026-09-09 (usuario 09637600/ALPAYANA,
                    // dos logins reales seguidos sin ver el widget): un fallo
                    // real (ej. avatar_hd_not_available, que en ese momento era
                    // legítimo -- la cuenta todavía no tenía avatar estático)
                    // marcaba "shown" acá y quedaba sellado para el resto de la
                    // pestaña -- ni cerrar sesión y volver a entrar lo
                    // reintentaba, solo una pestaña nueva o sessionStorage.clear()
                    // manual. NO marcar "shown" en ningún camino de fallo (ver
                    // también más abajo): el próximo login en la misma pestaña
                    // simplemente reintenta. Seguro porque el backend ya
                    // rechaza un segundo job mientras uno esté en curso (ver
                    // comentario de "Restricción real de GPU" arriba) -- no hay
                    // forma de saturar la cola reintentando en cada login.
                    setState('error')
                    finish()
                    return
                }
                if (attempts >= MAX_POLL_ATTEMPTS) {
                    setState('error')
                    finish()
                    return
                }
                setState('rendering')
                timer = setTimeout(() => poll(jobId), POLL_INTERVAL_MS)
            } catch {
                if (attempts >= MAX_POLL_ATTEMPTS) {
                    setState('error')
                    finish()
                    return
                }
                timer = setTimeout(() => poll(jobId), POLL_INTERVAL_MS)
            }
        }

        const start = async () => {
            setState('queued')
            try {
                const created = await createAvatarAnimation(kind)
                if (cancelled) return
                void poll(created.job_id)
            } catch {
                // avatar_animation_disabled / avatar_hd_not_available -- estados
                // esperados, no errores que deban molestar al usuario. No se
                // marca "shown" (ver comentario arriba) -- si la causa era
                // transitoria (ej. avatar_hd_not_available antes de que el
                // usuario abriera su avatar por primera vez), el próximo login
                // en la misma pestaña reintenta solo, en vez de quedar sellado.
                setState('unavailable')
                finish()
            }
        }
        void start()

        return () => {
            cancelled = true
            if (timer) clearTimeout(timer)
        }
    }

    // "welcome" (o "onboarding" si se acaba de registrar, ver AuthGateway.tsx):
    // disparo automático al montar. Mutuamente excluyentes -- un usuario recién
    // registrado no necesita además el "welcome" genérico en la misma sesión.
    const triggerWelcomeIfDue = () => {
        const session = getSession()
        if (!session) return undefined
        if (welcomeAutoTriggeredThisPageLoad) return undefined
        welcomeAutoTriggeredThisPageLoad = true

        let justRegistered = false
        try {
            justRegistered = sessionStorage.getItem('beemetry_avatar_just_registered_v1') === '1'
            if (justRegistered) sessionStorage.removeItem('beemetry_avatar_just_registered_v1')
        } catch {
            // No crítico -- cae al "welcome" normal.
        }

        return runAnimation(justRegistered ? 'onboarding' : 'welcome')
    }

    useEffect(() => {
        const cleanup = triggerWelcomeIfDue()
        return cleanup
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Ver comentario largo de `resetAvatarWidgetTriggers` arriba: un logout
    // o un login real dentro de la misma pestaña debe poder volver a
    // mostrar "welcome", no solo el primer montaje del componente.
    useEffect(() => {
        let cleanup: (() => void) | undefined
        const onAuthReset = () => {
            resetAvatarWidgetTriggers()
            cleanup = triggerWelcomeIfDue()
        }
        window.addEventListener(AUTH_RESET_EVENT, onAuthReset)
        return () => {
            window.removeEventListener(AUTH_RESET_EVENT, onAuthReset)
            if (cleanup) cleanup()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Kinds no-welcome: disparados por otros componentes vía requestSupportAvatar().
    useEffect(() => {
        const onRequest = (event: Event) => {
            const detail = (event as CustomEvent<SupportAvatarRequest>).detail
            if (!detail) return
            runAnimation(detail.kind, detail.dedupeKey)
        }
        window.addEventListener(SUPPORT_AVATAR_EVENT, onRequest)
        return () => window.removeEventListener(SUPPORT_AVATAR_EVENT, onRequest)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Arrastre: mismo patrón useRef + listeners globales de mousemove/mouseup
    // que ya usa TableBlock.tsx (beginColumnResize) para resize de columnas,
    // adaptado acá a delta X/Y libre en vez de solo ancho.
    const beginDrag = (event: React.MouseEvent) => {
        event.preventDefault()
        dragRef.current = {
            startX: event.clientX,
            startY: event.clientY,
            originX: position.x,
            originY: position.y,
        }
        const onMove = (moveEvent: MouseEvent) => {
            const drag = dragRef.current
            if (!drag) return
            const next = clampPosition(
                drag.originX + (moveEvent.clientX - drag.startX),
                drag.originY - (moveEvent.clientY - drag.startY),
            )
            setPosition(next)
        }
        const onUp = () => {
            dragRef.current = null
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
            setPosition((current) => {
                try {
                    localStorage.setItem('beemetry_avatar_widget_pos_v1', JSON.stringify(current))
                } catch {
                    // No crítico -- el widget vuelve a la posición por defecto la próxima sesión.
                }
                return current
            })
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
    }

    if (dismissed || state === 'idle' || state === 'unavailable' || state === 'error') {
        return null
    }

    // Pedido explícito del usuario (2026-09-09), tras ver el video ya
    // visible y bien recortado: "quitarle todos los bordes... que se vea
    // solo el rostro... como si fuera una imagen con fondo transparente".
    // La tarjeta con título/fondo/sombra tenía sentido para los estados de
    // texto ("Preparando tu avatar…") pero rompía exactamente el efecto de
    // "avatar flotando sobre la plataforma" una vez que hay video real --
    // se ve, en sus palabras, como una tarjeta de UI, no como el
    // personaje. Con video listo: sin tarjeta, sin título, sin fondo --
    // solo el `<canvas>` (ya transparente y recortado) flotando, con un
    // botón de cerrar chico superpuesto en vez de una barra completa. Los
    // estados de texto (todavía sin video) conservan la tarjeta -- ahí sí
    // hace falta un fondo para poder leer el texto.
    if (state === 'ready' && videoUrl) {
        return (
            <div
                ref={containerRef}
                style={{
                    position: 'fixed',
                    left: position.x,
                    bottom: position.y,
                    zIndex: 9998,
                    width: WIDGET_WIDTH,
                }}
            >
                <div onMouseDown={beginDrag} style={{ cursor: 'grab' }}>
                    <AlphaVideoCanvas src={videoUrl} />
                </div>
                <button
                    type="button"
                    onClick={() => setDismissed(true)}
                    aria-label="Cerrar avatar"
                    style={{
                        position: 'absolute',
                        top: 4,
                        right: 4,
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        border: 'none',
                        background: 'rgba(0,0,0,0.45)',
                        color: '#fff',
                        cursor: 'pointer',
                        fontSize: 13,
                        lineHeight: 1,
                    }}
                >
                    ×
                </button>
            </div>
        )
    }

    return (
        <div
            ref={containerRef}
            style={{
                position: 'fixed',
                left: position.x,
                bottom: position.y,
                zIndex: 9998,
                width: WIDGET_WIDTH,
                borderRadius: 16,
                overflow: 'hidden',
                boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
                background: 'rgba(15,18,26,0.92)',
                color: '#fff',
                fontSize: 12,
            }}
        >
            <div
                onMouseDown={beginDrag}
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '6px 10px',
                    cursor: 'grab',
                    userSelect: 'none',
                }}
            >
                <span>Tu avatar</span>
                <button
                    type="button"
                    onClick={() => setDismissed(true)}
                    onMouseDown={(event) => event.stopPropagation()}
                    aria-label="Cerrar avatar"
                    style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#fff',
                        cursor: 'pointer',
                        fontSize: 14,
                        lineHeight: 1,
                    }}
                >
                    ×
                </button>
            </div>
            <div style={{ padding: '12px 10px 16px', opacity: 0.85 }}>
                {state === 'queued' && 'Preparando tu avatar…'}
                {state === 'rendering' && 'Generando video (puede tardar unos minutos)…'}
            </div>
        </div>
    )
}
