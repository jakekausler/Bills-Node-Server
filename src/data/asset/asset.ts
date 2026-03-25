import { v4 as uuidv4 } from 'uuid';
import { AssetData, Asset, ReplacementCycleData } from './types';
import { formatDate, parseDate } from '../../utils/date/date';
import { DateString } from '../../utils/date/types';

/**
 * Represents a personal asset (home, vehicle, appliance)
 * Tracks value through appreciation/depreciation and replacement cycles
 */
export class Asset implements Asset {
  id: string;
  name: string;
  type: 'home' | 'vehicle' | 'appliance' | 'other';

  purchaseDate: Date;
  purchasePrice: number;
  currentValue: number;
  currentValueDate: Date;

  appreciation: number;
  appreciationIsVariable: boolean;
  appreciationVariable: string | null;

  depreciationSchedule: number[] | null;
  replacementCycle: ReplacementCycleData | null;

  linkedAccounts: string[];
  linkedBills: string[];

  payFromAccount: string | null;

  sellingCosts: number;
  capitalGainsExclusion: number;
  saleRule: unknown | null;
  helocRule: unknown | null;
  status: 'owned' | 'sold';

  /**
   * Creates a new Asset instance
   * @param data - Asset data object
   */
  constructor(data: AssetData) {
    this.id = data.id || uuidv4();
    this.name = data.name;
    this.type = data.type;

    this.purchaseDate = parseDate(data.purchaseDate as DateString);
    this.purchasePrice = data.purchasePrice;
    this.currentValue = data.currentValue;
    this.currentValueDate = parseDate(data.currentValueDate as DateString);

    this.appreciation = data.appreciation ?? 0;
    this.appreciationIsVariable = data.appreciationIsVariable ?? false;
    this.appreciationVariable = data.appreciationVariable ?? null;

    this.depreciationSchedule = data.depreciationSchedule ?? null;
    this.replacementCycle = data.replacementCycle ?? null;

    this.linkedAccounts = data.linkedAccounts ?? [];
    this.linkedBills = data.linkedBills ?? [];

    this.payFromAccount = data.payFromAccount ?? null;

    this.sellingCosts = data.sellingCosts ?? 0;
    this.capitalGainsExclusion = data.capitalGainsExclusion ?? 0;
    this.saleRule = data.saleRule ?? null;
    this.helocRule = data.helocRule ?? null;
    this.status = data.status ?? 'owned';
  }

  /**
   * Serializes the asset to a plain object for storage
   * @returns Serialized asset data
   */
  serialize(): AssetData {
    return {
      id: this.id,
      name: this.name,
      type: this.type,

      purchaseDate: formatDate(this.purchaseDate),
      purchasePrice: this.purchasePrice,
      currentValue: this.currentValue,
      currentValueDate: formatDate(this.currentValueDate),

      appreciation: this.appreciation,
      appreciationIsVariable: this.appreciationIsVariable,
      appreciationVariable: this.appreciationVariable,

      depreciationSchedule: this.depreciationSchedule,
      replacementCycle: this.replacementCycle,

      linkedAccounts: this.linkedAccounts,
      linkedBills: this.linkedBills,

      payFromAccount: this.payFromAccount,

      sellingCosts: this.sellingCosts,
      capitalGainsExclusion: this.capitalGainsExclusion,
      saleRule: this.saleRule,
      helocRule: this.helocRule,
      status: this.status,
    };
  }

  /**
   * Returns a string representation of the asset
   * @returns String representation in format "Asset(name, id)"
   */
  toString() {
    return `Asset(${this.name}, ${this.id})`;
  }
}
