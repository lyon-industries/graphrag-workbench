// Removed parquet-wasm dependency - using JSON files instead

export interface Entity {
  id: string;
  human_readable_id: string;
  title: string;
  type: string;
  description: string;
  text_unit_ids: string[];
  frequency: number;
  degree: number;
  x?: number;
  y?: number;
  z?: number;
}

export interface Relationship {
  id: string;
  human_readable_id: string;
  source: string;
  target: string;
  description: string;
  weight: number;
  combined_degree: number;
  text_unit_ids: string[];
}

export interface Community {
  id: string;
  human_readable_id: string;
  community: string;
  level: number;
  parent?: string;
  children: string[];
  title: string;
  entity_ids: string[];
  relationship_ids: string[];
  text_unit_ids: string[];
  period: string;
  size: number;
  // Pre-computed values for performance optimization
  computedBounds?: {
    center: [number, number, number];
    size: [number, number, number];
    padding: number;
  };
  computedHierarchy?: {
    parentCommunities: Community[];
    childCommunities: Community[];
  };
  computedColor?: string;
  computedOpacity?: number;
}

export interface CommunityReport {
  id: string;
  human_readable_id: string;
  community: string;
  level: number;
  title: string;
  summary: string;
  full_content: string;
  rank: number;
  rank_explanation: string;
  findings: unknown[];
}

export interface GraphData {
  entities: Entity[];
  relationships: Relationship[];
  communities: Community[];
  communityReports: CommunityReport[];
}

export class GraphDataLoader {
  private basePath: string;

  constructor(basePath: string = '/api/data') {
    this.basePath = basePath;
  }

  async loadGraphData(): Promise<GraphData> {
    try {
      const [entitiesData, relationshipsData, communitiesData, reportsData] = 
        await Promise.all([
          this.fetchJsonFile('entities.json'),
          this.fetchJsonFile('relationships.json'),
          this.fetchJsonFile('communities.json'),
          this.fetchJsonFile('community_reports.json'),
        ]);

      const entities = this.parseJsonToEntities(entitiesData);
      const relationships = this.parseJsonToRelationships(relationshipsData);
      const communities = this.parseJsonToCommunities(communitiesData);
      const communityReports = this.parseJsonToCommunityReports(reportsData);

      // Merge community report titles with communities
      const communityTitleMap = new Map<number, string>();
      communityReports.forEach(report => {
        communityTitleMap.set(Number(report.community), report.title);
      });

      // Update communities with proper titles from reports
      const enrichedCommunities = communities.map(community => ({
        ...community,
        title: communityTitleMap.get(Number(community.community)) || community.title,
      }));

      return {
        entities,
        relationships,
        communities: enrichedCommunities,
        communityReports,
      };
    } catch (error) {
      console.error('Error loading graph data:', error);
      throw error;
    }
  }

  private async fetchJsonFile(filename: string): Promise<Array<Record<string, unknown>>> {
    const response = await fetch(`${this.basePath}/${filename}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${filename}: ${response.statusText}`);
    }
    return await response.json() as Array<Record<string, unknown>>;
  }

  private parseJsonToEntities(data: Array<Record<string, unknown>>): Entity[] {
    return data.map(item => ({
      id: String(item.id ?? ''),
      human_readable_id: String(item.human_readable_id ?? ''),
      title: String(item.title ?? ''),
      type: String(item.type ?? 'unnamed'),
      description: String(item.description ?? ''),
      text_unit_ids: this.ensureStringArray(item.text_unit_ids),
      frequency: Number(item.frequency ?? 0),
      degree: Number(item.degree ?? 0),
      x: Number(item.x ?? 0),
      y: Number(item.y ?? 0),
    }));
  }

  private parseJsonToRelationships(data: Array<Record<string, unknown>>): Relationship[] {
    return data.map(item => ({
      id: String(item.id ?? ''),
      human_readable_id: String(item.human_readable_id ?? ''),
      source: String(item.source ?? ''),
      target: String(item.target ?? ''),
      description: String(item.description ?? ''),
      weight: Number(item.weight ?? 1),
      combined_degree: Number(item.combined_degree ?? 0),
      text_unit_ids: this.ensureStringArray(item.text_unit_ids),
    }));
  }

  private parseJsonToCommunities(data: Array<Record<string, unknown>>): Community[] {
    return data.map(item => ({
      id: String(item.id ?? ''),
      human_readable_id: String(item.human_readable_id ?? ''),
      community: String(item.community ?? ''),
      level: Number(item.level ?? 0),
      parent: (item.parent !== undefined && item.parent !== -1 && item.parent !== '-1') ? String(item.parent as string | number) : undefined,
      children: this.ensureStringArray(item.children),
      title: String(item.title ?? ''),
      entity_ids: this.ensureStringArray(item.entity_ids),
      relationship_ids: this.ensureStringArray(item.relationship_ids),
      text_unit_ids: this.ensureStringArray(item.text_unit_ids),
      period: String(item.period ?? ''),
      size: Number(item.size ?? 0),
    }));
  }

  private parseJsonToCommunityReports(data: Array<Record<string, unknown>>): CommunityReport[] {
    return data.map(item => ({
      id: String(item.id ?? ''),
      human_readable_id: String(item.human_readable_id ?? ''),
      community: String(item.community ?? ''),
      level: Number(item.level ?? 0),
      title: String(item.title ?? ''),
      summary: String(item.summary ?? ''),
      full_content: String(item.full_content ?? ''),
      rank: Number(item.rank ?? 0),
      rank_explanation: String(item.rank_explanation ?? ''),
      findings: Array.isArray(item.findings) ? (item.findings as unknown[]) : [],
    }));
  }

  private ensureStringArray(value: unknown): string[] {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(String);
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.map(String) : [value];
      } catch {
        return value.split(',').map(s => s.trim()).filter(Boolean);
      }
    }
    return [String(value)];
  }
}

export const ENTITY_COLORS: Record<string, string> = {
  'ORGANIZATION': '#ff6b6b',
  'EVENT': '#4ecdc4',
  'PERSON': '#45b7d1',
  'GEO': '#96ceb4',
  'PROCESS': '#feca57',
  'unnamed': '#95a5a6',
};

export const ENTITY_SIZES = {
  MIN: 2,
  MAX: 12,
  SCALE_FACTOR: 0.5,
};

export const RELATIONSHIP_THICKNESS = {
  MIN: 0.5,
  MAX: 4,
  SCALE_FACTOR: 0.2,
};
