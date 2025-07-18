import { vi } from 'vitest';
/**
 * Creates a mock Express Request object for testing
 */
export function createMockRequest(overrides = {}) {
    return {
        query: {},
        params: {},
        body: {},
        headers: {},
        get: vi.fn(),
        header: vi.fn(),
        ...overrides
    };
}
/**
 * Creates a mock AccountsAndTransfers object with default structure
 */
export function createMockAccountsAndTransfers(overrides = {}) {
    return {
        accounts: [],
        transfers: {
            bills: [],
            activity: []
        },
        ...overrides
    };
}
/**
 * Creates a mock request data object with all required properties
 */
export function createMockRequestData(overrides = {}) {
    return {
        accountsAndTransfers: createMockAccountsAndTransfers(),
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
        selectedAccounts: [],
        selectedSimulations: [],
        simulation: 'Default',
        socialSecurities: [],
        pensions: [],
        isTransfer: false,
        asActivity: false,
        skip: 0,
        path: [],
        data: {},
        ...overrides
    };
}
