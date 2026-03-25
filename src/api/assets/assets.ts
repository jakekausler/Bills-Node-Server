import { Request } from 'express';
import { Asset } from '../../data/asset/asset';
import { AssetData } from '../../data/asset/types';
import { loadAssets, saveAssets } from '../../utils/io/assets';
import { getData } from '../../utils/net/request';

/**
 * Retrieves all assets
 * @param request - Express request object
 * @returns Array of asset objects
 */
export async function getAssets(request: Request) {
  const data = await getData(request);
  const assets = loadAssets(data.simulation);
  return assets.map((asset) => asset.serialize());
}

/**
 * Validates that account IDs exist in the current data
 * @param accountId - Account ID to validate
 * @param data - Current data object containing accounts
 * @returns True if account exists
 */
function accountExists(accountId: string, data: any): boolean {
  return data.accountsAndTransfers.accounts.some((acc: any) => acc.id === accountId);
}

/**
 * Validates asset data for mutual exclusivity and references
 * @param assetData - Asset data to validate
 * @param existingAccounts - Set of valid account IDs
 * @throws Error if validation fails
 */
function validateAsset(assetData: AssetData, existingAccounts: Set<string>): void {
  // Check mutual exclusivity: if depreciationSchedule is set, appreciation must be 0/false/null
  if (assetData.depreciationSchedule && assetData.depreciationSchedule.length > 0) {
    if (assetData.appreciation !== 0) {
      throw new Error('appreciation must be 0 when depreciationSchedule is set');
    }
    if (assetData.appreciationIsVariable !== false) {
      throw new Error('appreciationIsVariable must be false when depreciationSchedule is set');
    }
    if (assetData.appreciationVariable !== null) {
      throw new Error('appreciationVariable must be null when depreciationSchedule is set');
    }
  }

  // Validate payFromAccount if set
  if (assetData.payFromAccount && !existingAccounts.has(assetData.payFromAccount)) {
    throw new Error(`payFromAccount ${assetData.payFromAccount} does not exist`);
  }

  // Validate linkedAccounts
  if (assetData.linkedAccounts && assetData.linkedAccounts.length > 0) {
    for (const accountId of assetData.linkedAccounts) {
      if (!existingAccounts.has(accountId)) {
        throw new Error(`linkedAccount ${accountId} does not exist`);
      }
    }
  }

  // currentValueDate must be >= purchaseDate
  const purchaseDate = new Date(assetData.purchaseDate);
  const currentValueDate = new Date(assetData.currentValueDate);
  if (currentValueDate < purchaseDate) {
    throw new Error('currentValueDate must be >= purchaseDate');
  }
}

/**
 * Creates a new asset
 * @param request - Express request object containing asset data
 * @returns ID of the newly created asset
 */
export async function addAsset(request: Request) {
  const data = await getData<AssetData>(request);
  const accountIds = new Set(data.accountsAndTransfers.accounts.map((acc: any) => acc.id));

  validateAsset(data.data, accountIds);

  const assets = loadAssets(data.simulation);
  const newAsset = new Asset(data.data);
  assets.push(newAsset);
  saveAssets(assets, data.simulation);

  return newAsset.id;
}

/**
 * Updates an asset
 * @param request - Express request object containing asset update data
 * @returns Updated asset data
 */
export async function updateAsset(request: Request) {
  const data = await getData<AssetData>(request);
  const assetId = request.params.assetId;

  if (!assetId) {
    throw new Error('assetId is required');
  }

  const accountIds = new Set(data.accountsAndTransfers.accounts.map((acc: any) => acc.id));
  validateAsset(data.data, accountIds);

  const assets = loadAssets(data.simulation);
  const assetIndex = assets.findIndex((a) => a.id === assetId);

  if (assetIndex === -1) {
    throw new Error(`Asset ${assetId} not found`);
  }

  assets[assetIndex] = new Asset(data.data);
  saveAssets(assets, data.simulation);

  return assets[assetIndex].serialize();
}

/**
 * Deletes an asset
 * @param request - Express request object
 * @returns Deleted asset ID
 */
export async function deleteAsset(request: Request) {
  const data = await getData(request);
  const assetId = request.params.assetId;

  if (!assetId) {
    throw new Error('assetId is required');
  }

  const assets = loadAssets(data.simulation);
  const assetIndex = assets.findIndex((a) => a.id === assetId);

  if (assetIndex === -1) {
    throw new Error(`Asset ${assetId} not found`);
  }

  const deletedAsset = assets[assetIndex];
  assets.splice(assetIndex, 1);
  saveAssets(assets, data.simulation);

  return deletedAsset.id;
}
