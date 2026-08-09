/**
 * Sanitizador de HTML enriquecido — allowlist mínima, sin dependencias.
 *
 * Motivo (auditoría de seguridad 2026-07-19): las celdas de tabla del editor
 * de informes son `contentEditable` y su contenido se guarda como HTML CRUDO
 * (`onChange(el.innerHTML)`) y se re-siembra con `el.innerHTML = value`
 * (TableBlock.tsx). Un usuario podía pegar `<img src=x onerror="…">` en una
 * celda; al guardarse el informe y abrirlo OTRO usuario en el editor (flujo
 * borrador→revisión→firma con varios editores/aprobadores), el payload
 * ejecutaba en el navegador del segundo usuario — XSS almacenado contra
 * colaboradores. Y como access+refresh token viven en localStorage
 * (authStorage.ts), un XSS permite robo de sesión persistente. El
 * ReadOnlyViewer y el export PDF renderizan la celda como texto de React
 * (auto-escapado) y NO eran vulnerables; el vector es exclusivamente el
 * sink `innerHTML` del editor.
 *
 * Se sanea en AMBOS extremos: al renderizar (defiende de datos ya
 * envenenados en la BD) y al persistir (limpia lo nuevo). Se permite solo
 * el formato que produce execCommand en las celdas (negrita/cursiva/
 * subrayado/color/tamaño vía `<b> <i> <u> <span style> <br>`…); se elimina
 * todo lo ejecutable: `<script> <iframe> <object>`, atributos `on*`,
 * `style` con `expression()`/`url(javascript:)`, y `href/src` con esquemas
 * `javascript:`/`vbscript:`/`data:` (salvo `data:image/` en `src`).
 */

// Etiquetas de formato permitidas (las que genera el editor de celdas).
const ALLOWED_TAGS = new Set([
    'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'SUB', 'SUP',
    'SPAN', 'DIV', 'P', 'BR', 'FONT', 'A', 'UL', 'OL', 'LI',
    'SMALL', 'MARK', 'CODE',
]);

// Atributos permitidos por etiqueta (además de estos, `style` se filtra
// aparte). Cualquier otro atributo se elimina.
const ALLOWED_ATTRS = new Set(['style', 'color', 'face', 'size', 'href', 'target', 'rel']);

const DANGEROUS_URI = /^(javascript|vbscript|data|file):/i;

/**
 * Normaliza una URI antes de comprobar su esquema.
 *
 * El navegador ELIMINA tabuladores, saltos de línea y retornos de carro de una
 * URL antes de resolver el esquema (HTML Standard, "strip and collapse ASCII
 * whitespace"), y DOMParser ya ha decodificado las entidades HTML cuando
 * leemos `attr.value`. Por eso `href="java&#9;script:alert(1)"` llega aquí
 * como `java\tscript:alert(1)`: un patrón anclado que solo tolera espacios
 * DELANTE no casa, el atributo sobrevive al saneado y el navegador lo ejecuta
 * igualmente al hacer clic. Se quita todo carácter de control e insignificante
 * (incluido NUL, que algunos parsers también ignoran) antes de comparar.
 */
// Puntos de codigo que el navegador ignora al resolver el esquema de una URL y
// que por tanto no deben "romper" la comparacion: espacio en blanco ASCII y de
// control (0x00-0x20, 0x7F-0xA0), soft hyphen, marcas de ancho cero, espacios
// Unicode invisibles, espacio ideografico y BOM. Se comprueba por codigo en vez
// de con una clase de regex para no incrustar caracteres de control literales en
// el fuente: son invisibles al revisar un diff y basta un editor que los
// normalice para desactivar la defensa sin que nadie lo note.
function isIgnorableUriChar(code: number): boolean {
    if (code <= 0x20) return true;                       // control C0 + espacio
    if (code >= 0x7f && code <= 0xa0) return true;       // DEL + control C1 + NBSP
    if (code === 0xad) return true;                      // soft hyphen
    if (code === 0x1680) return true;                    // ogham space mark
    if (code >= 0x2000 && code <= 0x200d) return true;   // espacios tipograficos + zero-width
    if (code === 0x2028 || code === 0x2029) return true; // separadores de linea/parrafo
    if (code === 0x202f || code === 0x205f) return true; // narrow/medium NBSP
    if (code === 0x3000) return true;                    // espacio ideografico
    if (code === 0xfeff) return true;                    // BOM / zero-width no-break
    // U+FFFD: el tokenizador HTML sustituye NUL por este carácter, así que un
    // payload "java\0script:" llega al DOM como "java�script:". Ahí ya no
    // es un esquema válido, pero se descarta igual para no depender de ese
    // detalle del parser — otro motor podría dejar pasar el NUL tal cual.
    if (code === 0xfffd) return true;
    return false;
}

function normalizeUri(value: string): string {
    let out = '';
    for (let i = 0; i < value.length; i += 1) {
        if (!isIgnorableUriChar(value.charCodeAt(i))) out += value[i];
    }
    return out;
}

function sanitizeStyle(value: string): string {
    // Rechaza declaraciones peligrosas dentro de style="…":
    // expression(), url(javascript:…), y cualquier url() con esquema no
    // http(s)/data-imagen. Conserva color/background/font/etc.
    if (/expression\s*\(|javascript:|vbscript:/i.test(value)) return '';
    return value
        .split(';')
        .filter((decl) => {
            const m = /url\s*\(([^)]*)\)/i.exec(decl);
            if (!m) return true;
            const uri = m[1].replace(/['"]/g, '').trim();
            return /^(https?:|data:image\/)/i.test(uri);
        })
        .join(';');
}

function scrubElement(el: Element): void {
    // Recorrer hijos primero (copia estática: vamos a mutar el árbol).
    Array.from(el.children).forEach(scrubElement);

    if (!ALLOWED_TAGS.has(el.tagName)) {
        // Etiqueta no permitida: se desenrolla (se conservan sus hijos ya
        // saneados como texto/nodos) en vez de borrar su contenido —
        // preserva el texto visible del usuario sin ejecutar la etiqueta.
        const parent = el.parentNode;
        if (parent) {
            while (el.firstChild) parent.insertBefore(el.firstChild, el);
            parent.removeChild(el);
        }
        return;
    }

    for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        // Todo manejador de eventos on* fuera, sin excepción.
        if (name.startsWith('on') || !ALLOWED_ATTRS.has(name)) {
            el.removeAttribute(attr.name);
            continue;
        }
        if (name === 'style') {
            const clean = sanitizeStyle(attr.value);
            if (clean) el.setAttribute('style', clean);
            else el.removeAttribute('style');
        } else if (name === 'href' || name === 'src') {
            // Se evalúa la forma NORMALIZADA (sin control chars ni espacios
            // invisibles), que es la que el navegador resuelve realmente.
            const uri = normalizeUri(attr.value);
            // data:image/ en src sí se permite; el resto de esquemas peligrosos fuera.
            if (DANGEROUS_URI.test(uri) && !(name === 'src' && /^data:image\//i.test(uri))) {
                el.removeAttribute(attr.name);
            }
        }
    }

    // Todo <a> con destino se abre aislado (sin acceso a window.opener).
    if (el.tagName === 'A' && el.getAttribute('href')) {
        el.setAttribute('rel', 'noopener noreferrer nofollow');
    }
}

/**
 * Devuelve una versión saneada del HTML (allowlist). Segura para asignar a
 * `element.innerHTML`. Fuera del navegador (SSR/tests sin DOM) devuelve el
 * texto sin etiquetas como último recurso.
 */
export function sanitizeRichHtml(dirty: string): string {
    if (!dirty) return '';
    if (typeof document === 'undefined' || typeof DOMParser === 'undefined') {
        // Sin DOM: degradar a texto plano (escapar) — nunca devolver HTML crudo.
        return String(dirty).replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;'));
    }
    const doc = new DOMParser().parseFromString(`<body>${dirty}</body>`, 'text/html');
    Array.from(doc.body.children).forEach(scrubElement);
    return doc.body.innerHTML;
}
