import { mkdirSync, appendFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const BUFFER_FLUSH_SIZE = 100;

export class DebugLogger {
  private sessionId: string;
  private dir: string;
  private debugSims: Set<number>;
  private buffers: Map<number, string[]>;

  constructor(options?: { debugSims?: number[]; dir?: string }) {
    this.sessionId = randomUUID();
    this.dir = options?.dir ?? join('/tmp', `debug-${this.sessionId}`);
    mkdirSync(this.dir, { recursive: true });

    const sims = options?.debugSims ?? [0, 1, 2];
    // Sim 0 is always included
    if (!sims.includes(0)) {
      sims.unshift(0);
    }
    this.debugSims = new Set(sims);
    this.buffers = new Map();
  }

  shouldLog(sim: number): boolean {
    return this.debugSims.has(sim);
  }

  log(sim: number, data: Record<string, unknown>): void {
    if (!this.shouldLog(sim)) {
      return;
    }

    const entry = { sim, ...data, at: new Date().toISOString() };
    const line = JSON.stringify(entry) + '\n';

    let buffer = this.buffers.get(sim);
    if (!buffer) {
      buffer = [];
      this.buffers.set(sim, buffer);
    }
    buffer.push(line);

    if (buffer.length >= BUFFER_FLUSH_SIZE) {
      this.flushSim(sim);
    }
  }

  getDir(): string {
    return this.dir;
  }

  writeMeta(meta: Record<string, unknown>): void {
    writeFileSync(join(this.dir, 'meta.json'), JSON.stringify(meta, null, 2));
  }

  close(): void {
    for (const sim of this.buffers.keys()) {
      this.flushSim(sim);
    }
  }

  private fileForSim(sim: number): string {
    return sim === 0 ? 'det.jsonl' : `sim-${sim}.jsonl`;
  }

  private flushSim(sim: number): void {
    const buffer = this.buffers.get(sim);
    if (!buffer || buffer.length === 0) {
      return;
    }
    const filePath = join(this.dir, this.fileForSim(sim));
    appendFileSync(filePath, buffer.join(''));
    buffer.length = 0;
  }
}
