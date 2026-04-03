// Standalone projections cache — avoids circular dependency with engine/IO modules
const projectionsCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function getProjectionsCache(key: string): any | null {
  const cached = projectionsCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
}

export function setProjectionsCache(key: string, data: any): void {
  projectionsCache.set(key, { data, timestamp: Date.now() });
}

export function clearProjectionsCache(): void {
  projectionsCache.clear();
}
