'use client';

import React, { useRef, useMemo } from 'react';
import { useFrame, extend } from '@react-three/fiber';
import * as THREE from 'three';

// Extend Three.js with Points material for TypeScript
extend({ Points: THREE.Points, BufferGeometry: THREE.BufferGeometry, PointsMaterial: THREE.PointsMaterial });

interface GalaxyBackgroundProps {
  count?: number;
  position?: [number, number, number];
}

export default function GalaxyBackground({ count = 8000, position = [0, 0, -800] }: GalaxyBackgroundProps) {
  const pointsRef = useRef<THREE.Points>(null);
  
  const { positions, sizes, colors } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    
    // Generate all particles in a distant, flat-ish star layer (kept behind the scene)
    for (let i = 0; i < count; i++) {
      // Spread over a large, distant layer so it doesn't sit inside the graph
      const radius = 1200 + Math.random() * 600; // very far
      const theta = Math.random() * 2 * Math.PI;
      const yOffset = (Math.random() - 0.5) * 150; // mild thickness

      const x = radius * Math.cos(theta);
      const y = yOffset;
      const z = radius * Math.sin(theta);

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      sizes[i] = Math.random() * 0.8 + 0.2;

      // Cool, subtle palette (cyan/teal) — avoid yellow/purple
      const t = Math.random();
      const r = 0.25 + 0.15 * t; // low red
      const g = 0.55 + 0.25 * t; // green/teal
      const b = 0.85 + 0.10 * t; // blue/cyan

      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }
    
    return { positions, sizes, colors };
  }, [count]);

  useFrame((state) => {
    if (pointsRef.current) {
      // Slow rotation for subtle parallax
      pointsRef.current.rotation.y = state.clock.elapsedTime * 0.005;
    }
  });

  const material = useMemo(() => {
    return new THREE.PointsMaterial({
      size: 0.06,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      opacity: 0.35,
    });
  }, []);

  return (
    <points ref={pointsRef} position={position} rotation={[0, 0, 0.2]}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
        <bufferAttribute
          attach="attributes-size"
          args={[sizes, 1]}
        />
        <bufferAttribute
          attach="attributes-color"
          args={[colors, 3]}
        />
      </bufferGeometry>
      <primitive object={material} />
    </points>
  );
}
