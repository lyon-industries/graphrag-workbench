'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Eye, FolderKanban, Loader2, X } from 'lucide-react';
import GraphVisualizer from '@/components/GraphVisualizer';
import Inspector from '@/components/Inspector';
import CorpusPanel from '@/components/CorpusPanel';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
// SettingsModal removed
import { GraphDataLoader, GraphData, type Community } from '../lib/graphData';
import { ForceSimulation3D, GraphLayout, Node3D, defaultForceConfig } from '../lib/forceSimulation';

export default function Home() {
  const [layout, setLayout] = useState<GraphLayout | null>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('Initializing...');
  // track corpus presence implicitly; no explicit corpusState passed to visualizer
  
  // Selection state
  const [selectedNode, setSelectedNode] = useState<Node3D | null>(null);
  const [hoveredNode, setHoveredNode] = useState<Node3D | null>(null);
  
  // Filter states
  const [selectedEntityTypes] = useState<Set<string>>(new Set());
  const [minRelationshipWeight] = useState<number>(1);
  // showCommunityBoundaries state removed
  const [inspectorMode, setInspectorMode] = useState<boolean>(false);
  const [selectedLevel] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [projectPanelOpen, setProjectPanelOpen] = useState(false);
  const [projectNameRequired, setProjectNameRequired] = useState(false);
  const [currentProjectName, setCurrentProjectName] = useState('');
  const [buildRunning, setBuildRunning] = useState(false);
  const [ragHighlightedNodeIds] = useState<Set<string>>(new Set());
  
  // Settings modal removed
  
  // Simulation instance not kept in state
  
  // Ref for search input to enable focus
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  // Check corpus state and load data intelligently
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        
        // First check if we have any corpus data
        setStatus('Checking for indexed data...');
        const corpusRes = await fetch('/api/corpus/state', { cache: 'no-store' });
        if (corpusRes.ok) {
          const corpus = await corpusRes.json();
          const requiresName = !corpus.kgName || !String(corpus.kgName).trim();
          setCurrentProjectName(corpus.kgName ? String(corpus.kgName) : '');
          setProjectNameRequired(requiresName);
          if (requiresName) setProjectPanelOpen(true);
          
          // Imported GraphRAG output may not include source documents. The
          // generated graph artifacts, not the upload registry, decide
          // whether the constellation can load.
          const hasIndex = corpus.outputStats && ((corpus.outputStats.entities ?? 0) + (corpus.outputStats.relationships ?? 0) + (corpus.outputStats.communities ?? 0) + (corpus.outputStats.text_units ?? 0) > 0);
          
          if (!hasIndex) {
            setProjectPanelOpen(true);
            setLoading(false);
            return;
          }
        }

        setStatus('Loading JSON data files...');

        const loader = new GraphDataLoader('/api/data');
        const graphData = await loader.loadGraphData();

        setStatus('Processing graph structure...');
        
        const newSimulation = new ForceSimulation3D(defaultForceConfig);
        const layout = await newSimulation.generateLayout(graphData);
        
        // not retaining simulation in state

        setStatus('Rendering visualization...');
        
        setLayout(layout);
        setGraphData(graphData);
        setLoading(false);

      } catch (error) {
        console.error('Error loading graph data:', error);
        setLoading(false);
        // Don't set error - just fall back to no data state
      }
    };

    loadData();
  }, []);

  // Hot-reload graph data when the corpus pipeline finishes
  const reloadGraphData = useCallback(async () => {
    try {
      setStatus('Reloading graph data...');
      const loader = new GraphDataLoader('/api/data');
      const newGraph = await loader.loadGraphData();
      const sim = new ForceSimulation3D(defaultForceConfig);
      const newLayout = await sim.generateLayout(newGraph);
      // not retaining simulation in state
      setLayout(newLayout);
      setGraphData(newGraph);
      setStatus('Graph reloaded');
    } catch (err) {
      console.warn('Hot reload failed:', err);
    }
  }, []);

  // Track the server-owned index job so the UI reflects a build even when
  // the Builder sheet is closed: the Projects button shows activity, and the
  // constellation populates progressively as each artifact lands (the job
  // bumps dataVersion whenever fresh JSON is written to output/).
  useEffect(() => {
    let cancelled = false;
    let lastDataVersion: number | null = null;
    const poll = async () => {
      try {
        const res = await fetch('/api/corpus/index/status', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const job = await res.json() as { running?: boolean; dataVersion?: number };
        setBuildRunning(job.running === true);
        const version = job.dataVersion ?? 0;
        if (lastDataVersion !== null && version !== lastDataVersion) {
          reloadGraphData();
        }
        lastDataVersion = version;
      } catch {}
    };
    poll();
    const timer = window.setInterval(poll, 2500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [reloadGraphData]);

  useEffect(() => {
    const handler = () => reloadGraphData();
    window.addEventListener('graph-data-updated', handler);
    const clearHandler = () => {
      setGraphData(null);
      setLayout(null);
      setStatus('No graph loaded');
      setSelectedNode(null);
    };
    window.addEventListener('graph-data-cleared', clearHandler);
    return () => {
      window.removeEventListener('graph-data-updated', handler);
      window.removeEventListener('graph-data-cleared', clearHandler);
    };
  }, [reloadGraphData]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // ESC to unselect node
      if (event.key === 'Escape') {
        setSelectedNode(null);
      }
      
      // Cmd+K (Mac) or Ctrl+K (Windows/Linux) to focus search
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
      
      // Cmd+Backspace (Mac) or Ctrl+Backspace (Windows/Linux) to clear search
      if ((event.metaKey || event.ctrlKey) && event.key === 'Backspace') {
        event.preventDefault();
        setSearchTerm('');
        searchInputRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // settings-related handlers removed

  const handleSearchChange = (term: string) => {
    setSearchTerm(term);
  };

  const filteredLayout = useMemo(() => {
    if (!layout || !graphData) return null;

    let filteredNodes = layout.nodes;
    let filteredLinks = layout.links;

    // Apply entity type filter
    if (selectedEntityTypes.size > 0) {
      filteredNodes = filteredNodes.filter(node => selectedEntityTypes.has(node.type));
    }

    // Apply level filter
    if (selectedLevel !== null) {
      filteredNodes = filteredNodes.filter(node => node.communityLevel === selectedLevel);
    }

    // DON'T filter by search term here - pass to GraphVisualizer instead
    // This prevents nodes from being removed and repositioned

    // Filter links based on visible nodes and weight
    const visibleNodeIds = new Set(filteredNodes.map(node => node.id));
    filteredLinks = filteredLinks.filter(link => 
      link.weight >= minRelationshipWeight &&
      visibleNodeIds.has(link.source.id) && 
      visibleNodeIds.has(link.target.id)
    );

    return {
      nodes: filteredNodes,
      links: filteredLinks,
      communities: layout.communities,
    };
  }, [layout, graphData, selectedEntityTypes, selectedLevel, minRelationshipWeight]);

  const connectedLinks = useMemo(() => {
    if (!selectedNode || !filteredLayout) return [];
    return filteredLayout.links.filter(link => 
      link.source.id === selectedNode.id || link.target.id === selectedNode.id
    );
  }, [selectedNode, filteredLayout]);

  // When chat updates highlights, reflect them (unused handler removed)

  // Helper function to get complete subtree under the L0 parent of selected community
  const getCompleteHierarchyTree = useCallback((selectedCommunity: Community, allCommunities: Community[]) => {
    if (!selectedCommunity || !allCommunities || allCommunities.length === 0) {
      return [];
    }

      // debug log removed in production sweep

    // Create efficient lookup maps
    const communityByHumanIdMap = new Map<string, Community>(allCommunities.map(c => [String(c.human_readable_id), c]));
    
    // Build parent-child map
    const childrenByParentId = new Map<string, Community[]>();
    allCommunities.forEach(community => {
      if (community.parent !== undefined) {
        const parentId = String(community.parent);
        if (!childrenByParentId.has(parentId)) {
          childrenByParentId.set(parentId, []);
        }
        childrenByParentId.get(parentId)!.push(community);
      }
    });

    try {
      // Step 1: Find the L0 root by walking up the tree
      let currentCommunity: Community | undefined = selectedCommunity;
      const pathToRoot = [currentCommunity];
      
      while (currentCommunity && currentCommunity.parent !== undefined) {
        const parentId = String(currentCommunity.parent);
        const parentCommunity = communityByHumanIdMap.get(parentId);
        
        if (!parentCommunity) break;
        
        pathToRoot.unshift(parentCommunity);
        currentCommunity = parentCommunity;
        
        // Safety check to prevent infinite loops
        if (pathToRoot.length > 10) break;
      }
      
      // The first item should be the L0 root
      const rootCommunity = pathToRoot[0];
      // debug log removed in production sweep
      
      // Step 2: Collect entire subtree under this L0 root
      const subtreeCommunities = new Set<string>();
      const queue: Community[] = [rootCommunity];
      const visited = new Set<string>();
      
      while (queue.length > 0) {
        const community = queue.shift()!;
        
        if (!community || visited.has(community.id)) continue;
        
        visited.add(community.id);
        subtreeCommunities.add(community.id);
        
        // Add all children to queue
        const children = childrenByParentId.get(String(community.human_readable_id)) || [];
        
        // Also check the children array if available
        community.children.forEach((childHumanId: string) => {
          const childCommunity = communityByHumanIdMap.get(String(childHumanId));
          if (childCommunity && !children.some(c => c.id === childCommunity.id)) {
            children.push(childCommunity);
          }
        });
        
        children.forEach(childCommunity => {
          if (!visited.has(childCommunity.id)) {
            queue.push(childCommunity);
          }
        });
      }

      const result = allCommunities
        .filter(c => subtreeCommunities.has(c.id))
        .sort((a, b) => (a.level || 0) - (b.level || 0));
      
      // debug log removed in production sweep
      
      return result;
      
    } catch (error) {
      console.warn('Error building community subtree:', error);
      // Fallback to just the selected community
      return [selectedCommunity];
    }
  }, []);

  // Calculate which communities to show based on selected node and inspector mode
  const visibleCommunities = useMemo(() => {
    if (!layout?.communities) return [];
    
    // Inspector mode shows hierarchy tree when node selected
    if (inspectorMode && selectedNode) {
      // If node has community, show hierarchy tree
      if (selectedNode.community) {
        return getCompleteHierarchyTree(selectedNode.community, layout.communities);
      }
      // If node has no community, show no communities
      return [];
    }
    
    // Default: show all communities
    return layout.communities;
  }, [layout?.communities, selectedNode, inspectorMode, getCompleteHierarchyTree]);

  // Determine effective community mode for components
  const effectiveCommunityMode = inspectorMode && selectedNode ? 'auto' : 'all';

  const handleRetry = () => {
    setError(null);
    window.location.reload();
  };


  // No key management UI in OpenAI-only mode

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background" data-hmi-root>
      {/* Main Content */}
      <div className="h-full w-full overflow-hidden">
        {/* Graph owns the full viewport. Inspector overlays it only when selected. */}
        <div className="absolute inset-0 z-0">
          <div className="h-full">
            <GraphVisualizer
              layout={filteredLayout}
              loading={loading}
              error={error}
              status={status}
              onRetry={handleRetry}
              selectedEntityTypes={selectedEntityTypes}
              minRelationshipWeight={minRelationshipWeight}
              showCommunityBoundaries={true}
              visibleCommunities={visibleCommunities}
              communityMode={effectiveCommunityMode}
              selectedLevel={selectedLevel}
              onNodeSelect={setSelectedNode}
              selectedNode={selectedNode}
              ragHighlightedNodeIds={ragHighlightedNodeIds}
              searchTerm={searchTerm}
              onNodeHover={setHoveredNode}
              hoveredNode={hoveredNode}
              viewportOffset={selectedNode ? 420 : 0}
            />
          </div>
        </div>

        {selectedNode && (
          <div className="graphrag-inspector-enter absolute inset-y-0 left-0 z-30 w-[420px] border-r border-white/15 pointer-events-auto">
          <Inspector
            selectedNode={selectedNode}
            connectedLinks={connectedLinks}
            visibleCommunities={visibleCommunities}
            communityMode={effectiveCommunityMode}
            onClose={() => setSelectedNode(null)}
            onNodeSelect={setSelectedNode}
            projectName={currentProjectName}
          />
          </div>
        )}
      </div>

      {!selectedNode && currentProjectName && (
        <div className="pointer-events-none absolute left-4 top-4 z-20 border border-white/12 bg-[#05080b]/68 px-3 py-2 backdrop-blur-xl">
          <div className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted-foreground">Current project</div>
          <div className="mt-0.5 max-w-64 truncate text-[11px] font-medium">{currentProjectName}</div>
        </div>
      )}
      
      {/* Floating Search and Settings Controls */}
      <div className="absolute right-4 top-4 z-20 flex items-center gap-1">
        <div className="relative">
          <div className="relative">
            <Input
              ref={searchInputRef}
              placeholder="Search entities..."
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="h-9 w-56 rounded-none border-white/15 bg-[#05080b]/76 pr-16 text-[11px] backdrop-blur-xl placeholder:text-muted-foreground/70 focus-visible:border-primary"
            />
            <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
              {searchTerm && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchTerm('');
                    searchInputRef.current?.focus();
                  }}
                  className="h-6 w-6 rounded-none p-0 hover:bg-white/[0.07]"
                  title="Clear search"
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
              <kbd className="pointer-events-none inline-flex h-5 items-center gap-1 border-l border-white/10 px-1.5 font-mono text-[9px] uppercase text-muted-foreground select-none">
                <span>⌘</span>K
              </kbd>
            </div>
          </div>
        </div>
        
        {/* GitHub Link */}
        <Button
          variant="outline"
          size="icon"
          asChild
          className="ml-1 h-9 w-9 rounded-none border-white/15 bg-[#05080b]/76 backdrop-blur-xl hover:bg-white/[0.07]"
        >
          <a
            href="https://github.com/lyon-industries/graphrag-workbench"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="View source on GitHub"
            title="GitHub"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
          </a>
        </Button>

        {/* Isolator Mode Toggle */}
        <Button
          variant="outline"
          size="sm"
          aria-pressed={inspectorMode}
          onClick={() => setInspectorMode(active => !active)}
          className={`h-9 rounded-none border-white/15 bg-[#05080b]/76 px-3 font-mono text-[9px] uppercase tracking-[0.08em] backdrop-blur-xl hover:bg-white/[0.07] ${inspectorMode ? 'border-primary text-primary' : ''}`}
          title="Show the selected entity's community hierarchy"
        >
          <Eye className="h-3.5 w-3.5" />
          Isolate community
        </Button>

        <Button
          variant="outline"
          size="sm"
          className={`ml-1 h-9 rounded-none border-white/15 bg-[#05080b]/76 px-3 font-mono text-[9px] uppercase tracking-[0.08em] backdrop-blur-xl hover:bg-white/[0.07] ${buildRunning ? 'border-primary/60' : ''}`}
          onClick={() => setProjectPanelOpen(true)}
          aria-label={buildRunning ? 'Open projects — build in progress' : 'Open projects'}
          title={buildRunning ? 'Projects · build in progress' : 'Projects'}
        >
          {buildRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> : <FolderKanban className="h-3.5 w-3.5" />}
          Projects
          {buildRunning && <span className="ml-0.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" aria-hidden />}
        </Button>

        {/* Settings removed */}
      </div>

      <Sheet open={projectPanelOpen || projectNameRequired} onOpenChange={(open) => {
        if (!open && projectNameRequired) return;
        setProjectPanelOpen(open);
      }}>
        <SheetContent className="w-[min(760px,calc(100vw-32px))] max-w-none gap-0 p-0 sm:max-w-none">
          <SheetHeader className="sr-only">
            <SheetTitle>Projects</SheetTitle>
            <SheetDescription>Create, load, rename, delete, inspect, and index local GraphRAG projects.</SheetDescription>
          </SheetHeader>
          <CorpusPanel onProjectNamed={(name) => {
            setCurrentProjectName(name);
            setProjectNameRequired(false);
          }} onProjectDeleted={() => {
            setCurrentProjectName('');
            setProjectNameRequired(true);
            setProjectPanelOpen(true);
          }} />
        </SheetContent>
      </Sheet>
      
      {/* Settings modal removed */}

    </div>
  );
}
