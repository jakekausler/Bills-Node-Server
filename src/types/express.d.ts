import type { DebugLogger } from '../utils/calculate-v3/debug-logger';

declare global {
  namespace Express {
    interface Request {
      _debugLogger?: DebugLogger;
    }
  }
}
