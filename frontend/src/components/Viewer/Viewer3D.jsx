import React, { Suspense, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Stars, Text, Line } from '@react-three/drei'
import * as THREE from 'three'

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

const Trajectories = ({ azimuthAngle = 0, installationAngle = 0 }) => {
    // Generate base steps once to ensure stability during rotation
    const baseSteps = useMemo(() => {
        return Array.from({ length: TIMESTAMPS_COUNT }, (_, j) => {
            const steps = [];
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

        return baseSteps.map((steps, j) => {
            const tempPoints = [];
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
                    color="#cbd5e1"
                    lineWidth={1}
                />
            ))}

            {/* Horizontal Planes (multiplied by 3: 0, -1.875, -3.75, ...) */}
            {[0, -1.875, -3.75, -5.625, -7.5, -9.375, -11.25, -13.125, -15].map((y) => (
                <group key={`h-${y}`} position={[0, y, 0]}>
                    <Line
                        points={[[-15, 0, 15], [15, 0, 15], [15, 0, -15], [-15, 0, -15], [-15, 0, 15]]}
                        color="#cbd5e1"
                        lineWidth={0.5}
                        transparent
                        opacity={0.5}
                    />
                    <gridHelper args={[30, 8, 0xe2e8f0, 0xf8fafc]} />
                </group>
            ))}

            {/* Depth Labels aligned to the left edge */}
            {DEPTH_LABELS.map(({ d, l }) => (
                <Text
                    key={l}
                    position={[-16.5, -d * 0.375, 15]} // multiplied by 3
                    fontSize={1.2}
                    color="#64748b"
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
                    color="#94a3b8"
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
                    color="#94a3b8"
                    rotation={[-Math.PI / 2, 0, Math.PI / 2]}
                >
                    {val.toFixed(2)}
                </Text>
            ))}
        </group>
    );
}


const Viewer3D = ({ azimuthAngle = 0, installationAngle = 0 }) => {
    return (
        <div className="w-full h-full bg-white relative">
            <Canvas camera={{ position: [40, 20, 40], fov: 45 }} gl={{ alpha: true, antialias: true }}>
                <color attach="background" args={['#ffffff']} />
                <ambientLight intensity={1.5} />
                <pointLight position={[20, 20, 20]} intensity={1} />

                <Suspense fallback={null}>
                    <group position={[0, 9, 0]}> {/* Centered for 15-unit height prism */}
                        <Trajectories azimuthAngle={azimuthAngle} />
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
            <div className="absolute left-10 top-1/2 -translate-y-1/2 -rotate-90 text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em] whitespace-nowrap pointer-events-none">
                Depth m
            </div>

            <div className="absolute bottom-10 left-[45%] text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em] pointer-events-none">
                Displacement X mm
            </div>

            <div className="absolute bottom-10 right-[25%] text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em] pointer-events-none">
                Displacement Y mm
            </div>
        </div>
    )
}

export default Viewer3D
