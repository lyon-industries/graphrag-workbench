declare module 'd3-force-3d' {
  export interface SimulationLinkDatum<NodeDatum> {
    source: NodeDatum | string | number
    target: NodeDatum | string | number
  }

  export interface Simulation<NodeDatum, LinkDatum> {
    force(name: string): any
    force(name: string, force: any): this
    alpha(): number
    alpha(value: number): this
    alphaDecay(value: number): this
    alphaMin(value: number): this
    nodes(nodes: NodeDatum[]): this
    on(type: string, listener: () => void): this
    restart(): this
    stop(): this
  }

  export function forceSimulation<NodeDatum>(): Simulation<NodeDatum, undefined>
  export function forceLink<NodeDatum, LinkDatum extends SimulationLinkDatum<NodeDatum>>(): any
  export function forceManyBody(): any
  export function forceCenter(x?: number, y?: number, z?: number): any
  export function forceCollide(): any
}
