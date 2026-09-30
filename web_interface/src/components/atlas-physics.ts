export interface AtlasPoint { x: number; y: number }
export interface AtlasLayoutNode extends AtlasPoint { path: string; parent: string; title: string; kind: "folder" | "file" }
interface Body extends AtlasLayoutNode { targetX: number; targetY: number; vx: number; vy: number; width: number; height: number }
const CELL = 200;
const MAX_SPEED = 22;
const limit = (value: number, max: number) => Math.max(-max, Math.min(max, value));

/** A small deterministic force field. Paths are IDs; node metadata never leaves the browser. */
export class AtlasPhysics {
  private readonly bodies = new Map<string, Body>();
  private grabbed: string | null = null;
  private restingFrames = 0;

  sync(layout: readonly AtlasLayoutNode[], settle = true): void {
    const paths = new Set(layout.map((node) => node.path));
    for (const path of this.bodies.keys()) if (!paths.has(path)) this.bodies.delete(path);
    for (const node of layout) {
      const width = node.path ? Math.min(182, Math.max(92, Math.min(23, node.title.length) * 7.4 + 22)) : 166;
      const height = node.path ? node.kind === "folder" ? 124 : 92 : 166;
      const old = this.bodies.get(node.path);
      if (old) {
        Object.assign(old, { parent: node.parent, title: node.title, kind: node.kind,
          targetX: node.x, targetY: node.y, width, height });
      } else this.bodies.set(node.path, { ...node, targetX: node.x, targetY: node.y, vx: 0, vy: 0, width, height });
    }
    this.restingFrames = 0;
    if (settle) for (let i = 0; i < Math.min(36, Math.max(6, 7200 / Math.max(1, layout.length))); i++) this.step();
  }

  point(path: string): AtlasPoint | undefined {
    const node = this.bodies.get(path);
    return node && { x: node.x, y: node.y };
  }

  positions(): Record<string, AtlasPoint> {
    return Object.fromEntries([...this.bodies].map(([path, node]) => [path, { x: node.x, y: node.y }]));
  }

  grab(path: string): void {
    if (!path || !this.bodies.has(path)) return;
    this.grabbed = path;
    const node = this.bodies.get(path)!;
    node.vx = 0; node.vy = 0;
    this.restingFrames = 0;
  }
  move(path: string, x: number, y: number): void {
    if (this.grabbed !== path) return;
    const node = this.bodies.get(path)!;
    const fromCore = Math.hypot(x, y);
    if (fromCore < 190) {
      const scale = 190 / Math.max(1, fromCore);
      x = fromCore < 1 ? 190 : x * scale;
      y = fromCore < 1 ? 0 : y * scale;
    }
    node.x = x; node.y = y; node.vx = 0; node.vy = 0;
    this.restingFrames = 0;
  }
  release(): void { this.grabbed = null; this.restingFrames = 0; }

  reset(): void {
    this.grabbed = null; this.restingFrames = 0;
    for (const node of this.bodies.values()) {
      node.x = node.targetX; node.y = node.targetY; node.vx = 0; node.vy = 0;
    }
    for (let i = 0; i < 36; i++) this.step();
  }

  /** Returns false after the field settles, so callers can stop requesting frames. */
  step(): boolean {
    const bodies = [...this.bodies.values()];
    const force = new Map(bodies.map((node) => [node.path, { x: 0, y: 0 }]));
    for (const node of bodies) {
      if (!node.path || node.path === this.grabbed) continue;
      const f = force.get(node.path)!;
      f.x += (node.targetX - node.x) * .0025;
      f.y += (node.targetY - node.y) * .0025;
      const parent = this.bodies.get(node.parent);
      if (!parent) continue;
      const dx = node.x - parent.x, dy = node.y - parent.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const rest = Math.max(190, Math.hypot(node.targetX - parent.targetX, node.targetY - parent.targetY));
      const pull = limit((distance - rest) * .009, 7);
      f.x -= dx / distance * pull; f.y -= dy / distance * pull;
      if (parent.path && parent.path !== this.grabbed) {
        const pf = force.get(parent.path)!;
        pf.x += dx / distance * pull * .36; pf.y += dy / distance * pull * .36;
      }
    }
    const buckets = new Map<string, Body[]>();
    const key = (x: number, y: number) => `${x},${y}`;
    for (const node of bodies) {
      const cx = Math.floor(node.x / CELL), cy = Math.floor(node.y / CELL);
      const slot = key(cx, cy);
      const bucket = buckets.get(slot) ?? [];
      bucket.push(node); buckets.set(slot, bucket);
    }
    for (const a of bodies) {
      const cx = Math.floor(a.x / CELL), cy = Math.floor(a.y / CELL);
      for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const b of buckets.get(key(gx, gy)) ?? []) {
          if (a.path >= b.path) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const overlapX = (a.width + b.width) / 2 + 12 - Math.abs(dx);
          const overlapY = (a.height + b.height) / 2 + 12 - Math.abs(dy);
          if (overlapX <= 0 || overlapY <= 0) continue;
          const horizontal = overlapX / ((a.width + b.width) / 2) < overlapY / ((a.height + b.height) / 2);
          const sign = (horizontal ? dx : dy) < 0 ? -1 : 1;
          const push = limit((horizontal ? overlapX : overlapY) * .8, 16) * sign;
          const af = force.get(a.path)!, bf = force.get(b.path)!;
          if (horizontal) { if (a.path && a.path !== this.grabbed) af.x -= push; if (b.path && b.path !== this.grabbed) bf.x += push; }
          else { if (a.path && a.path !== this.grabbed) af.y -= push; if (b.path && b.path !== this.grabbed) bf.y += push; }
        }
      }
    }
    let motion = 0;
    for (const node of bodies) {
      if (!node.path || node.path === this.grabbed) continue;
      const f = force.get(node.path)!;
      node.vx = limit((node.vx + f.x) * .78, MAX_SPEED);
      node.vy = limit((node.vy + f.y) * .78, MAX_SPEED);
      node.x += node.vx; node.y += node.vy;
      motion = Math.max(motion, Math.abs(node.vx), Math.abs(node.vy));
    }
    // The force field gives motion; this constraint guarantees that labels
    // remain disjoint even when many names share one branch of the graph.
    for (let pass = 0; pass < 2; pass++) {
      const cells = new Map<string, Body[]>();
      for (const node of bodies) {
        const slot = key(Math.floor(node.x / CELL), Math.floor(node.y / CELL));
        const bucket = cells.get(slot) ?? [];
        bucket.push(node); cells.set(slot, bucket);
      }
      for (const a of bodies) {
        const cx = Math.floor(a.x / CELL), cy = Math.floor(a.y / CELL);
        for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
          for (const b of cells.get(key(gx, gy)) ?? []) {
            if (a.path >= b.path) continue;
            const dx = b.x - a.x, dy = b.y - a.y;
            const ox = (a.width + b.width) / 2 + 7 - Math.abs(dx);
            const oy = (a.height + b.height) / 2 + 7 - Math.abs(dy);
            if (ox <= 0 || oy <= 0) continue;
            const horizontal = ox / ((a.width + b.width) / 2) < oy / ((a.height + b.height) / 2);
            const distance = horizontal ? ox : oy;
            const sign = (horizontal ? dx : dy) < 0 ? -1 : 1;
            const canA = Boolean(a.path && a.path !== this.grabbed), canB = Boolean(b.path && b.path !== this.grabbed);
            const amountA = canA ? distance / (canB ? 2 : 1) : 0;
            const amountB = canB ? distance / (canA ? 2 : 1) : 0;
            if (horizontal) { a.x -= sign * amountA; b.x += sign * amountB; }
            else { a.y -= sign * amountA; b.y += sign * amountB; }
          }
        }
      }
    }
    this.restingFrames = motion < .07 ? this.restingFrames + 1 : 0;
    return this.restingFrames < 12;
  }
}

/** Direct, gently flexible connection that follows the current endpoints. */
export function atlasEdge(a: AtlasPoint, b: AtlasPoint): string {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const bend = Math.min(12, length * .035);
  const mx = (a.x + b.x) / 2 - dy / length * bend;
  const my = (a.y + b.y) / 2 + dx / length * bend;
  return `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;
}
