import { Request, Response, NextFunction } from 'express';
import { DebugLogger } from '../calculate-v3/debug-logger';

/**
 * Express middleware that attaches a DebugLogger to the request when
 * the query parameter `?debug=true` is present.
 *
 * Sets `req._debugLogger` so that `getData()` in request.ts picks it up
 * automatically via existing plumbing.
 *
 * Also sets the `X-Debug-Log-Dir` response header so callers know where
 * the output was written.
 *
 * Supported query parameters:
 *   - `?debug=true`  — enable debug logging for this request
 *
 * The log directory is always auto-generated as /tmp/debug-<uuid>/.
 * It cannot be overridden via query parameters.
 *
 * To force cache bypass, pass ?forceRecalculation=true separately.
 * Debug logging and cache behavior are independent.
 */
export function debugLoggerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.query.debug === 'true') {
    const logger = new DebugLogger({
      debugSims: [0],
    });

    req._debugLogger = logger;
    res.setHeader('X-Debug-Log-Dir', logger.getDir());
  }

  next();
}
