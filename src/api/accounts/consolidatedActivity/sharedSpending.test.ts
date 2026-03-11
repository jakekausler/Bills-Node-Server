import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request } from 'express';
import { getSharedSpending } from './sharedSpending';
import { getData } from '../../../utils/net/request';

// Mock dependencies
vi.mock('../../../utils/net/request');

const mockGetData = vi.mocked(getData);

const mockRequest = {} as unknown as Request;

function makeActivity(name: string, amount: number, date: Date) {
  return { name, amount, date };
}

describe('getSharedSpending', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw an error when no Costco account is found', async () => {
    mockGetData.mockResolvedValue({
      accountsAndTransfers: {
        accounts: [
          { name: 'Checking', consolidatedActivity: [] },
          { name: 'Savings', consolidatedActivity: [] },
        ],
      },
    });

    await expect(getSharedSpending(mockRequest)).rejects.toThrow('Account not found');
  });

  it('should return an HTML table with no rows when Costco has no Transfer activities', async () => {
    mockGetData.mockResolvedValue({
      accountsAndTransfers: {
        accounts: [
          {
            name: 'Costco',
            consolidatedActivity: [
              makeActivity('Groceries', 150, new Date('2025-01-15')),
              makeActivity('Gas', 60, new Date('2025-01-20')),
            ],
          },
        ],
      },
    });

    const result = await getSharedSpending(mockRequest);

    expect(result).toContain('<h1>Estimated Shared Card Payment</h1>');
    expect(result).toContain('<table>');
    expect(result).toContain('</table>');
    // No Transfer from activities, so no rows expected
    expect(result).not.toContain('<tr>');
  });

  it('should group Transfer activities by month and return average spending per month', async () => {
    mockGetData.mockResolvedValue({
      accountsAndTransfers: {
        accounts: [
          {
            name: 'Costco',
            consolidatedActivity: [
              makeActivity('Transfer from Checking', 200, new Date('2025-01-10')),
              makeActivity('Transfer from Savings', 300, new Date('2025-01-25')),
              makeActivity('Transfer from Checking', 400, new Date('2025-02-15')),
              makeActivity('Groceries', 50, new Date('2025-01-05')),
            ],
          },
        ],
      },
    });

    const result = await getSharedSpending(mockRequest);

    // January: (200 + 300) / 2 = 250.00
    // February: 400 / 1 = 400.00
    expect(result).toContain('250.00');
    expect(result).toContain('400.00');
    expect(result).toContain('<h1>Estimated Shared Card Payment</h1>');
  });

  it('should only include activities whose name starts with "Transfer from "', async () => {
    mockGetData.mockResolvedValue({
      accountsAndTransfers: {
        accounts: [
          {
            name: 'Costco',
            consolidatedActivity: [
              makeActivity('Transfer from Joint', 500, new Date('2025-03-01')),
              makeActivity('Transfer to Savings', 100, new Date('2025-03-05')),
              makeActivity('Misc Transfer from old account', 200, new Date('2025-03-10')),
            ],
          },
        ],
      },
    });

    const result = await getSharedSpending(mockRequest);

    // Only 'Transfer from Joint' starts with 'Transfer from ', so average is 500/1 = 500.00
    expect(result).toContain('500.00');
    // 'Transfer to Savings' and 'Misc Transfer from...' should not count
  });

  it('should return valid HTML structure with tr/td elements for each month', async () => {
    mockGetData.mockResolvedValue({
      accountsAndTransfers: {
        accounts: [
          {
            name: 'Costco',
            consolidatedActivity: [
              makeActivity('Transfer from Checking', 600, new Date('2025-06-15')),
            ],
          },
        ],
      },
    });

    const result = await getSharedSpending(mockRequest);

    expect(result).toMatch(/<tr><td><b>.+<\/b><\/td><td>\$ \d+\.\d{2}<\/td><\/tr>/);
  });

  it('should call getData with the request and a defaultEndDate 12 months out', async () => {
    mockGetData.mockResolvedValue({
      accountsAndTransfers: {
        accounts: [{ name: 'Costco', consolidatedActivity: [] }],
      },
    });

    await getSharedSpending(mockRequest);

    expect(mockGetData).toHaveBeenCalledWith(
      mockRequest,
      expect.objectContaining({ defaultEndDate: expect.any(Date) }),
    );

    const callArgs = mockGetData.mock.calls[0];
    const options = callArgs[1] as { defaultEndDate: Date };
    const endDate = options.defaultEndDate;
    const now = new Date();

    // Should be roughly 12 months in the future — allow up to 2 days of drift for
    // UTC vs local time differences and dayjs month arithmetic edge cases.
    const elevenMonthsMs = 11 * 30 * 24 * 60 * 60 * 1000;
    const thirteenMonthsMs = 13 * 31 * 24 * 60 * 60 * 1000;
    const diffMs = endDate.getTime() - now.getTime();
    expect(diffMs).toBeGreaterThan(elevenMonthsMs);
    expect(diffMs).toBeLessThan(thirteenMonthsMs);
  });

  it('should handle non-numeric amounts gracefully by treating them as 0', async () => {
    mockGetData.mockResolvedValue({
      accountsAndTransfers: {
        accounts: [
          {
            name: 'Costco',
            consolidatedActivity: [
              { name: 'Transfer from Joint', amount: 'not-a-number', date: new Date('2025-04-10') },
              { name: 'Transfer from Savings', amount: 200, date: new Date('2025-04-20') },
            ],
          },
        ],
      },
    });

    const result = await getSharedSpending(mockRequest);

    // (0 + 200) / 2 = 100.00
    expect(result).toContain('100.00');
  });
});
