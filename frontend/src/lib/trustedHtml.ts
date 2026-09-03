/**
 * trustedHtml.ts — Puente a la Trusted Types API para los 3 sinks reales de
 * innerHTML/`<style>` del frontend.
 *
 * Contexto (endurecimiento post red-team, ADR-133/134): la CSP ahora exige
 * `require-trusted-types-for 'script'` + `trusted-types beemetry-html`
 * (router.cpp / frontend/nginx.conf). Con eso activo, CUALQUIER asignación a
 * `.innerHTML`/`.outerHTML`/`<style>` (incluida una inyectada por un XSS que
 * lograra ejecutar JS, o por una dependencia npm comprometida) que NO pase
 * por la política nombrada aquí es rechazada por el propio navegador con
 * `TypeError`, sin importar lo que el código intente escribir. Es la
 * diferencia entre "confiamos en que el código haga lo correcto" (sanitizeHtml.ts,
 * que sigue siendo la sanitización real) y "el navegador lo hace cumplir aunque
 * el código se equivoque o sea código nuevo que nadie audite después".
 *
 * La política es de solo-paso (`createHTML: (s) => s`): NO vuelve a sanitizar
 * -- cada llamador es responsable de sanear ANTES de pasar el string aquí
 * (ver sanitizeRichHtml en los 2 sinks de contenido de usuario; el tercero,
 * el `<style>` de MiningDashboard.tsx, es un literal estático del código
 * fuente, nunca dato de usuario). Duplicar la sanitización aquí sería
 * redundante y, peor, daría una falsa sensación de que basta con pasar por
 * esta función para estar seguro sin importar el origen del string.
 */

type TrustedTypesPolicy = { createHTML(input: string): TrustedHTML };
type TrustedTypesWindow = Window & {
    trustedTypes?: {
        createPolicy(name: string, rules: { createHTML: (s: string) => string }): TrustedTypesPolicy;
    };
};

let policy: TrustedTypesPolicy | null | undefined;

function getPolicy(): TrustedTypesPolicy | null {
    if (policy !== undefined) return policy;
    const tt = (typeof window !== 'undefined' ? (window as TrustedTypesWindow).trustedTypes : undefined);
    if (!tt) {
        // Navegador sin soporte de Trusted Types (Firefox/Safari a la fecha de
        // este comentario): la CSP `require-trusted-types-for` simplemente no
        // se aplica ahí -- se sigue asignando el string tal cual, el mismo
        // comportamiento de siempre antes de este endurecimiento.
        policy = null;
        return policy;
    }
    try {
        policy = tt.createPolicy('beemetry-html', { createHTML: (s: string) => s });
    } catch {
        // Un segundo intento de crear la MISMA política nombrada (p.ej. HMR en
        // desarrollo) lanza si la CSP no permite duplicados -- degradar a "sin
        // Trusted Types" en vez de romper el render.
        policy = null;
    }
    return policy;
}

/**
 * Envuelve un string YA SANEADO (o un literal estático del propio código, sin
 * dato de usuario) para asignarlo a `dangerouslySetInnerHTML`/`el.innerHTML`
 * bajo una CSP con Trusted Types activo. Sin Trusted Types en el navegador,
 * es un passthrough transparente.
 */
export function toTrustedHtml(html: string): string | TrustedHTML {
    const p = getPolicy();
    return (p ? p.createHTML(html) : html) as string | TrustedHTML;
}
