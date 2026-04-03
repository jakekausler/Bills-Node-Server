#!/usr/bin/env python3
"""
Sync fund metadata from Yahoo Finance into fundMetadata.json.

Reads all unique fund symbols from accountPortfolioConfigs.json,
fetches metadata via yahooquery, and merges into existing fundMetadata.json
(preserving manual edits for fields Yahoo doesn't provide).

Usage:
    python3 Bills-Node-Server/scripts/sync-fund-metadata.py
"""

import json
import os
import sys
from datetime import datetime, timezone

def get_data_dir():
    """Return absolute path to Bills-Node-Server/data/."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(script_dir, '..', 'data')

def load_json(path):
    try:
        with open(path, 'r') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def save_json(path, data):
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)

def extract_symbols(portfolio_configs):
    """Extract all unique fund symbols across all accounts."""
    symbols = set()
    for account_id, config in portfolio_configs.items():
        for fund in config.get('funds', []):
            sym = fund.get('symbol')
            if sym:
                symbols.add(sym)
    return sorted(symbols)

def normalize_sector_key(raw_key):
    """Convert Yahoo sector keys like 'technology' to camelCase keys."""
    mapping = {
        'technology': 'technology',
        'healthcare': 'healthcare',
        'financial_services': 'financialServices',
        'financialservices': 'financialServices',
        'communication_services': 'communicationServices',
        'communicationservices': 'communicationServices',
        'consumer_cyclical': 'consumerCyclical',
        'consumercyclical': 'consumerCyclical',
        'consumer_defensive': 'consumerDefensive',
        'consumerdefensive': 'consumerDefensive',
        'energy': 'energy',
        'industrials': 'industrials',
        'basic_materials': 'basicMaterials',
        'basicmaterials': 'basicMaterials',
        'real_estate': 'realEstate',
        'realestate': 'realEstate',
        'utilities': 'utilities',
    }
    normalized = raw_key.lower().replace(' ', '').replace('-', '_')
    # Try direct lookup, then try with underscores removed
    return mapping.get(normalized, mapping.get(normalized.replace('_', ''), normalized))

def fetch_metadata(symbols):
    """Fetch metadata for all symbols from Yahoo Finance."""
    try:
        from yahooquery import Ticker
    except ImportError:
        print("ERROR: yahooquery not installed. Run: pip install yahooquery", file=sys.stderr)
        sys.exit(1)

    results = {}
    now = datetime.now(timezone.utc).isoformat()

    # Filter out numeric-only symbols (institutional trusts like 5019, 5021)
    yahoo_symbols = [s for s in symbols if not s.isdigit()]
    skip_symbols = [s for s in symbols if s.isdigit()]

    # Create skeleton entries for non-Yahoo symbols
    for sym in skip_symbols:
        results[sym] = {
            'symbol': sym,
            'name': None,
            'fundFamily': None,
            'category': None,
            'expenseRatio': None,
            'lastSynced': now,
            'assetAllocation': None,
            'sectorWeightings': None,
            'geographicBreakdown': None,
            'marketCapBreakdown': None,
        }

    if not yahoo_symbols:
        return results

    ticker = Ticker(yahoo_symbols, asynchronous=True)

    # Fund profile for name, family, category, expense ratio
    try:
        fund_profile = ticker.fund_profile
    except Exception:
        fund_profile = {}

    # Asset allocation
    try:
        fund_holding_info = ticker.fund_holding_info
    except Exception:
        fund_holding_info = {}

    # Sector weightings
    try:
        fund_sector_weightings = ticker.fund_sector_weightings
    except Exception:
        fund_sector_weightings = {}

    # Quote type for name fallback
    try:
        quote_type = ticker.quote_type
    except Exception:
        quote_type = {}

    for sym in yahoo_symbols:
        entry = {
            'symbol': sym,
            'name': None,
            'fundFamily': None,
            'category': None,
            'expenseRatio': None,
            'lastSynced': now,
            'assetAllocation': None,
            'sectorWeightings': None,
            'geographicBreakdown': None,
            'marketCapBreakdown': None,
        }

        # Extract from fund_profile
        profile = fund_profile.get(sym, {})
        if isinstance(profile, dict):
            entry['fundFamily'] = profile.get('family')
            entry['category'] = profile.get('categoryName')
            fees = profile.get('feesExpensesInvestment', {})
            if isinstance(fees, dict):
                er = fees.get('annualReportExpenseRatio')
                if er is not None:
                    entry['expenseRatio'] = round(er, 6)

        # Extract name from quote_type
        qt = quote_type.get(sym, {})
        if isinstance(qt, dict):
            entry['name'] = qt.get('longName') or qt.get('shortName')

        # Extract asset allocation from fund_holding_info
        hi = fund_holding_info.get(sym, {})
        if isinstance(hi, dict):
            eq_holdings = hi.get('equityHoldings', {})
            bond_holdings = hi.get('bondHoldings', {})
            # stockPosition, bondPosition, cashPosition, otherPosition come from top-level
            stock_pct = hi.get('stockPosition', 0) or 0
            bond_pct = hi.get('bondPosition', 0) or 0
            cash_pct = hi.get('cashPosition', 0) or 0
            other_pct = hi.get('otherPosition', 0) or 0
            if stock_pct or bond_pct or cash_pct or other_pct:
                entry['assetAllocation'] = {
                    'stock': round(stock_pct, 4),
                    'bond': round(bond_pct, 4),
                    'cash': round(cash_pct, 4),
                    'other': round(other_pct, 4),
                }

        # Extract sector weightings
        sw = fund_sector_weightings.get(sym)
        if isinstance(sw, list):
            sectors = {}
            for item in sw:
                if isinstance(item, dict):
                    for raw_key, weight in item.items():
                        key = normalize_sector_key(raw_key)
                        sectors[key] = round(weight, 4)
            if sectors:
                entry['sectorWeightings'] = sectors
        elif isinstance(sw, dict):
            sectors = {}
            for raw_key, weight in sw.items():
                if isinstance(weight, (int, float)):
                    key = normalize_sector_key(raw_key)
                    sectors[key] = round(weight, 4)
            if sectors:
                entry['sectorWeightings'] = sectors

        results[sym] = entry

    return results

def merge_metadata(existing, fetched):
    """Merge fetched data into existing, preserving manual edits."""
    merged = dict(existing)  # Start with all existing entries
    for sym, new_data in fetched.items():
        if sym in merged:
            old = merged[sym]
            # Update Yahoo-sourced fields, but preserve manual fields
            for key in ['name', 'fundFamily', 'category', 'expenseRatio', 'lastSynced']:
                if new_data.get(key) is not None:
                    old[key] = new_data[key]

            # Field-level merge for assetAllocation: update Yahoo fields, preserve manual fields
            if new_data.get('assetAllocation') is not None:
                if 'assetAllocation' not in old:
                    old['assetAllocation'] = {}
                for field in ['stock', 'bond', 'cash', 'other']:
                    if field in new_data['assetAllocation']:
                        old['assetAllocation'][field] = new_data['assetAllocation'][field]
                # Preserve manually-set fields (preferred, convertible)
                for manual_field in ['preferred', 'convertible']:
                    if manual_field in old['assetAllocation'] and manual_field not in new_data['assetAllocation']:
                        pass  # Keep existing manual value

            # Field-level merge for sectorWeightings: update Yahoo sectors, preserve manual fields
            if new_data.get('sectorWeightings') is not None:
                if 'sectorWeightings' not in old:
                    old['sectorWeightings'] = {}
                # Update all Yahoo-provided sectors
                for sector_key, weight in new_data['sectorWeightings'].items():
                    old['sectorWeightings'][sector_key] = weight
                # Manual sectors (with special markers like '_preferred') persist automatically via this logic

            # Field-level merge for geographicBreakdown: update Yahoo fields, preserve manual fields
            if new_data.get('geographicBreakdown') is not None:
                if 'geographicBreakdown' not in old:
                    old['geographicBreakdown'] = {}
                for field in ['domestic', 'international']:
                    if field in new_data['geographicBreakdown']:
                        old['geographicBreakdown'][field] = new_data['geographicBreakdown'][field]
                # Preserve manually-set fields in geographicBreakdown
                for manual_field in list(old.get('geographicBreakdown', {}).keys()):
                    if manual_field not in ['domestic', 'international']:
                        pass  # Keep existing manual fields

            # Field-level merge for marketCapBreakdown: update Yahoo fields, preserve manual fields
            if new_data.get('marketCapBreakdown') is not None:
                if 'marketCapBreakdown' not in old:
                    old['marketCapBreakdown'] = {}
                for field in ['large', 'mid', 'small']:
                    if field in new_data['marketCapBreakdown']:
                        old['marketCapBreakdown'][field] = new_data['marketCapBreakdown'][field]
                # Preserve manually-set fields in marketCapBreakdown
                for manual_field in list(old.get('marketCapBreakdown', {}).keys()):
                    if manual_field not in ['large', 'mid', 'small']:
                        pass  # Keep existing manual fields
        else:
            merged[sym] = new_data
    return merged

def main():
    data_dir = get_data_dir()
    configs_path = os.path.join(data_dir, 'accountPortfolioConfigs.json')
    metadata_path = os.path.join(data_dir, 'fundMetadata.json')

    configs = load_json(configs_path)
    if not configs:
        print("No portfolio configs found.", file=sys.stderr)
        sys.exit(1)

    symbols = extract_symbols(configs)
    print(f"Found {len(symbols)} unique fund symbols: {', '.join(symbols)}")

    existing = load_json(metadata_path)
    print(f"Existing metadata entries: {len(existing)}")

    fetched = fetch_metadata(symbols)
    print(f"Fetched metadata for {len(fetched)} symbols")

    merged = merge_metadata(existing, fetched)
    save_json(metadata_path, merged)
    print(f"Saved {len(merged)} entries to {metadata_path}")

if __name__ == '__main__':
    main()
