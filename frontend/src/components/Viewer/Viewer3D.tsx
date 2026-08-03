import React, { memo, Suspense, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls as OrbitControlsImpl, Text, Line } from '@react-three/drei'
import * as THREE from 'three'

// Tipos de three-stdlib/drei no exponen dampingFactor pese a ser una prop válida en runtime.
const OrbitControls = OrbitControlsImpl as React.ComponentType<any>;

const TIMESTAMPS_COUNT = 13;
const COLORS = [
    '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#f43f5e',
    '#06b6d4', '#84cc16', '#a855f7', '#6366f1', '#14b8a6', '#f97316', '#64748b'
];

const DEPTH_LABELS = [
    { d: 1, l: "1.000" },
    { d: 6.5, l: "6.500" },
    { d: 12, l: "12.000" },
    { d: 17.5, l: "17.500" },
    { d: 23, l: "23.000" },
    { d: 28.5, l: "28.500" },
    { d: 34, l: "34.000" },
    { d: 39.5, l: "39.500" }
];

const GRID_VALUES_X = [-40, -20, 0, 20, 40];
const GRID_VALUES_Y = [0, 10, 20, 30, 40];

interface TrajectoriesProps {
    azimuthAngle?: number;
    installationAngle?: number;
}

const Trajectories = ({ azimuthAngle = 0, installationAngle = 0 }: TrajectoriesProps) => {
    // Generate base steps once to ensure stability during rotation
    const baseSteps = useMemo(() => {
        return Array.from({ length: TIMESTAMPS_COUNT }, (_, j) => {
            const steps: { x: number; z: number }[] = [];
            const baseCurveX = (j % 3) - 1;
            const baseCurveZ = (j % 2) - 0.5;

            for (let d = 0; d < 41; d++) {
                if (d <= 2) {
                    steps.push({ x: 0, z: 0 });
                } else {
                    // Use a pseudo-random seed based on timestamp index for stability
                    const seed = (d * 0.123 + j * 0.456);
                    const stepX = (Math.sin(seed) * 0.3) + baseCurveX * 0.2;
                    const stepZ = (Math.cos(seed * 0.8) * 0.3) + baseCurveZ * 0.2;
                    steps.push({ x: stepX, z: stepZ });
                }
            }
            return steps;
        });
    }, []);

    const lines = useMemo(() => {
        const rad = ((installationAngle + azimuthAngle) * Math.PI) / 180;

        return baseSteps.map((steps) => {
            const tempPoints: { x: number; z: number; d: number }[] = [];
            let currentX = 0;
            let currentZ = 0;

            steps.forEach((step, d) => {
                // Apply rotation to the base steps
                const rotatedStepX = step.x * Math.cos(rad) - step.z * Math.sin(rad);
                const rotatedStepZ = step.x * Math.sin(rad) + step.z * Math.cos(rad);

                currentX += rotatedStepX;
                currentZ += rotatedStepZ;
                tempPoints.push({ x: currentX, z: currentZ, d });
            });

            // Anchor at depth=40 (bottom)
            const anchorX = tempPoints[40].x;
            const anchorZ = tempPoints[40].z;

            // X Scale: 80mm -> 30 units (factor 0.375)
            // Y Scale: 40m -> 15 units (factor 0.375)
            // Z Scale: 40mm -> 30 units (factor 0.75)
            // Visual mapping: [X, Vertical_Depth, Z_displacement]
            return tempPoints.map(p => new THREE.Vector3(
                (p.x - anchorX) * 0.375,
                -(p.d) * 0.375,
                (p.z - anchorZ) * 0.75
            ));
        });
    }, [baseSteps, azimuthAngle, installationAngle]);

    return (
        <group>
            {lines.map((points, i) => (
                <Line
                    key={i}
                    points={points}
                    color={COLORS[i % COLORS.length]}
                    lineWidth={1.5}
                    transparent
                    opacity={0.8}
                />
            ))}
        </group>
    );
}

const TechnicalCage = () => {
    // 3X Scale factor applied
    return (
        <group>
            {/* Prism Frame - size 30x30x15 (from -15 to 15 horizontally, 0 to -15 vertically) */}
            {[[-15, 15], [15, 15], [15, -15], [-15, -15]].map(([x, z], i) => (
                <Line
                    key={`vert-${i}`}
                    points={[[x, 0, z], [x, -15, z]]} // 3x depth
                    color="#64748b"
                    lineWidth={1}
                />
            ))}

            {/* Horizontal Planes (multiplied by 3: 0, -1.875, -3.75, ...) */}
            {[0, -1.875, -3.75, -5.625, -7.5, -9.375, -11.25, -13.125, -15].map((y) => (
                <group key={`h-${y}`} position={[0, y, 0]}>
                    <Line
                        points={[[-15, 0, 15], [15, 0, 15], [15, 0, -15], [-15, 0, -15], [-15, 0, 15]]}
                        color="#475569"
                        lineWidth={0.5}
                        transparent
                        opacity={0.55}
                    />
                    <gridHelper args={[30, 8, 0x334155, 0x1e293b]} />
                </group>
            ))}

            {/* Depth Labels aligned to the left edge */}
            {DEPTH_LABELS.map(({ d, l }) => (
                <Text
                    key={l}
                    position={[-16.5, -d * 0.375, 15]} // multiplied by 3
                    fontSize={1.2}
                    color="#94a3b8"
                    anchorX="right"
                >
                    {l}
                </Text>
            ))}

            {/* Scale Labels X */}
            {GRID_VALUES_X.map((val) => (
                <Text
                    key={`x-v-${val}`}
                    position={[val * 0.375, 1.5, 15]} // multiplied by 3
                    fontSize={0.9}
                    color="#cbd5e1"
                >
                    {val === 0 ? "0.00" : val.toFixed(2)}
                </Text>
            ))}

            {/* Scale Labels Y */}
            {GRID_VALUES_Y.map((val) => (
                <Text
                    key={`y-v-${val}`}
                    position={[16.5, 1.5, (val - 20) * 0.75]} // multiplied by 3
                    fontSize={0.9}
                    color="#cbd5e1"
                    rotation={[-Math.PI / 2, 0, Math.PI / 2]}
                >
                    {val.toFixed(2)}
                </Text>
            ))}
        </group>
    );
}

interface Viewer3DProps {
    azimuthAngle?: number;
    installationAngle?: number;
}

const Viewer3D = ({ azimuthAngle = 0, installationAngle = 0 }: Viewer3DProps) => {
    return (
        <div className="relative flex h-full min-h-0 min-w-0 w-full flex-1 flex-col bg-slate-950">
            <Canvas className="block min-h-0 flex-1 touch-none" style={{ minHeight: 0 }} camera={{ position: [40, 20, 40], fov: 45 }} gl={{ alpha: false, antialias: true }}>
                <color attach="background" args={['#0b1220']} />
                <ambientLight intensity={0.85} />
                <pointLight position={[20, 20, 20]} intensity={1.1} />
                <pointLight position={[-18, 8, -12]} intensity={0.35} color="#38bdf8" />

                <Suspense fallback={null}>
                    <group position={[0, 9, 0]}> {/* Centered for 15-unit height prism */}
                        <Trajectories azimuthAngle={azimuthAngle} installationAngle={installationAngle} />
                        <TechnicalCage />
                        {/* Ideal Center Reference */}
                        <Line
                            points={[[0, 0, 0], [0, -15, 0]]}
                            color="#fcd34d"
                            lineWidth={1}
                            transparent
                            opacity={0.3}
                        />
                    </group>
                </Suspense>

                <OrbitControls makeDefault enableDamping dampingFactor={0.05} />
            </Canvas>

            {/* Fixed UI Overlays */}
            <div className="pointer-events-none absolute left-3 top-1/2 z-10 max-w-[8rem] -translate-y-1/2 -rotate-90 text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400 sm:left-6 sm:text-[10px]">
                Profundidad (m)
            </div>

            <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 max-w-[40%] -translate-x-1/2 text-center text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400 sm:bottom-4 sm:text-[10px]">
                Desplazamiento X (mm)
            </div>

            <div className="pointer-events-none absolute bottom-3 right-[12%] z-10 hidden max-w-[30%] text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400 sm:block sm:text-[10px] md:right-[18%]">
                Desplazamiento Y (mm)
            </div>
        </div>
    )
}

export default memo(Viewer3D)
