import { load, save } from './io';
import { Asset } from '../../data/asset/asset';
import { AssetData } from '../../data/asset/types';

const FILE_NAME = 'data';

/**
 * Loads assets from data.json
 * @param simulation - Simulation name (unused, for interface consistency)
 * @returns Array of Asset objects
 */
export function loadAssets(simulation: string = 'Default'): Asset[] {
  try {
    const data = load<{ assets?: AssetData[] }>(FILE_NAME + '.json');
    if (!data.assets || !Array.isArray(data.assets)) {
      return [];
    }
    return data.assets.map((assetData) => new Asset(assetData));
  } catch {
    // If file doesn't exist or parse fails, return empty array
    return [];
  }
}

/**
 * Saves assets to data.json, merging with existing data
 * @param assets - Array of Asset objects to save
 * @param simulation - Simulation name (unused, for interface consistency)
 */
export function saveAssets(assets: Asset[], simulation: string = 'Default'): void {
  // Load existing data to preserve other properties
  let data: any;
  try {
    data = load<any>(FILE_NAME + '.json');
  } catch {
    data = {};
  }

  // Update assets array
  data.assets = assets.map((asset) => asset.serialize());

  // Save back
  save(data, FILE_NAME + '.json');
}
