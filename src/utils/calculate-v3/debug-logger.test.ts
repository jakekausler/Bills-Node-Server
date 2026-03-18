import { describe, it, expect, afterEach, vi } from 'vitest';
import { DebugLogger } from './debug-logger';
import { existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';

describe('DebugLogger', () => {
  const dirs: string[] = [];

  function makeLogger(options?: { debugSims?: number[] }): DebugLogger {
    const logger = new DebugLogger(options);
    dirs.push(logger.getDir());
    return logger;
  }

  afterEach(() => {
    for (const dir of dirs) {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    dirs.length = 0;
  });

  it('creates directory in /tmp', () => {
    const logger = makeLogger();
    expect(logger.getDir()).toMatch(/^\/tmp\/debug-/);
    expect(existsSync(logger.getDir())).toBe(true);
  });

  it('writes JSONL lines to det.jsonl for sim 0', () => {
    const logger = makeLogger();
    logger.log(0, { msg: 'hello' });
    logger.close();

    const filePath = join(logger.getDir(), 'det.jsonl');
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content.trim());
    expect(parsed.msg).toBe('hello');
  });

  it('writes JSONL lines to sim-1.jsonl for sim 1', () => {
    const logger = makeLogger();
    logger.log(1, { msg: 'mc1' });
    logger.close();

    const filePath = join(logger.getDir(), 'sim-1.jsonl');
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content.trim());
    expect(parsed.msg).toBe('mc1');
  });

  it('filters sims not in debugSims', () => {
    const logger = makeLogger({ debugSims: [0, 1] });
    logger.log(5, { msg: 'should not appear' });
    logger.close();

    const filePath = join(logger.getDir(), 'sim-5.jsonl');
    expect(existsSync(filePath)).toBe(false);
  });

  it('shouldLog returns correct values', () => {
    const logger = makeLogger({ debugSims: [0, 3] });
    expect(logger.shouldLog(0)).toBe(true);
    expect(logger.shouldLog(3)).toBe(true);
    expect(logger.shouldLog(1)).toBe(false);
    expect(logger.shouldLog(99)).toBe(false);
  });

  it('auto-adds "at" field with ISO timestamp', () => {
    const logger = makeLogger();
    const before = new Date().toISOString();
    logger.log(0, { x: 1 });
    logger.close();

    const content = readFileSync(join(logger.getDir(), 'det.jsonl'), 'utf-8');
    const parsed = JSON.parse(content.trim());
    expect(parsed.at).toBeDefined();
    expect(typeof parsed.at).toBe('string');
    // Verify it's a valid ISO date
    expect(new Date(parsed.at).toISOString()).toBe(parsed.at);
  });

  it('flushes buffer on close', () => {
    const logger = makeLogger();
    // Write fewer than 100 lines — should only appear after close
    for (let i = 0; i < 5; i++) {
      logger.log(0, { i });
    }

    const filePath = join(logger.getDir(), 'det.jsonl');
    // Before close, file may not exist (buffered)
    logger.close();

    expect(existsSync(filePath)).toBe(true);
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(5);
  });

  it('flushes automatically at 100 lines', () => {
    const logger = makeLogger();
    for (let i = 0; i < 100; i++) {
      logger.log(0, { i });
    }

    // After 100 lines the buffer should have flushed
    const filePath = join(logger.getDir(), 'det.jsonl');
    expect(existsSync(filePath)).toBe(true);
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(100);

    logger.close();
  });

  it('writeMeta creates meta.json', () => {
    const logger = makeLogger();
    logger.writeMeta({ sims: 20, seed: 12345 });

    const filePath = join(logger.getDir(), 'meta.json');
    expect(existsSync(filePath)).toBe(true);
    const content = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(content.sims).toBe(20);
    expect(content.seed).toBe(12345);
  });

  it('always includes sim 0 even if not specified', () => {
    const logger = makeLogger({ debugSims: [5, 10] });
    expect(logger.shouldLog(0)).toBe(true);
    expect(logger.shouldLog(5)).toBe(true);
    expect(logger.shouldLog(10)).toBe(true);
    expect(logger.shouldLog(1)).toBe(false);
  });

  it('handles null and undefined values in data gracefully', () => {
    const logger = makeLogger();
    logger.log(0, { a: null as unknown as string, b: undefined as unknown as string });
    logger.close();

    const content = readFileSync(join(logger.getDir(), 'det.jsonl'), 'utf-8');
    const parsed = JSON.parse(content.trim());
    expect(parsed.a).toBeNull();
    // undefined fields are dropped by JSON.stringify
    expect(parsed.b).toBeUndefined();
    expect('b' in parsed).toBe(false);
  });

  it('defaults to debugSims [0, 1, 2]', () => {
    const logger = makeLogger();
    expect(logger.shouldLog(0)).toBe(true);
    expect(logger.shouldLog(1)).toBe(true);
    expect(logger.shouldLog(2)).toBe(true);
    expect(logger.shouldLog(3)).toBe(false);
  });

  it('writes multiple sims to separate files', () => {
    const logger = makeLogger();
    logger.log(0, { type: 'det' });
    logger.log(1, { type: 'mc1' });
    logger.log(2, { type: 'mc2' });
    logger.close();

    const det = JSON.parse(readFileSync(join(logger.getDir(), 'det.jsonl'), 'utf-8').trim());
    const mc1 = JSON.parse(readFileSync(join(logger.getDir(), 'sim-1.jsonl'), 'utf-8').trim());
    const mc2 = JSON.parse(readFileSync(join(logger.getDir(), 'sim-2.jsonl'), 'utf-8').trim());

    expect(det.type).toBe('det');
    expect(mc1.type).toBe('mc1');
    expect(mc2.type).toBe('mc2');
  });
});
