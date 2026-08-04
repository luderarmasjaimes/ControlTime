import { describe, expect, it } from 'vitest'
import { sanitizeRichHtml } from './sanitizeHtml'

describe('sanitizeRichHtml', () => {
    it('conserva el formato legítimo que produce el editor de celdas', () => {
        const clean = sanitizeRichHtml('<b>Cota</b> <i>±</i> <span style="color:#F07E41">2.5 m</span>')
        expect(clean).toContain('<b>Cota</b>')
        expect(clean).toContain('<i>±</i>')
        expect(clean).toContain('color:#F07E41')
    })

    it('elimina script y manejadores de eventos', () => {
        const clean = sanitizeRichHtml('<script>alert(1)</script><b onclick="alert(2)">x</b>')
        expect(clean).not.toContain('<script')
        expect(clean).not.toContain('onclick')
        expect(clean).toContain('x')
    })

    it('elimina href con esquema javascript:', () => {
        const clean = sanitizeRichHtml('<a href="javascript:alert(1)">clic</a>')
        expect(clean).not.toContain('javascript:')
    })

    // Regresión (auditoría de seguridad 2026-08-02): el patrón anclado anterior
    // solo toleraba espacios DELANTE del esquema, así que un carácter de control
    // INTERCALADO lo esquivaba. El navegador sí elimina esos caracteres antes de
    // resolver la URL, de modo que el enlace acababa ejecutándose al hacer clic.
    it('elimina href con javascript: ofuscado por caracteres de control', () => {
        // Separadores que el navegador descarta al resolver el esquema de una URL.
        const separators = [
            String.fromCharCode(0x09),  // tab
            String.fromCharCode(0x0a),  // LF
            String.fromCharCode(0x0d),  // CR
            String.fromCharCode(0x00),  // NUL
            String.fromCharCode(0x20),  // espacio
            String.fromCharCode(0x0b),  // vertical tab
        ]
        const payloads = [
            ...separators.map((sep) => `<a href="java${sep}script:alert(1)">x</a>`),
            '<a href="java&#9;script:alert(1)">e</a>',
            '<a href="java&#10;script:alert(1)">d</a>',
            `<a href="  ${String.fromCharCode(0x09)} javascript:alert(1)">s</a>`,
        ]
        for (const payload of payloads) {
            const clean = sanitizeRichHtml(payload)
            expect(clean).not.toMatch(/href/i)
        }
    })

    it('elimina esquemas vbscript:, data: y file: igualmente ofuscados', () => {
        expect(sanitizeRichHtml('<a href="vb\tscript:msgbox(1)">x</a>')).not.toMatch(/href/i)
        expect(sanitizeRichHtml('<a href="da\nta:text/html,<script>1</script>">x</a>')).not.toMatch(/href/i)
        expect(sanitizeRichHtml('<a href="fi\tle:///etc/passwd">x</a>')).not.toMatch(/href/i)
    })

    it('conserva enlaces http(s) normales y los aísla con rel', () => {
        const clean = sanitizeRichHtml('<a href="https://minera.example/informe">ver</a>')
        expect(clean).toContain('https://minera.example/informe')
        expect(clean).toContain('noopener')
    })
})
