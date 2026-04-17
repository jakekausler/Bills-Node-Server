// Project test conventions discovered:
// - Framework: Vitest with vi.mock()
// - Mocking: vi.mock() for modules, vi.fn() for functions
// - Assertions: expect() with toBe, toEqual, toHaveBeenCalledWith, etc.
// - Async: sync middleware (next/res.setHeader are synchronous here)
// - Structure: describe/it with beforeEach

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Mock DebugLogger so the constructor doesn't touch the filesystem
// ---------------------------------------------------------------------------
vi.mock('../calculate-v3/debug-logger', () => {
  const mockGetDir = vi.fn().mockReturnValue('/tmp/debug-mocked-uuid');
  const MockDebugLogger = vi.fn().mockImplementation(() => ({
    getDir: mockGetDir,
  }));
  return { DebugLogger: MockDebugLogger };
});

import { DebugLogger } from '../calculate-v3/debug-logger';
import { debugLoggerMiddleware } from './debugLoggerMiddleware';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeReq(query: Record<string, string> = {}): Request {
  return { query } as unknown as Request;
}

function makeRes(): Response {
  return {
    setHeader: vi.fn(),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('debugLoggerMiddleware', () => {
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset getDir mock to a stable /tmp/debug-* value after clearAllMocks
    const MockDebugLogger = DebugLogger as ReturnType<typeof vi.fn>;
    MockDebugLogger.mockImplementation(() => ({
      getDir: vi.fn().mockReturnValue('/tmp/debug-test-uuid'),
    }));
    next = vi.fn();
  });

  it('creates DebugLogger and sets header when debug=true', () => {
    const req = makeReq({ debug: 'true' });
    const res = makeRes();

    debugLoggerMiddleware(req, res, next);

    // req._debugLogger should be the DebugLogger instance
    expect(req._debugLogger).toBeTruthy();
    expect(DebugLogger).toHaveBeenCalledOnce();

    // X-Debug-Log-Dir header should be set with a /tmp/debug-* path
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Debug-Log-Dir',
      expect.stringMatching(/^\/tmp\/debug-/),
    );

    // next called exactly once
    expect(next).toHaveBeenCalledOnce();
  });

  it('skips when debug query param is absent', () => {
    const req = makeReq({});
    const res = makeRes();

    debugLoggerMiddleware(req, res, next);

    expect(req._debugLogger).toBeUndefined();
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('skips when debug=false', () => {
    const req = makeReq({ debug: 'false' });
    const res = makeRes();

    debugLoggerMiddleware(req, res, next);

    expect(req._debugLogger).toBeUndefined();
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('does not honor debugLogDir query param (no path override)', () => {
    const req = makeReq({ debug: 'true', debugLogDir: '/etc/evil' });
    const res = makeRes();

    debugLoggerMiddleware(req, res, next);

    // Header should be set, but path must NOT start with /etc/evil
    expect(res.setHeader).toHaveBeenCalledOnce();
    const [headerName, headerValue] = (res.setHeader as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(headerName).toBe('X-Debug-Log-Dir');
    expect(typeof headerValue).toBe('string');
    expect(headerValue).not.toMatch(/^\/etc\/evil/);
    expect(headerValue).toMatch(/^\/tmp\/debug-/);
  });
});
