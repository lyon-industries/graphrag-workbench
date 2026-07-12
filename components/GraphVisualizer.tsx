'use client';

import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Text, Line } from '@react-three/drei';
import * as THREE from 'three';
import { Node3D, Link3D, GraphLayout, calculateLinkThickness } from '../lib/forceSimulation';
import { Community } from '../lib/graphData';
import { AlertCircle, Loader2 } from 'lucide-react';

import GalaxyBackground from './GalaxyBackground';

// Postprocessing via three/examples EffectComposer
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

interface NodeProps {
  node: Node3D;
  isSelected: boolean;
  isHighlighted: boolean;
  isInHierarchy: boolean;
  communityMode: 'off' | 'auto' | 'all';
  hasSelectedNode: boolean;
  sharedMaterial: THREE.ShaderMaterial;
  sharedGeometry: THREE.SphereGeometry;
  onClick: (node: Node3D) => void;
  onPointerOver: (node: Node3D) => void;
  onPointerOut: () => void;
}

// Hook to make objects always face the camera
function useBillboard() {
  const ref = useRef<THREE.Object3D>(null);
  
  useFrame(({ camera }) => {
    if (ref.current) {
      ref.current.lookAt(camera.position);
    }
  });
  
  return ref;
}

function Node({ node, isSelected, isHighlighted, isInHierarchy, communityMode, hasSelectedNode, sharedMaterial, sharedGeometry, onClick, onPointerOver, onPointerOut }: NodeProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const textRef = useBillboard();
  
  // Use pre-computed values for maximum performance
  const size = node.computedSize;

  // Clone the shared material for this node to have independent uniforms
  const nodeMaterial = useMemo(() => {
    if (!sharedMaterial) return null;
    const clonedMaterial = sharedMaterial.clone();
    // Independent uniforms for this node
    clonedMaterial.uniforms = {
      colorCore: { value: new THREE.Color('#7de1ff') },
      colorRim: { value: new THREE.Color('#ff9bd5') },
      time: { value: 0.0 },
      opacity: { value: 0.85 },
    };
    return clonedMaterial;
  }, [sharedMaterial]);

  useFrame((state) => {
    if (meshRef.current) {
      const scale = size * (isSelected ? 1.5 : isHighlighted ? 1.25 : 1.0);
      meshRef.current.scale.setScalar(scale);
    }
    
    // Update this node's material uniforms
    if (nodeMaterial) {
      // Adjust core color on highlight/selection  
      const core = (nodeMaterial.uniforms.colorCore.value as THREE.Color);
      core.set(isSelected ? '#b6f3ff' : '#7de1ff');
      // Fade opacity when not in hierarchy in isolator mode
      const transparent = (hasSelectedNode && communityMode === 'auto' && !isInHierarchy) ? 0.25 : 0.85;
      nodeMaterial.uniforms.opacity.value = transparent;
      nodeMaterial.uniforms.time.value = state.clock.getElapsedTime();
    }
  });

  return (
    <group position={[node.x, node.y, node.z]}>
      <mesh
        ref={meshRef}
        geometry={sharedGeometry}
        onClick={() => onClick(node)}
        onPointerOver={() => onPointerOver(node)}
        onPointerOut={onPointerOut}
        onUpdate={(m) => { m.layers.enable(BLOOM_SCENE); }}
      >
        {/* Attach cloned shader material with independent uniforms */}
        {nodeMaterial ? (
          <primitive object={nodeMaterial} attach="material" />
        ) : (
          <meshStandardMaterial />
        )}
      </mesh>
      {/* Show labels only for hierarchy nodes in isolator mode, or always in normal mode */}
      {(!hasSelectedNode || communityMode !== 'auto' || isInHierarchy) && (
        <group ref={textRef} position={[0, size + 3, 0]}>
          <Text
            fontSize={Math.max(0.8, size * 0.5)}
            color={isSelected || isHighlighted ? "white" : "#cccccc"}
            outlineWidth={0.05}
            outlineColor="black"
            anchorX="center"
            anchorY="middle"
            maxWidth={25}
            textAlign="center"
            userData={{ isText: true }}
          >
            {node.title.length > 25 ? `${node.title.substring(0, 25)}...` : node.title}
          </Text>
        </group>
      )}
    </group>
  );
}

interface LinkProps {
  link: Link3D;
  isHighlighted: boolean;
  communityMode: 'off' | 'auto' | 'all';
  nodesInHierarchy: Set<string>;
  hasSelectedNode: boolean;
}

function Link({ link, isHighlighted, communityMode, nodesInHierarchy, hasSelectedNode }: LinkProps) {
  // Use refs to avoid creating new Vector3 objects unnecessarily
  const sourcePoint = useRef(new THREE.Vector3());
  const targetPoint = useRef(new THREE.Vector3());
  
  const points = useMemo(() => {
    // Reuse existing Vector3 objects and update their values
    sourcePoint.current.set(link.source.x, link.source.y, link.source.z);
    targetPoint.current.set(link.target.x, link.target.y, link.target.z);
    return [sourcePoint.current, targetPoint.current];
  }, [link.source.x, link.source.y, link.source.z, link.target.x, link.target.y, link.target.z]);

  // Pre-calculate thickness once per weight change
  const thickness = useMemo(() => calculateLinkThickness(link.weight), [link.weight]);

  // Memoize opacity calculation to avoid repeated conditional logic
  const opacity = useMemo(() => {
    if (isHighlighted) return 0.95;
    
    if (hasSelectedNode && communityMode === 'auto') {
      const sourceInHierarchy = nodesInHierarchy.has(link.source.id);
      const targetInHierarchy = nodesInHierarchy.has(link.target.id);
      
      // In isolator mode: make edges outside hierarchy transparent like nodes
      if (!sourceInHierarchy || !targetInHierarchy) return 0.25; // Same transparency as nodes
      
      // Both nodes in hierarchy - normal visibility
      return 0.7;
    }
    return 0.7;
  }, [isHighlighted, hasSelectedNode, communityMode, nodesInHierarchy, link.source.id, link.target.id]);

  return (
    <Line
      points={points}
      color={isHighlighted ? "#ffffff" : "#888888"}
      lineWidth={isHighlighted ? thickness * 2 : thickness}
      transparent
      opacity={opacity}
      onUpdate={(m: THREE.Object3D) => {
        if (m && m.layers) m.layers.disable(BLOOM_SCENE);
      }}
    />
  );
}

// Animated energy tube for "hero" edges
function EnergyEdge({ link }: { link: Link3D }) {
  const meshRef = useRef<THREE.Mesh>(null);
  
  // Reuse Vector3 objects for curve points
  const sourcePoint = useRef(new THREE.Vector3());
  const targetPoint = useRef(new THREE.Vector3());
  
  const curve = useMemo(() => {
    sourcePoint.current.set(link.source.x, link.source.y, link.source.z);
    targetPoint.current.set(link.target.x, link.target.y, link.target.z);
    return new THREE.CatmullRomCurve3([sourcePoint.current, targetPoint.current]);
  }, [link.source.x, link.source.y, link.source.z, link.target.x, link.target.y, link.target.z]);

  // Reduce geometry complexity for better performance
  const tubularSegments = 32; // Reduced from 64
  const radius = useMemo(() => Math.max(0.06, calculateLinkThickness(link.weight) * 0.2), [link.weight]);
  const radialSegments = 6; // Reduced from 8  
  const closed = false;

  const mat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: {
      time: { value: 0.0 },
      c1: { value: new THREE.Color('#6be6ff') },
      c2: { value: new THREE.Color('#ff8bcb') },
    },
    vertexShader: `
      varying float vLen;
      void main(){ vLen = position.y; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
    `,
    fragmentShader: `
      uniform float time; uniform vec3 c1,c2; varying float vLen;
      float hash(float x){ return fract(sin(x*12.9898)*43758.5453); }
      void main(){
        float t = fract(vLen*0.1 - time*0.8);
        float band = smoothstep(0.0,0.05,t)*smoothstep(0.2,0.15,t);
        vec3 col = mix(c1,c2, t);
        gl_FragColor = vec4(col*(0.5+band*2.0), 0.7);
      }
    `
  }), []);

  useFrame((state) => {
    ;(mat.uniforms.time as { value: number }).value = state.clock.getElapsedTime();
  });

  return (
    <mesh ref={meshRef} onUpdate={(m) => m.layers.enable(BLOOM_SCENE)}>
      <tubeGeometry args={[curve, tubularSegments, radius, radialSegments, closed]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
}

interface CommunityBoundaryProps {
  community: Community;
  visible: boolean;
  selectedCommunity?: Community;
  communityMode?: 'off' | 'auto' | 'all';
}

function CommunityBoundary({ community, visible, selectedCommunity, communityMode }: CommunityBoundaryProps) {
  // Hooks must be called unconditionally
  const titleRef = useBillboard();
  const sizeRef = useBillboard();

  // Enhanced color scheme for hierarchy visualization (using pre-computed hierarchy)
  const isSelected = selectedCommunity && community.id === selectedCommunity.id;
  const isAncestor = selectedCommunity && selectedCommunity.computedHierarchy && 
    selectedCommunity.computedHierarchy.parentCommunities.some((parent: Community) => parent.id === community.id);
  const isDescendant = selectedCommunity && selectedCommunity.computedHierarchy && 
    selectedCommunity.computedHierarchy.childCommunities.some((child: Community) => child.id === community.id);

  // Color selection based on hierarchy relationship (using pre-computed values when possible)
  let color: string;
  if (isSelected) {
    color = '#ffaa00'; // Bright orange for selected
  } else if (isAncestor) {
    color = '#4a90e2'; // Blue for ancestors
  } else if (isDescendant) {
    color = '#7ed321'; // Green for descendants
  } else {
    // Use pre-computed color for maximum performance
    color = community.computedColor || '#95a5a6';
  }

  // Use the same approach as the working text labels - simple MeshBasicMaterial
  const boundaryMaterial = useMemo(() => {
    // Make community boundaries more visible in isolator mode
    const baseOpacity = isSelected ? 0.25 : isAncestor ? 0.2 : isDescendant ? 0.18 : (community.computedOpacity || 0.15);
    const op = communityMode === 'auto' ? baseOpacity + 0.2 : baseOpacity; // 20% less transparent in isolator mode
    
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: op,
      wireframe: true,
      depthTest: false,
      depthWrite: false,
    });
    // Explicitly disable fog like we did for text
    material.fog = false;
    return material;
  }, [color, communityMode, isSelected, isAncestor, isDescendant, community.computedOpacity]);

  // Early return after hooks computed
  if (!visible || !community.computedBounds) return null;

  // Use pre-computed bounding box for maximum performance
  const bounds = {
    center: community.computedBounds.center,
    size: community.computedBounds.size,
  };

  // Add slight offset based on community level to prevent z-fighting
  const zOffset = community.level * 0.1;
  const offsetPosition: [number, number, number] = [
    bounds.center[0], 
    bounds.center[1], 
    bounds.center[2] + zOffset
  ];

  return (
    <group>
      {/* Enhanced wireframe with z-fighting prevention */}
      <mesh 
        position={offsetPosition}
        renderOrder={999}
        frustumCulled={false}
        onUpdate={(mesh) => {
          if (mesh.material && !Array.isArray(mesh.material)) {
            (mesh.material as THREE.Material & { fog?: boolean }).fog = false;
            // Add to bloom layer to prevent darkening (like nodes do)
            mesh.layers.enable(BLOOM_SCENE);
          }
        }}
      >
        <boxGeometry args={bounds.size} />
        <primitive object={boundaryMaterial} attach="material" />
      </mesh>
      {/* Community Label - with fog resistance */}
      <group ref={titleRef} position={[bounds.center[0], bounds.center[1] + bounds.size[1] / 2 + 8, bounds.center[2]]}>
        <Text
          fontSize={Math.max(1.0, Math.min(3, bounds.size[0] * 0.08))}
          color={color}
          outlineWidth={0.05}
          outlineColor="#ffffff"
          anchorX="center"
          anchorY="bottom"
          maxWidth={bounds.size[0]}
          textAlign="center"
          renderOrder={999}
          frustumCulled={false}
          userData={{ isText: true }}
          onUpdate={(text) => {
            if (text.material && !Array.isArray(text.material)) {
              (text.material as THREE.Material & { fog?: boolean }).fog = false;
            }
          }}
        >
          {`${getLevelLabel(community.level)}: ${community.title}`}
        </Text>
      </group>
      {/* Community Size Info - with fog resistance */}
      <group ref={sizeRef} position={[bounds.center[0], bounds.center[1] + bounds.size[1] / 2 + 4, bounds.center[2]]}>
        <Text
          fontSize={Math.max(1, Math.min(2.5, bounds.size[0] * 0.05))}
          color="#ffffff"
          outlineWidth={0.04}
          outlineColor="#333333"
          anchorX="center"
          anchorY="bottom"
          textAlign="center"
          renderOrder={999}
          frustumCulled={false}
          userData={{ isText: true }}
          onUpdate={(text) => {
            if (text.material && !Array.isArray(text.material)) {
              (text.material as THREE.Material & { fog?: boolean }).fog = false;
            }
          }}
        >
          {`${community.size} entities`}
        </Text>
      </group>
    </group>
  );
}

interface GraphVisualizerProps {
  layout: GraphLayout | null;
  loading: boolean;
  error: string | null;
  status: string;
  onRetry: () => void;
  selectedEntityTypes: Set<string>;
  minRelationshipWeight: number;
  showCommunityBoundaries: boolean;
  visibleCommunities?: Community[];
  communityMode?: 'off' | 'auto' | 'all';
  selectedLevel: number | null;
  onNodeSelect: (node: Node3D | null) => void;
  selectedNode: Node3D | null;
  ragHighlightedNodeIds?: Set<string>;
  searchTerm?: string;
  onNodeHover?: (node: Node3D | null) => void;
  hoveredNode?: Node3D | null;
  viewportOffset?: number;
}

export default function GraphVisualizer({ 
  layout, 
  loading,
  error,
  status,
  onRetry,
  selectedEntityTypes, 
  minRelationshipWeight,
  showCommunityBoundaries,
  visibleCommunities,
  communityMode = 'auto',
  selectedLevel,
  onNodeSelect,
  selectedNode,
  ragHighlightedNodeIds,
  searchTerm = '',
  onNodeHover,
  hoveredNode,
  viewportOffset = 0,
}: GraphVisualizerProps) {
  // All hooks must be called first, before any conditional returns
  const [highlightedLinks, setHighlightedLinks] = useState<Set<string>>(new Set());
  const [autoOrbit, setAutoOrbit] = useState<boolean>(true);
  const [hasInteracted, setHasInteracted] = useState<boolean>(false);
  const orbitControlsRef = useRef<React.ElementRef<typeof OrbitControls> | null>(null);
  
  // Shared materials for performance optimization
  const sharedNodeMaterial = useMemo(() => createSharedNodeMaterial(), []) as unknown as THREE.ShaderMaterial;
  const sharedNodeGeometry = useMemo(() => new THREE.SphereGeometry(1, 32, 32), []);

  useEffect(() => () => sharedNodeGeometry.dispose(), [sharedNodeGeometry]);
  
  // Debounced search term to improve performance
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState(searchTerm);
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300); // 300ms debounce
    
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const postFx: PostFXSettings = {
    bloomEnabled: true,
    bloomStrength: 0.66,
    bloomRadius: 1.35,
    bloomThreshold: 0.20,
    vignetteEnabled: true,
    vignetteStrength: 0.18,
  };

  // Create a set of node IDs that are in the visible communities (hierarchy)
  const nodesInHierarchy = useMemo(() => {
    if (!visibleCommunities || communityMode !== 'auto') {
      return new Set<string>();
    }
    
    const hierarchyNodeIds = new Set<string>();
    visibleCommunities.forEach(community => {
      community.entity_ids.forEach((entityId: string) => {
        hierarchyNodeIds.add(entityId);
      });
    });
    
    return hierarchyNodeIds;
  }, [visibleCommunities, communityMode]);

  const filteredNodes = useMemo(() => {
    if (!layout) return [];
    
    return layout.nodes.filter(node => {
      if (selectedEntityTypes.size > 0 && !selectedEntityTypes.has(node.type)) {
        return false;
      }
      if (selectedLevel !== null && node.communityLevel !== selectedLevel) {
        return false;
      }

      // Show all nodes - search filtering will be handled in Node component rendering
      return true;
    });
  }, [layout, selectedEntityTypes, selectedLevel]);

  // Create set of nodes that match search criteria (using debounced search)
  const searchMatchingNodes = useMemo(() => {
    if (!debouncedSearchTerm.trim()) return new Set<string>();
    
    const searchLower = debouncedSearchTerm.toLowerCase();
    const matchingIds = new Set<string>();
    
    filteredNodes.forEach(node => {
      if (node.title.toLowerCase().includes(searchLower) ||
          node.description.toLowerCase().includes(searchLower)) {
        matchingIds.add(node.id);
      }
    });
    
    return matchingIds;
  }, [filteredNodes, debouncedSearchTerm]);

  const filteredLinks = useMemo(() => {
    if (!layout) return [];
    
    const visibleNodeIds = new Set(filteredNodes.map(node => node.id));
    
    return layout.links.filter(link => {
      if (link.weight < minRelationshipWeight) return false;
      return visibleNodeIds.has(link.source.id) && visibleNodeIds.has(link.target.id);
    });
  }, [layout, filteredNodes, minRelationshipWeight]);

  const orderedNodes = useMemo(() => [...filteredNodes].sort((a, b) => {
    const distanceA = a.x * a.x + a.y * a.y + a.z * a.z;
    const distanceB = b.x * b.x + b.y * b.y + b.z * b.z;
    return distanceA - distanceB || b.degree - a.degree;
  }), [filteredNodes]);

  const [admittedNodeCount, setAdmittedNodeCount] = useState(0);

  useEffect(() => {
    setAdmittedNodeCount(orderedNodes.length ? 1 : 0);
    if (!orderedNodes.length) return;

    let frame = 0;
    const batchSize = Math.max(4, Math.ceil(orderedNodes.length / 36));
    const admit = () => {
      setAdmittedNodeCount(count => {
        const next = Math.min(orderedNodes.length, count + batchSize);
        if (next < orderedNodes.length) frame = requestAnimationFrame(admit);
        return next;
      });
    };
    frame = requestAnimationFrame(admit);
    return () => cancelAnimationFrame(frame);
  }, [orderedNodes]);

  const admittedNodes = useMemo(
    () => orderedNodes.slice(0, admittedNodeCount),
    [admittedNodeCount, orderedNodes]
  );
  const admittedNodeIds = useMemo(() => new Set(admittedNodes.map(node => node.id)), [admittedNodes]);
  const admittedLinks = useMemo(
    () => filteredLinks.filter(link => admittedNodeIds.has(link.source.id) && admittedNodeIds.has(link.target.id)),
    [admittedNodeIds, filteredLinks]
  );

  // Compute a key for Canvas remount when filters change (no extra hooks).
  const canvasKeyStr = `types:${Array.from(selectedEntityTypes).sort().join(',')}|lvl:${selectedLevel ?? 'all'}|w:${minRelationshipWeight}|b:${showCommunityBoundaries ? 1 : 0}`

  const [heroEdgeIds, setHeroEdgeIds] = useState<Set<string>>(new Set());
  // Pick top-weighted edges as "hero" edges for energy tubes
  useEffect(() => {
    if (!layout) return;
    const weights = layout.links.map(l => l.weight).sort((a,b)=>a-b);
    if (weights.length === 0) { setHeroEdgeIds(new Set()); return; }
    const qIndex = Math.floor(weights.length * 0.9); // top 10%
    const threshold = weights[Math.min(weights.length - 1, Math.max(0, qIndex))];
    const ids = new Set(layout.links.filter(l => l.weight >= threshold).map(l => l.id));
    setHeroEdgeIds(ids);
  }, [layout]);

  // Calculate center and bounds of the knowledge graph
  const graphBounds = useMemo(() => {
    if (!layout || !filteredNodes.length) {
      return { 
        center: [0, 0, 0] as [number, number, number],
        size: 200,
        cameraPosition: [100, 100, 100] as [number, number, number]
      };
    }

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    filteredNodes.forEach(node => {
      minX = Math.min(minX, node.x);
      maxX = Math.max(maxX, node.x);
      minY = Math.min(minY, node.y);
      maxY = Math.max(maxY, node.y);
      minZ = Math.min(minZ, node.z);
      maxZ = Math.max(maxZ, node.z);
    });

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = (minZ + maxZ) / 2;
    
    const sizeX = maxX - minX;
    const sizeY = maxY - minY;
    const sizeZ = maxZ - minZ;
    const maxSize = Math.max(sizeX, sizeY, sizeZ);
    
    // Position camera at appropriate distance to see the entire graph
    const distance = Math.max(maxSize * 1.2, 200);
    
    return {
      center: [centerX, centerY, centerZ] as [number, number, number],
      size: maxSize,
      cameraPosition: [centerX + distance * 0.7, centerY + distance * 0.7, centerZ + distance * 0.7] as [number, number, number]
    };
  }, [filteredNodes, layout]);

  // Clear highlighted links when no node is selected
  useEffect(() => {
    if (!selectedNode) {
      setHighlightedLinks(new Set());
    }
  }, [selectedNode]);


  // Detect user interaction to stop auto-orbit
  const handleUserInteraction = () => {
    if (!hasInteracted) {
      setHasInteracted(true);
      setAutoOrbit(false);
    }
  };

  // Event handlers
  const handleNodeClick = (node: Node3D) => {
    onNodeSelect(node);
    
    // Highlight connected links
    const connectedLinks = new Set<string>();
    
    filteredLinks.forEach(link => {
      if (link.source.id === node.id || link.target.id === node.id) {
        connectedLinks.add(link.id);
      }
    });
    setHighlightedLinks(connectedLinks);
  };

  const handleNodeHover = (node: Node3D) => {
    onNodeHover?.(node);
  };

  const handleNodeHoverOut = () => {
    onNodeHover?.(null);
  };

  return (
    <div className="w-full h-full overflow-hidden relative">
      <Canvas
        key={canvasKeyStr}
        camera={{ 
          position: graphBounds.cameraPosition, 
          fov: 60, 
          far: 5000, 
          near: 0.1 
        }}
        style={{ background: '#0a0a0a', width: '100%', height: '100%' }}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl }) => {
          gl.setPixelRatio(Math.min(2, window.devicePixelRatio));
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.2;
          gl.outputColorSpace = THREE.SRGBColorSpace;
        }}
        onPointerDown={handleUserInteraction}
        onWheel={handleUserInteraction}
      >
        <CameraViewOffset offset={viewportOffset} />

        {/* Auto-orbit controller */}
        <AutoOrbitController
          autoOrbit={autoOrbit}
          hasInteracted={hasInteracted}
          graphCenter={graphBounds.center}
          graphSize={graphBounds.size}
          orbitControlsRef={orbitControlsRef}
        />


        {/* Scene baseline lighting */}
        <ambientLight intensity={0.6} />
        <directionalLight position={[100, 100, 120]} intensity={1.0} color={new THREE.Color('#a0b9ff')} />
        <directionalLight position={[-120, -80, -100]} intensity={0.6} color={new THREE.Color('#7f8cff')} />

        {/* Deep dark background and depth fog */}
        <SceneAtmosphere />

        {/* Nebula gradient plane and star dust */}
        <NebulaBackdrop />
        <group position={[0,0,-600]}>
          <GalaxyBackground count={3500} position={[0,0,0]} />
        </group>

        <OrbitControls
          ref={orbitControlsRef}
          enabled={!autoOrbit}
          enableDamping
          dampingFactor={0.05}
          enableZoom
          enablePan
          enableRotate
          maxDistance={2000}
          minDistance={10}
          maxPolarAngle={Math.PI}
          minPolarAngle={0}
          onStart={handleUserInteraction}
        />

        {/* Render nodes */}
        {admittedNodes.map(node => {
          // Hide node if search is active and node doesn't match
          const isVisible = !debouncedSearchTerm.trim() || searchMatchingNodes.has(node.id);
          
          return (
            <group key={node.id} visible={isVisible}>
              <Node
                node={node}
                isSelected={selectedNode?.id === node.id}
                isHighlighted={hoveredNode?.id === node.id || (ragHighlightedNodeIds?.has(node.id) ?? false)}
                isInHierarchy={nodesInHierarchy.has(node.id)}
                communityMode={communityMode}
                hasSelectedNode={selectedNode !== null}
                sharedMaterial={sharedNodeMaterial}
                sharedGeometry={sharedNodeGeometry}
                onClick={handleNodeClick}
                onPointerOver={handleNodeHover}
                onPointerOut={handleNodeHoverOut}
              />
            </group>
          );
        })}

        {/* Render links with selective hero energy overlay */}
        {admittedLinks.map(link => {
          // Hide link if search is active and neither connected node matches
          const sourceVisible = !debouncedSearchTerm.trim() || searchMatchingNodes.has(link.source.id);
          const targetVisible = !debouncedSearchTerm.trim() || searchMatchingNodes.has(link.target.id);
          const isVisible = sourceVisible && targetVisible;
          
          // Check if energy edge should be shown in isolator mode
          const sourceInHierarchy = nodesInHierarchy.has(link.source.id);
          const targetInHierarchy = nodesInHierarchy.has(link.target.id);
          const showEnergyEdge = (heroEdgeIds.has(link.id) || highlightedLinks.has(link.id)) && 
            // In isolator mode, only show energy edges within hierarchy
            (communityMode !== 'auto' || !selectedNode || (sourceInHierarchy && targetInHierarchy));
          
          return (
            <group key={link.id} visible={isVisible}>
              <Link
                link={link}
                isHighlighted={
                  highlightedLinks.has(link.id) ||
                  (ragHighlightedNodeIds?.has(link.source.id) ?? false) ||
                  (ragHighlightedNodeIds?.has(link.target.id) ?? false)
                }
                communityMode={communityMode}
                nodesInHierarchy={nodesInHierarchy}
                hasSelectedNode={selectedNode !== null}
              />
              {showEnergyEdge && <EnergyEdge link={link} />}
            </group>
          );
        })}

        {/* Render community boundaries */}
        {showCommunityBoundaries && admittedNodeCount >= orderedNodes.length && (visibleCommunities || layout?.communities || []).map(community => {
          // Check if community has any visible nodes when search is active
          const hasVisibleNodes = debouncedSearchTerm.trim() ? 
            community.entity_ids.some((entityId: string) => searchMatchingNodes.has(entityId)) :
            true;
          
          const isVisible = (selectedLevel === null || community.level === selectedLevel) && hasVisibleNodes;
          
          return (
            <CommunityBoundary
              key={community.id}
              community={community}
              visible={isVisible}
              selectedCommunity={selectedNode?.community}
              communityMode={communityMode}
            />
          );
        })}

        {/* Postprocessing: selective bloom + vignette overlay */}
        <SelectiveBloomEffects settings={postFx} />
      </Canvas>

      {(loading || (layout && admittedNodeCount < orderedNodes.length)) && (
        <div className="pointer-events-none absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 border border-white/12 bg-[#05080b]/68 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground backdrop-blur-xl">
          <Loader2 className="h-3 w-3 animate-spin text-primary" />
          {layout ? `Building graph · ${admittedNodeCount}/${orderedNodes.length}` : status}
        </div>
      )}

      {error && (
        <button onClick={onRetry} className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 border border-destructive/50 bg-[#05080b]/80 px-3 py-2 text-[10px] text-foreground backdrop-blur-xl">
          <AlertCircle className="h-3.5 w-3.5 text-destructive" /> {error} · Retry
        </button>
      )}

    </div>
  );
}

// Constants and scene helpers
const BLOOM_SCENE = 1; // bloom layer id

// Shared shader materials for performance optimization
const createSharedNodeMaterial = () => {
  return new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: {
      colorCore: { value: new THREE.Color('#7de1ff') },
      colorRim: { value: new THREE.Color('#ff9bd5') },
      time: { value: 0.0 },
      opacity: { value: 0.85 },
    },
    vertexShader: `
      varying vec3 vN; varying vec3 vV;
      void main(){
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 colorCore, colorRim; uniform float time; uniform float opacity;
      varying vec3 vN; varying vec3 vV;
      void main(){
        float fres = pow(1.0 - max(dot(vN, vV), 0.0), 2.0);
        float core = smoothstep(0.0, 0.6, fres);
        vec3 col = mix(colorCore, colorRim, fres);
        float pulse = 0.6 + 0.4*sin(time*1.5);
        gl_FragColor = vec4(col*(core*1.2 + pulse*0.15), opacity);
      }
    `
  });
};

// Auto-orbit controller component that runs inside Canvas
function AutoOrbitController({ 
  autoOrbit, 
  hasInteracted, 
  graphCenter, 
  graphSize, 
  orbitControlsRef 
}: {
  autoOrbit: boolean;
  hasInteracted: boolean;
  graphCenter: [number, number, number];
  graphSize: number;
  orbitControlsRef: React.RefObject<React.ElementRef<typeof OrbitControls> | null>;
}) {
  useFrame((state) => {
    if (autoOrbit && !hasInteracted && orbitControlsRef.current) {
      // Slowly orbit around the center of the graph
      const time = state.clock.elapsedTime;
      const radius = Math.max(graphSize * 1.2, 200);
      
      // Set the target to the center of the graph
      orbitControlsRef.current.target.set(...graphCenter);
      
      // Orbit around the Y axis slowly
      const angle = time * 0.05; // Half the speed (0.05 = very slow)
      const x = graphCenter[0] + Math.cos(angle) * radius;
      const z = graphCenter[2] + Math.sin(angle) * radius;
      const y = graphCenter[1] + radius * 0.5; // Slight elevation
      
      state.camera.position.set(x, y, z);
      state.camera.lookAt(...graphCenter);
      
      orbitControlsRef.current.update();
    }
  });

  return null;
}

function CameraViewOffset({ offset }: { offset: number }) {
  const { camera, size } = useThree();
  const currentOffset = useRef(offset);
  const targetOffset = useRef(offset);

  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    targetOffset.current = offset;
  }, [camera, offset]);

  useFrame((_, delta) => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    const next = THREE.MathUtils.damp(currentOffset.current, targetOffset.current, 20, delta);
    if (Math.abs(next - currentOffset.current) < 0.01 && Math.abs(next - targetOffset.current) < 0.5) return;
    currentOffset.current = Math.abs(next) < 0.5 ? 0 : next;

    if (currentOffset.current > 0) {
      camera.setViewOffset(size.width + currentOffset.current, size.height, 0, 0, size.width, size.height);
    } else {
      camera.clearViewOffset();
      camera.aspect = size.width / size.height;
    }
    camera.updateProjectionMatrix();
  });

  useEffect(() => () => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    camera.clearViewOffset();
    camera.aspect = size.width / size.height;
    camera.updateProjectionMatrix();
  }, [camera, size.height, size.width]);

  return null;
}


// Map community levels to human-readable universe terms
function getLevelLabel(level: number): string {
  const levelMap: Record<number, string> = {
    0: 'Sector',
    1: 'System', 
    2: 'Subsystem',
    3: 'Component',
    4: 'Element'
  };
  return levelMap[level] || `L${level}`;
}

function SceneAtmosphere() {
  const { scene } = useThree();
  useEffect(() => {
    scene.background = new THREE.Color(0x06070a);
    // Disable fog for testing
    // scene.fog = new THREE.FogExp2(0x06070a, 0.02);
  }, [scene]);
  return null;
}

function NebulaBackdrop() {
  // Big gradient plane behind graph
  const mat = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      cTop: { value: new THREE.Color('#101221') },
      cBot: { value: new THREE.Color('#05060b') },
    },
    vertexShader: `
      varying vec2 vUv; 
      void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
    `,
    fragmentShader: `
      uniform vec3 cTop,cBot; varying vec2 vUv;
      void main(){ vec3 col=mix(cBot,cTop, vUv.y); gl_FragColor=vec4(col,1.0); }
    `
  }), []);
  return (
    <mesh position={[0,0,-800]} onUpdate={(m)=>m.layers.disable(BLOOM_SCENE)}>
      <planeGeometry args={[4000, 2500]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
}

type PostFXSettings = {
  bloomEnabled: boolean;
  bloomStrength: number; // 0..3
  bloomRadius: number;   // 0..2
  bloomThreshold: number; // 0..1
  vignetteEnabled: boolean;
  vignetteStrength: number; // 0..1 (gentle)
};

function SelectiveBloomEffects({ settings }: { settings: PostFXSettings }) {
  const { gl, size, scene, camera } = useThree();
  const composerRef = useRef<EffectComposer | null>(null);
  
  // Cache objects for efficient bloom processing
  const bloomObjects = useRef<THREE.Mesh[]>([]);
  const nonBloomObjects = useRef<THREE.Mesh[]>([]);
  const materialsRef = useRef<Map<string, THREE.Material>>(new Map());
  
  const darkMaterial = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.0 });
    ;(m as THREE.Material & { colorWrite?: boolean }).colorWrite = false;
    m.depthWrite = false;
    return m;
  }, []);
  
  const bloomLayers = useMemo(() => {
    const l = new THREE.Layers();
    l.set(BLOOM_SCENE);
    return l;
  }, []);

  // Build object cache on scene changes (much more efficient than traversing every frame)
  useEffect(() => {
    const buildObjectCache = () => {
      bloomObjects.current = [];
      nonBloomObjects.current = [];
      materialsRef.current.clear();
      
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          const mesh = obj as THREE.Mesh;
          // Skip Text components - they should not be affected by bloom processing
          if (mesh.name?.includes('Text') || (mesh as unknown as { isText?: boolean }).isText || mesh.userData?.isText) {
            return; // Skip text meshes entirely
          }
          
          if (mesh.layers.test(bloomLayers)) {
            bloomObjects.current.push(mesh);
          } else {
            nonBloomObjects.current.push(mesh);
            // Cache original material
            const mat = mesh.material as THREE.Material;
            if (!Array.isArray(mat)) {
              materialsRef.current.set(mesh.uuid, mat);
            }
          }
        }
      });
    };
    
    // Rebuild cache when scene changes
    const timer = setTimeout(buildObjectCache, 100);
    return () => clearTimeout(timer);
  }, [scene, bloomLayers]);

  // Setup composer
  useEffect(() => {
    const composer = new EffectComposer(gl);
    composer.setSize(size.width, size.height);

    const renderPass = new RenderPass(scene, camera);
    // Keep base frame; overlay bloom result
    renderPass.clear = false;
    composer.addPass(renderPass);

    const { bloomEnabled, bloomStrength, bloomRadius, bloomThreshold, vignetteEnabled, vignetteStrength } = settings;
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(size.width, size.height), bloomStrength, bloomRadius, bloomThreshold);
    bloomPass.threshold = settings.bloomThreshold;
    bloomPass.strength = settings.bloomStrength;
    bloomPass.radius = settings.bloomRadius;
    bloomPass.enabled = bloomEnabled;
    composer.addPass(bloomPass);

    // Gentle vignette shader with adjustable strength
    const VignetteShader: object = {
      uniforms: { tDiffuse: { value: null }, strength: { value: vignetteStrength } },
      vertexShader: `
        varying vec2 vUv; 
        void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float strength; varying vec2 vUv;
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          float d = distance(vUv, vec2(0.5));
          float v = smoothstep(0.6, 0.98, d);
          c.rgb *= (1.0 - v * strength);
          gl_FragColor = c;
        }
      `
    };
    const vignettePass = new ShaderPass(VignetteShader);
    vignettePass.enabled = vignetteEnabled;
    composer.addPass(vignettePass);

    composerRef.current = composer;

    return () => {
      composer.dispose();
    };
  }, [gl, size.width, size.height, scene, camera, settings]);

  // Resize composer on viewport change
  useEffect(() => {
    if (composerRef.current) {
      composerRef.current.setSize(size.width, size.height);
    }
  }, [size]);

  // Efficient material swapping using cached objects (no scene traversal)
  const darkenNonBloomedObjects = () => {
    nonBloomObjects.current.forEach(mesh => {
      mesh.material = darkMaterial;
    });
  };
  
  const restoreOriginalMaterials = () => {
    nonBloomObjects.current.forEach(mesh => {
      const originalMaterial = materialsRef.current.get(mesh.uuid);
      if (originalMaterial) {
        mesh.material = originalMaterial;
      }
    });
  };

  // Update pass settings when controls change
  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    const passes = composer.passes || [];
    const bloomPass = passes.find((p) => p instanceof UnrealBloomPass) as UnrealBloomPass | undefined;
    const vignettePass = passes.find((p) => p instanceof ShaderPass) as ShaderPass | undefined;
    const { bloomEnabled, bloomStrength, bloomRadius, bloomThreshold, vignetteEnabled, vignetteStrength } = settings;
    if (bloomPass) {
      bloomPass.enabled = bloomEnabled;
      bloomPass.strength = bloomStrength;
      bloomPass.radius = bloomRadius;
      bloomPass.threshold = bloomThreshold;
      if (bloomPass.resolution) {
        bloomPass.resolution.set(size.width, size.height);
      }
    }
    if (vignettePass) {
      vignettePass.enabled = vignetteEnabled;
      const uniforms = (vignettePass as unknown as { uniforms?: { strength?: { value: number } } }).uniforms;
      if (uniforms && uniforms.strength) {
        uniforms.strength.value = vignetteStrength;
      }
    }
  }, [size.width, size.height, settings]);

  // Render bloom overlay after the base scene (optimized - no scene traversal)
  useFrame(({ gl }) => {
    const composer = composerRef.current;
    if (!composer) return;
    
    darkenNonBloomedObjects(); // Direct array operation instead of scene traversal
    const prev = gl.autoClear;
    gl.autoClear = false;
    composer.render();
    gl.autoClear = prev;
    restoreOriginalMaterials(); // Direct array operation instead of scene traversal
  }, 1);

  return null;
}
