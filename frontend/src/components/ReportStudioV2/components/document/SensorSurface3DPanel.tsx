import React, { memo, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls as OrbitControlsImpl } from '@react-three/drei';
import * as THREE from 'three';

// Mismo criterio pragmático que Viewer3D.tsx (src/components/Viewer/): los
// tipos de three-stdlib/drei no exponen dampingFactor/autoRotate pese a ser
// props válidas en runtime.
const OrbitControls = OrbitControlsImpl as React.ComponentType<any>;

export interface Surface3DPoint {
  xi: number;
  yi: number;
  z: number;
}

interface SensorSurface3DPanelProps {
  xCats: string[];
  yCats: string[];
  yColors: string[];
  data: Surface3DPoint[];
  unit?: string;
  /** Se llama apenas WebGL pinta el primer frame real -- alimenta
   * `data-export-ready` en SensorMultiChartWidget.tsx, para que la captura
   * de exportación no dispare sobre un canvas todavía sin contenido. */
  onReady?: () => void;
}

// Mismo degradé frío→cálido que usaba la versión echarts-gl (visualMap),
// reimplementado a mano porque acá no hay ECharts detrás.
const RAMP_HEX = ['#313695', '#4575b4', '#74add1', '#e0f3f8', '#fee090', '#f46d43', '#a50026'];
const RAMP = RAMP_HEX.map((c) => new THREE.Color(c));

function rampColor(t: number): THREE.Color {
  const clamped = Math.min(1, Math.max(0, t));
  const scaled = clamped * (RAMP.length - 1);
  const i = Math.floor(scaled);
  const frac = scaled - i;
  const a = RAMP[i];
  const b = RAMP[Math.min(RAMP.length - 1, i + 1)];
  return a.clone().lerp(b, frac);
}

const SURFACE_WIDTH = 20;
const SURFACE_DEPTH = 12;
const SURFACE_HEIGHT = 6;

function SurfaceMesh({ xCats, yCats, data }: { xCats: string[]; yCats: string[]; data: Surface3DPoint[] }) {
  const geometry = useMemo(() => {
    const nx = Math.max(1, xCats.length);
    const ny = Math.max(1, yCats.length);
    const grid = new Map<string, number>();
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of data) {
      grid.set(`${p.xi}:${p.yi}`, p.z);
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    if (!Number.isFinite(minZ)) {
      minZ = 0;
      maxZ = 1;
    }
    const span = Math.max(1e-6, maxZ - minZ);
    const geo = new THREE.PlaneGeometry(SURFACE_WIDTH, SURFACE_DEPTH, Math.max(1, nx - 1), Math.max(1, ny - 1));
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let yi = 0; yi < ny; yi++) {
      for (let xi = 0; xi < nx; xi++) {
        const idx = yi * nx + xi;
        const z = grid.get(`${xi}:${yi}`) ?? minZ;
        const norm = (z - minZ) / span;
        pos.setY(idx, norm * SURFACE_HEIGHT);
        const c = rampColor(norm);
        colors[idx * 3] = c.r;
        colors[idx * 3 + 1] = c.g;
        colors[idx * 3 + 2] = c.b;
      }
    }
    pos.needsUpdate = true;
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  }, [xCats, yCats, data]);

  const wireGeometry = useMemo(() => new THREE.WireframeGeometry(geometry), [geometry]);

  return (
    <group>
      <mesh geometry={geometry}>
        <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.65} metalness={0.05} />
      </mesh>
      <lineSegments geometry={wireGeometry}>
        <lineBasicMaterial color="#0f172a" transparent opacity={0.18} />
      </lineSegments>
    </group>
  );
}

/**
 * Tipo "Superficie (3D)" -- reemplaza el intento inicial con `echarts-gl`
 * (revertido: esa librería requiere el permiso CSP `'unsafe-eval'` porque
 * arma su pipeline de post-procesado con `new Function(...)`, algo que la
 * política de seguridad del sitio deniega a propósito -- ver
 * nginx.conf/Content-Security-Policy. Debilitar el CSP para toda la
 * plataforma por un solo tipo de gráfico no es un intercambio razonable).
 * Three.js (ya usado en Viewer3D.tsx sin ningún conflicto de CSP, y
 * confirmado sin una sola llamada a `eval`/`new Function` en las 53 mil
 * líneas de su código fuente) construye la malla a mano: grilla
 * tiempo × sensor × valor, altura y color por vértice según el valor.
 */
function SensorSurface3DPanel({ xCats, yCats, data, onReady }: SensorSurface3DPanelProps) {
  return (
    <div
      className="sensor-surface3d-interactive"
      style={{ position: 'relative', width: '100%', height: '100%', minHeight: 140, background: '#0b1220', borderRadius: 6, overflow: 'hidden', pointerEvents: 'auto' }}
    >
      {/* `preserveDrawingBuffer: true` -- sin esto, el panel sale NEGRO SÓLIDO
         en la exportación a PDF (aunque se ve y captura bien en pantalla y en
         la exportación a DOCX). Causa: el pipeline de PDF usa `page.pdf()` de
         Chromium (impresión nativa del navegador) para TODA la página,
         mientras que DOCX captura este panel puntual con
         `elementHandle.screenshot()` -- por defecto WebGL descarta/intercambia
         su framebuffer después de cada frame ("drawing buffer"), así que
         `elementHandle.screenshot()` (que lee el frame recién compuesto)
         funciona por suerte de timing, pero `page.pdf()` compone la página
         en un momento distinto del pipeline de impresión donde ese buffer ya
         puede estar vacío. `preserveDrawingBuffer: true` le dice a WebGL que
         NO lo descarte, a costa de un pequeño overhead de memoria -- el fix
         estándar para "el canvas WebGL sale en blanco/negro al hacer
         screenshot/imprimir". */}
      <Canvas
        camera={{ position: [16, 14, 16], fov: 45 }}
        gl={{ alpha: false, antialias: true, preserveDrawingBuffer: true }}
        onCreated={({ gl, scene, camera }) => {
          // Fuerza un render síncrono inmediato antes de avisar "listo" --
          // `preserveDrawingBuffer` (arriba) solo evita que el frame YA
          // pintado se descarte, no garantiza que exista uno todavía en el
          // instante en que `onCreated` dispara (WebGL recién inicializado,
          // el primer frame del loop de r3f puede llegar un tick después).
          gl.render(scene, camera);
          onReady?.();
        }}
      >
        <color attach="background" args={['#0b1220']} />
        <ambientLight intensity={0.9} />
        <pointLight position={[15, 15, 15]} intensity={1} />
        <pointLight position={[-10, 8, -10]} intensity={0.3} color="#38bdf8" />
        <SurfaceMesh xCats={xCats} yCats={yCats} data={data} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} autoRotate autoRotateSpeed={1.2} />
      </Canvas>
      <div
        style={{
          position: 'absolute',
          bottom: 4,
          left: 6,
          fontSize: 8,
          color: 'rgba(255,255,255,0.65)',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.3,
        }}
      >
        Eje X: tiempo · Eje Z: sensor · Altura/color: valor
      </div>
    </div>
  );
}

export default memo(SensorSurface3DPanel);
