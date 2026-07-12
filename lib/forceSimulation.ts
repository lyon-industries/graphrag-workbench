import * as d3 from 'd3-force-3d';
import { Entity, Community, GraphData, ENTITY_COLORS } from './graphData';

export interface Node3D extends Entity {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  community?: Community;
  communityLevel: number;
  // Pre-computed values for performance optimization
  computedSize: number;
  computedColor: string;
}

export interface Link3D {
  id: string;
  source: Node3D;
  target: Node3D;
  weight: number;
  description: string;
}

export interface GraphLayout {
  nodes: Node3D[];
  links: Link3D[];
  communities: Community[];
}

export interface ForceConfig {
  chargeStrength: number;
  linkDistance: number;
  linkStrength: number;
  collisionRadius: number;
  communityStrength: number;
  centerStrength: number;
  spread3D: number;
  levelSpacing: number;
  sphericalConstraint: number;
}

export const defaultForceConfig: ForceConfig = {
  chargeStrength: -100,
  linkDistance: 30,
  linkStrength: 0.2,
  collisionRadius: 6,
  communityStrength: 0.2, // Increased for stronger community clustering
  centerStrength: 0.02, // Lower center pull to maintain spherical shape
  spread3D: 150,
  levelSpacing: 40,
  sphericalConstraint: 0.05, // Strength of spherical positioning force
};

export class ForceSimulation3D {
  private simulation: d3.Simulation<Node3D, undefined>;
  private nodes: Node3D[] = [];
  private links: Link3D[] = [];
  private communities: Community[] = [];
  private config: ForceConfig;
  private communityCenters: Map<string, { x: number, y: number, z: number, radius: number }> = new Map();

  constructor(config: ForceConfig = defaultForceConfig) {
    this.config = { ...config };
    this.simulation = d3.forceSimulation<Node3D>()
      .force('link', d3.forceLink<Node3D, d3.SimulationLinkDatum<Node3D>>().id((d: unknown) => (d as { id: string }).id))
      .force('charge', d3.forceManyBody())
      .force('center', d3.forceCenter())
      .force('collision', d3.forceCollide())
      .alphaDecay(0.03)
      .alphaMin(0.001);
  }

  generateLayout(graphData: GraphData): Promise<GraphLayout> {
    return new Promise((resolve) => {
      this.preprocessData(graphData);
      this.setupForces();
      
      let iterationCount = 0;
      const maxIterations = 500;

      this.simulation.on('tick', () => {
        iterationCount++;
        if (iterationCount >= maxIterations || this.simulation.alpha() < 0.001) {
          this.simulation.stop();
          // Pre-compute community data for performance optimization
          this.precomputeCommunityData();
          resolve({
            nodes: this.nodes,
            links: this.links,
            communities: this.communities,
          });
        }
      });

      this.simulation.nodes(this.nodes);
      this.simulation.force('link').links(this.links);
      this.simulation.restart();
    });
  }


  private preprocessData(graphData: GraphData): void {
    this.communities = graphData.communities;
    let minAbstraction = Infinity;
    let maxAbstraction = -Infinity;
    graphData.entities.forEach(entity => {
      const score = entity.degree + entity.frequency * 0.5;
      minAbstraction = Math.min(minAbstraction, score);
      maxAbstraction = Math.max(maxAbstraction, score);
    });
    
    // Create entity lookup for community assignment
    const entityToCommunity = new Map<string, Community>();
    graphData.communities.forEach(community => {
      community.entity_ids.forEach(entityId => {
        entityToCommunity.set(entityId, community);
      });
    });

    // Convert entities to 3D nodes with spherical knowledge universe distribution
    this.nodes = graphData.entities.map((entity, index) => {
      const community = entityToCommunity.get(entity.id);
      const communityLevel = community ? community.level : 0;
      
      // Calculate abstraction level - higher degree + frequency = more central/abstract
      const abstractionScore = entity.degree + (entity.frequency * 0.5);
      // Normalize abstraction to 0-1 scale (1 = most abstract, 0 = least abstract)
      const normalizedAbstraction = maxAbstraction > minAbstraction ? 
        (abstractionScore - minAbstraction) / (maxAbstraction - minAbstraction) : 0.5;
      
      // Calculate radius based on abstraction level (inverted - high abstraction = center)
      // Most abstract concepts get small radius (center), least abstract get large radius (edge)
      const minRadius = this.config.spread3D * 0.1; // Core radius
      const maxRadius = this.config.spread3D; // Outer shell radius
      const radius = minRadius + (1 - normalizedAbstraction) * (maxRadius - minRadius);
      
      // Add community level influence to create sub-spheres
      const communityOffset = communityLevel * this.config.levelSpacing * 0.3;
      const finalRadius = radius + communityOffset;
      
      // Use Fibonacci sphere for even distribution on each radius shell
      const goldenAngle = Math.PI * (3 - Math.sqrt(5)); // Golden angle in radians
      const phi = Math.acos(1 - 2 * (index / graphData.entities.length)); // Uniform distribution
      const theta = goldenAngle * index;
      
      // Add slight randomization to prevent perfect grid
      const randomFactor = 0.9 + Math.random() * 0.2;
      const adjustedRadius = finalRadius * randomFactor;
      
      return {
        ...entity,
        x: adjustedRadius * Math.sin(phi) * Math.cos(theta),
        y: adjustedRadius * Math.sin(phi) * Math.sin(theta), 
        z: adjustedRadius * Math.cos(phi),
        community,
        communityLevel,
        abstractionLevel: normalizedAbstraction, // Store for potential future use
        // Pre-compute expensive values for performance optimization
        computedSize: calculateNodeSize(entity.degree, entity.frequency),
        computedColor: ENTITY_COLORS[entity.type] || ENTITY_COLORS.unnamed,
      } as Node3D & { abstractionLevel: number };
    });

    // Create node lookup for relationship processing
    const nodeMap = new Map<string, Node3D>();
    this.nodes.forEach(node => {
      nodeMap.set(node.id, node);
      nodeMap.set(node.title, node); // Also map by title as backup
    });

    // Convert relationships to links
    this.links = graphData.relationships
      .map(rel => {
        const sourceNode = nodeMap.get(rel.source);
        const targetNode = nodeMap.get(rel.target);

        if (!sourceNode || !targetNode) {
          console.warn(`Relationship link missing node: ${rel.source} -> ${rel.target}`);
          return null;
        }

        return {
          id: rel.id,
          source: sourceNode,
          target: targetNode,
          weight: rel.weight,
          description: rel.description,
        };
      })
      .filter((link): link is Link3D => link !== null);
  }

  private setupForces(): void {
    const nodeChargeStrength = (d: Node3D) => {
      // Configurable repulsion with node degree scaling
      return this.config.chargeStrength - (d.degree * 5);
    };

    const linkDistance = (d: Link3D) => {
      // Dynamic link distance based on weight
      const weightFactor = 1 / (d.weight * 0.05 + 1);
      return this.config.linkDistance * weightFactor;
    };

    const linkStrength = (d: Link3D) => {
      // Configurable link strength
      return Math.min(d.weight * 0.05, this.config.linkStrength);
    };

    // Configure forces with improved 3D positioning
    this.simulation
      .force('charge', d3.forceManyBody().strength(nodeChargeStrength))
      .force('link', d3.forceLink<Node3D, d3.SimulationLinkDatum<Node3D>>()
        .id((d: unknown) => (d as { id: string }).id)
        .distance(linkDistance)
        .strength(linkStrength)
      )
      .force('center', d3.forceCenter(0, 0, 0).strength(this.config.centerStrength))
      .force('collision', d3.forceCollide().radius((d: Node3D) => {
        return this.config.collisionRadius + calculateNodeSize(d.degree, d.frequency);
      }));

    // Add community clustering force
    this.addCommunityForces();
    
    // Add spherical constraint force to maintain knowledge universe structure
    this.addSphericalConstraint();
  }

  private addCommunityForces(): void {
    // Calculate and cache community centers
    this.calculateCommunityCenters();

    // Add custom force for community attraction
    this.simulation.force('community', () => {
      this.nodes.forEach(node => {
        if (node.community) {
          const center = this.communityCenters.get(node.community.id);
          if (center) {
            const dx = center.x - node.x!;
            const dy = center.y - node.y!;
            const dz = center.z - node.z!;
            
            // Use full community strength (no longer weakened)
            const communityStrength = this.config.communityStrength;
            
            node.vx = (node.vx || 0) + dx * communityStrength;
            node.vy = (node.vy || 0) + dy * communityStrength;
            node.vz = (node.vz || 0) + dz * communityStrength;
          }
        }
      });
    });
  }

  private calculateCommunityCenters(): void {
    // In spherical knowledge universe, communities are distributed on spherical shells
    // Calculate community centers based on average abstraction level of member nodes
    this.communityCenters.clear();
    const nodesByCommunity = new Map<string, Node3D[]>();
    this.nodes.forEach(node => {
      if (!node.community) return;
      const group = nodesByCommunity.get(node.community.id);
      if (group) group.push(node);
      else nodesByCommunity.set(node.community.id, [node]);
    });
    
    this.communities.forEach((community, communityIndex) => {
      const communityNodes = nodesByCommunity.get(community.id) || [];
      
      if (communityNodes.length > 0) {
        // Calculate average abstraction level for community positioning
        const avgAbstraction = communityNodes.reduce((sum, node) => {
          return sum + ((node as unknown as { abstractionLevel?: number }).abstractionLevel || 0.5);
        }, 0) / communityNodes.length;
        
        // Calculate ideal radius based on average abstraction level
        const minRadius = this.config.spread3D * 0.1;
        const maxRadius = this.config.spread3D;
        const baseRadius = minRadius + (1 - avgAbstraction) * (maxRadius - minRadius);
        
        // Add community level offset
        const communityRadius = baseRadius + community.level * this.config.levelSpacing * 0.2;
        
        // Distribute communities evenly on their shell using spherical coordinates
        const goldenAngle = Math.PI * (3 - Math.sqrt(5));
        const phi = Math.acos(1 - 2 * (communityIndex / this.communities.length));
        const theta = goldenAngle * communityIndex;
        
        this.communityCenters.set(community.id, {
          x: communityRadius * Math.sin(phi) * Math.cos(theta),
          y: communityRadius * Math.sin(phi) * Math.sin(theta),
          z: communityRadius * Math.cos(phi),
          radius: communityRadius,
        });
      }
    });
  }

  private addSphericalConstraint(): void {
    // Add custom force to maintain spherical knowledge universe structure
    this.simulation.force('spherical', () => {
      this.nodes.forEach(node => {
        const nodeWithAbstraction = node as Node3D & { abstractionLevel: number };
        
        // Calculate ideal radius based on abstraction level
        const minRadius = this.config.spread3D * 0.1;
        const maxRadius = this.config.spread3D;
        const idealRadius = minRadius + (1 - (nodeWithAbstraction.abstractionLevel || 0.5)) * (maxRadius - minRadius);
        
        // Add community level offset
        const communityOffset = node.communityLevel * this.config.levelSpacing * 0.3;
        const targetRadius = idealRadius + communityOffset;
        
        // Current distance from center
        const currentDistance = Math.sqrt(node.x! * node.x! + node.y! * node.y! + node.z! * node.z!);
        
        if (currentDistance > 0) {
          // Calculate how much to adjust radius
          const radiusDiff = targetRadius - currentDistance;
          const adjustmentStrength = this.config.sphericalConstraint;
          
          // Normalize direction vector
          const dirX = node.x! / currentDistance;
          const dirY = node.y! / currentDistance;
          const dirZ = node.z! / currentDistance;
          
          // Apply radial force
          const force = radiusDiff * adjustmentStrength;
          node.vx = (node.vx || 0) + dirX * force;
          node.vy = (node.vy || 0) + dirY * force;
          node.vz = (node.vz || 0) + dirZ * force;
        }
      });
    });
  }

  private generateInitialPosition(): number {
    return (Math.random() - 0.5) * 200;
  }

  updateConfig(newConfig: Partial<ForceConfig>): void {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...newConfig };
    
    if (!this.simulation || this.nodes.length === 0) {
      return;
    }

    try {
      // Update individual forces incrementally instead of recreating everything
      this.updateIndividualForces(oldConfig, newConfig);
      
      // Gentle restart with lower alpha to avoid breaking the layout
      this.simulation.alpha(0.1).restart();
    } catch (error) {
      console.warn('Force config update failed, falling back to full setup:', error);
      // Fallback: only if incremental update fails
      this.setupForces();
      this.simulation.alpha(0.05).restart();
    }
  }

  private updateIndividualForces(oldConfig: ForceConfig, changes: Partial<ForceConfig>): void {
    // Update charge force if needed
    if (changes.chargeStrength !== undefined) {
      const chargeForce = this.simulation.force('charge');
      if (chargeForce) {
        chargeForce.strength((d: Node3D) => this.config.chargeStrength - (d.degree * 5));
      }
    }

    // Update link force if needed
    if (changes.linkDistance !== undefined || changes.linkStrength !== undefined) {
      const linkForce = this.simulation.force('link');
      if (linkForce) {
        if (changes.linkDistance !== undefined) {
          linkForce.distance((d: Link3D) => {
            const weightFactor = 1 / (d.weight * 0.05 + 1);
            return this.config.linkDistance * weightFactor;
          });
        }
        if (changes.linkStrength !== undefined) {
          linkForce.strength((d: Link3D) => Math.min(d.weight * 0.05, this.config.linkStrength));
        }
      }
    }

    // Update center force if needed
    if (changes.centerStrength !== undefined) {
      const centerForce = this.simulation.force('center');
      if (centerForce) {
        centerForce.strength(this.config.centerStrength);
      }
    }

    // Update collision force if needed
    if (changes.collisionRadius !== undefined) {
      const collisionForce = this.simulation.force('collision');
      if (collisionForce) {
        collisionForce.radius((d: Node3D) => {
          return this.config.collisionRadius + calculateNodeSize(d.degree, d.frequency);
        });
      }
    }

    // Update community and spherical forces if their parameters changed
    if (changes.communityStrength !== undefined || 
        changes.spread3D !== undefined || 
        changes.levelSpacing !== undefined ||
        changes.sphericalConstraint !== undefined) {
      
      // For these complex forces, we need to update their internal logic
      // but we'll do it more carefully
      this.updateCommunityForce();
      this.updateSphericalForce();
    }
  }

  private updateCommunityForce(): void {
    // Recalculate community centers if spatial parameters changed
    this.calculateCommunityCenters();
    
    // Update the community force function
    this.simulation.force('community', () => {
      this.nodes.forEach(node => {
        if (node.community) {
          const center = this.communityCenters.get(node.community.id);
          if (center) {
            const dx = center.x - node.x!;
            const dy = center.y - node.y!;
            const dz = center.z - node.z!;
            
            // Use updated community strength
            const communityStrength = this.config.communityStrength;
            
            node.vx = (node.vx || 0) + dx * communityStrength;
            node.vy = (node.vy || 0) + dy * communityStrength;
            node.vz = (node.vz || 0) + dz * communityStrength;
          }
        }
      });
    });
  }

  private updateSphericalForce(): void {
    // Update the spherical constraint force
    this.simulation.force('spherical', () => {
      this.nodes.forEach(node => {
        const nodeWithAbstraction = node as Node3D & { abstractionLevel: number };
        
        // Calculate ideal radius based on abstraction level
        const minRadius = this.config.spread3D * 0.1;
        const maxRadius = this.config.spread3D;
        const idealRadius = minRadius + (1 - (nodeWithAbstraction.abstractionLevel || 0.5)) * (maxRadius - minRadius);
        
        // Add community level offset
        const communityOffset = node.communityLevel * this.config.levelSpacing * 0.3;
        const targetRadius = idealRadius + communityOffset;
        
        // Current distance from center
        const currentDistance = Math.sqrt(node.x! * node.x! + node.y! * node.y! + node.z! * node.z!);
        
        if (currentDistance > 0) {
          const radiusDiff = targetRadius - currentDistance;
          const adjustmentStrength = this.config.sphericalConstraint;
          
          // Normalize direction vector
          const dirX = node.x! / currentDistance;
          const dirY = node.y! / currentDistance;
          const dirZ = node.z! / currentDistance;
          
          // Apply radial force
          const force = radiusDiff * adjustmentStrength;
          node.vx = (node.vx || 0) + dirX * force;
          node.vy = (node.vy || 0) + dirY * force;
          node.vz = (node.vz || 0) + dirZ * force;
        }
      });
    });
  }

  private precomputeCommunityData(): void {
    // Build community lookup maps for efficient hierarchy computation
    const communityMap = new Map<string, Community>();
    this.communities.forEach(community => {
      communityMap.set(community.id, community);
      communityMap.set(community.human_readable_id.toString(), community);
    });

    this.communities.forEach(community => {
      // Pre-compute bounding boxes
      const communityNodes = this.nodes.filter(node => 
        community.entity_ids.includes(node.id)
      );

      if (communityNodes.length > 0) {
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity; 
        let minZ = Infinity, maxZ = -Infinity;

        communityNodes.forEach(node => {
          minX = Math.min(minX, node.x);
          maxX = Math.max(maxX, node.x);
          minY = Math.min(minY, node.y);
          maxY = Math.max(maxY, node.y);
          minZ = Math.min(minZ, node.z);
          maxZ = Math.max(maxZ, node.z);
        });

        const padding = 35; // Standard padding
        community.computedBounds = {
          center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
          size: [maxX - minX + padding, maxY - minY + padding, maxZ - minZ + padding],
          padding,
        };
      }

      // Pre-compute hierarchy relationships
      const parentCommunities: Community[] = [];
      const childCommunities: Community[] = [];
      
      // Find parent communities
      if (community.parent !== null && community.parent !== undefined) {
        const parentId = String(community.parent);
        const parentCommunity = this.communities.find(c => String(c.human_readable_id) === parentId);
        if (parentCommunity) {
          parentCommunities.push(parentCommunity);
        }
      }
      
      // Find child communities
      this.communities.forEach(otherCommunity => {
        if (otherCommunity.parent !== null && otherCommunity.parent !== undefined) {
          const parentId = String(otherCommunity.parent);
          if (parentId === String(community.human_readable_id)) {
            childCommunities.push(otherCommunity);
          }
        }
      });

      // Also check the children array if available
      if (community.children && Array.isArray(community.children)) {
        community.children.forEach((childHumanId: string) => {
          const childId = String(childHumanId);
          const childCommunity = this.communities.find(c => String(c.human_readable_id) === childId);
          if (childCommunity && !childCommunities.some(c => c.id === childCommunity.id)) {
            childCommunities.push(childCommunity);
          }
        });
      }

      community.computedHierarchy = {
        parentCommunities: parentCommunities.sort((a, b) => a.level - b.level),
        childCommunities: childCommunities.sort((a, b) => a.level - b.level),
      };

      // Pre-compute colors and opacities based on level
      const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#feca57'];
      community.computedColor = colors[community.level % colors.length];
      community.computedOpacity = 0.15;
    });
  }

  stop(): void {
    if (this.simulation) {
      this.simulation.stop();
    }
  }
}

export function calculateNodeSize(degree: number, frequency: number): number {
  const ENTITY_SIZES = {
    MIN: 0.8,
    MAX: 4.0,
    SCALE_FACTOR: 0.15,
  };
  
  const size = ENTITY_SIZES.MIN + (degree + frequency * 0.1) * ENTITY_SIZES.SCALE_FACTOR;
  return Math.min(size, ENTITY_SIZES.MAX);
}

export function calculateLinkThickness(weight: number): number {
  const RELATIONSHIP_THICKNESS = {
    MIN: 0.2,
    MAX: 2.0,
    SCALE_FACTOR: 0.1,
  };
  
  const thickness = RELATIONSHIP_THICKNESS.MIN + weight * RELATIONSHIP_THICKNESS.SCALE_FACTOR;
  return Math.min(thickness, RELATIONSHIP_THICKNESS.MAX);
}
