/**
 * Guía de voz + tonos para los retos de liveness activa (ADR-142/146),
 * ampliado 2026-09-07 a pedido explícito del usuario: las indicaciones del
 * reto (giro, desplazamiento, acercarse/alejarse) deben ser "entendibles
 * tanto visualmente como con el audio". Usa Web Speech API (síntesis de voz)
 * + Web Audio API (tonos) nativas del navegador -- sin dependencias
 * externas, sin costo por request, funciona sin conexión. No decide nada
 * del reto en sí (eso lo sigue haciendo únicamente el servidor, ver
 * liveness_challenge.cpp/ADR-142): esto sólo narra lo que la UI ya muestra,
 * así que un navegador sin voces instaladas o con el audio bloqueado nunca
 * bloquea la captura -- todo acá es best-effort.
 */

const SPEECH_LANG_BY_LANGUAGE: Record<string, string> = {
    es: 'es-PE',
    en: 'en-US',
    fr: 'fr-FR',
    pt: 'pt-BR',
}

export function isSpeechSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window
}

let lastSpokenText = ''
let lastSpokenAt = 0

/**
 * Cancela cualquier locución en curso y dice `text` en el idioma activo.
 * Deduplicación de 400ms: el estado del reto puede re-renderizar varias
 * veces con el mismo texto (polling cada ~175ms) -- sin esto se
 * superpondrían locuciones idénticas en ráfaga.
 */
export function speak(text: string, language: string): void {
    if (!isSpeechSupported() || !text) return
    const now = performance.now()
    if (text === lastSpokenText && now - lastSpokenAt < 400) return
    lastSpokenText = text
    lastSpokenAt = now
    try {
        window.speechSynthesis.cancel()
        const utter = new SpeechSynthesisUtterance(text)
        utter.lang = SPEECH_LANG_BY_LANGUAGE[language] || 'es-PE'
        utter.rate = 1.0
        utter.pitch = 1.0
        window.speechSynthesis.speak(utter)
    } catch {
        // Best-effort: motor de síntesis caído o sin voces -- la guía visual
        // (flechas/texto) sigue funcionando igual.
    }
}

export function stopSpeaking(): void {
    if (!isSpeechSupported()) return
    try {
        window.speechSynthesis.cancel()
    } catch {
        // Best-effort.
    }
    lastSpokenText = ''
}

function playTone(frequencies: number[], noteDurationMs: number): void {
    try {
        const AudioCtxCtor =
            window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext })
                .webkitAudioContext
        if (!AudioCtxCtor) return
        const ctx = new AudioCtxCtor()
        let t = ctx.currentTime
        frequencies.forEach((freq) => {
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = 'sine'
            osc.frequency.value = freq
            // Envolvente corta (attack/decay) en vez de un tono cuadrado --
            // evita el "click" audible de subir/bajar el volumen de golpe.
            gain.gain.setValueAtTime(0.0001, t)
            gain.gain.exponentialRampToValueAtTime(0.2, t + 0.02)
            gain.gain.exponentialRampToValueAtTime(0.0001, t + noteDurationMs / 1000)
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.start(t)
            osc.stop(t + noteDurationMs / 1000)
            t += noteDurationMs / 1000
        })
        window.setTimeout(
            () => {
                ctx.close().catch(() => {})
            },
            frequencies.length * noteDurationMs + 150
        )
    } catch {
        // Best-effort -- algunos navegadores exigen un gesto del usuario
        // antes de permitir audio; si falla, la guía visual sigue igual.
    }
}

/** Tono corto y neutro: se arma un reto nuevo. */
export function playChallengeArmedTone(): void {
    playTone([440], 120)
}

/** Dos notas ascendentes (Do5 -> Sol5): refuerzo auditivo de "correcto",
 * perceptible aunque la síntesis de voz no esté disponible. */
export function playChallengeSuccessTone(): void {
    playTone([523.25, 783.99], 130)
}

/** Una nota grave: reintento/timeout -- deliberadamente distinta en tono del
 * éxito, para que la diferencia se perciba incluso sin mirar la pantalla. */
export function playChallengeRetryTone(): void {
    playTone([311.13], 220)
}
