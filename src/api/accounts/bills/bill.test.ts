import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getSpecificBill,
  updateSpecificBill,
  deleteSpecificBill,
  changeAccountForBill,
} from './bill';
import { getData } from '../../../utils/net/request';
import { getById, getByIdWithIdx } from '../../../utils/array/array';
import { parseDate } from '../../../utils/date/date';
import { saveData } from '../../../utils/io/accountsAndTransfers';
import { insertBill } from '../../../data/bill/bill';
import { loadVariable } from '../../../utils/simulation/variable';
import { createMockRequest } from '../../../utils/test/mockData';

// Project test conventions discovered:
// - Framework: Vitest with vi.mock()
// - Factories: Using createMockRequest() from utils/test/mockData
// - Async: async/await throughout
// - Mocking: vi.mocked(getData).mockResolvedValue for async, mockReturnValue for sync

vi.mock('../../../utils/net/request');
vi.mock('../../../utils/array/array');
vi.mock('../../../utils/date/date');
vi.mock('../../../utils/io/accountsAndTransfers');
vi.mock('../../../data/bill/bill', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../data/bill/bill')>();
  return {
    ...actual,
    insertBill: vi.fn(),
  };
});
vi.mock('../../../utils/simulation/variable');

describe('Specific Bill API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getSpecificBill', () => {
    describe('when asActivity is true', () => {
      it('should return serialized consolidated activity matching billId', async () => {
        const mockSerializedActivity = { id: 'ca-1', billId: 'bill-1', amount: -100 };
        const mockConsolidatedActivity = {
          billId: 'bill-1',
          flag: true,
          flagColor: 'red',
          serialize: vi.fn().mockReturnValue(mockSerializedActivity),
        };

        const mockAccount = {
          id: 'account-1',
          consolidatedActivity: [mockConsolidatedActivity],
        };

        const mockData = {
          asActivity: true,
          accountsAndTransfers: {
            accounts: [mockAccount],
          },
        };

        const mockRequest = createMockRequest({
          params: { accountId: 'account-1', billId: 'bill-1' },
        });

        vi.mocked(getData).mockResolvedValue(mockData as any);
        vi.mocked(getById).mockReturnValue(mockAccount as any);

        const result = await getSpecificBill(mockRequest);

        expect(getData).toHaveBeenCalledWith(mockRequest);
        expect(getById).toHaveBeenCalledWith(mockData.accountsAndTransfers.accounts, 'account-1');
        expect(mockConsolidatedActivity.flag).toBe(false);
        expect(mockConsolidatedActivity.flagColor).toBeNull();
        expect(mockConsolidatedActivity.serialize).toHaveBeenCalled();
        expect(result).toBe(mockSerializedActivity);
      });

      it('should return null when no consolidated activity matches billId', async () => {
        const mockConsolidatedActivity = {
          billId: 'other-bill-id',
          serialize: vi.fn(),
        };

        const mockAccount = {
          id: 'account-1',
          consolidatedActivity: [mockConsolidatedActivity],
        };

        const mockData = {
          asActivity: true,
          accountsAndTransfers: {
            accounts: [mockAccount],
          },
        };

        const mockRequest = createMockRequest({
          params: { accountId: 'account-1', billId: 'bill-1' },
        });

        vi.mocked(getData).mockResolvedValue(mockData as any);
        vi.mocked(getById).mockReturnValue(mockAccount as any);

        const result = await getSpecificBill(mockRequest);

        expect(result).toBeNull();
        expect(mockConsolidatedActivity.serialize).not.toHaveBeenCalled();
      });

      it('should return null when consolidatedActivity is empty', async () => {
        const mockAccount = {
          id: 'account-1',
          consolidatedActivity: [],
        };

        const mockData = {
          asActivity: true,
          accountsAndTransfers: {
            accounts: [mockAccount],
          },
        };

        const mockRequest = createMockRequest({
          params: { accountId: 'account-1', billId: 'bill-1' },
        });

        vi.mocked(getData).mockResolvedValue(mockData as any);
        vi.mocked(getById).mockReturnValue(mockAccount as any);

        const result = await getSpecificBill(mockRequest);

        expect(result).toBeNull();
      });
    });

    describe('when asActivity is false', () => {
      it('should return serialized transfer bill when isTransfer is true', async () => {
        const mockSerializedBill = { id: 'bill-1', name: 'Rent' };
        const mockBill = {
          id: 'bill-1',
          name: 'Rent',
          isTransfer: true,
          serialize: vi.fn().mockReturnValue(mockSerializedBill),
        };

        const mockData = {
          asActivity: false,
          isTransfer: true,
          accountsAndTransfers: {
            transfers: {
              bills: [mockBill],
            },
          },
        };

        const mockRequest = createMockRequest({
          params: { billId: 'bill-1' },
        });

        vi.mocked(getData).mockResolvedValue(mockData as any);
        vi.mocked(getById).mockReturnValue(mockBill as any);

        const result = await getSpecificBill(mockRequest);

        expect(getData).toHaveBeenCalledWith(mockRequest);
        expect(getById).toHaveBeenCalledWith(mockData.accountsAndTransfers.transfers.bills, 'bill-1');
        expect(mockBill.serialize).toHaveBeenCalled();
        expect(result).toBe(mockSerializedBill);
      });

      it('should return serialized account bill when isTransfer is false', async () => {
        const mockSerializedBill = { id: 'bill-2', name: 'Groceries' };
        const mockBill = {
          id: 'bill-2',
          name: 'Groceries',
          isTransfer: false,
          serialize: vi.fn().mockReturnValue(mockSerializedBill),
        };

        const mockAccount = {
          id: 'account-1',
          bills: [mockBill],
        };

        const mockData = {
          asActivity: false,
          isTransfer: false,
          accountsAndTransfers: {
            accounts: [mockAccount],
          },
        };

        const mockRequest = createMockRequest({
          params: { accountId: 'account-1', billId: 'bill-2' },
        });

        vi.mocked(getData).mockResolvedValue(mockData as any);
        vi.mocked(getById)
          .mockReturnValueOnce(mockAccount as any)
          .mockReturnValueOnce(mockBill as any);

        const result = await getSpecificBill(mockRequest);

        expect(getById).toHaveBeenNthCalledWith(1, mockData.accountsAndTransfers.accounts, 'account-1');
        expect(getById).toHaveBeenNthCalledWith(2, mockAccount.bills, 'bill-2');
        expect(mockBill.serialize).toHaveBeenCalled();
        expect(result).toBe(mockSerializedBill);
      });
    });
  });

  describe('updateSpecificBill', () => {
    describe('when asActivity is true', () => {
      it('should insert bill as activity for non-transfer', async () => {
        const mockBill = {
          id: 'bill-1',
          advance: vi.fn(),
        };

        const mockAccount = {
          id: 'account-1',
          bills: [mockBill],
          activity: [],
        };

        const mockActivityData = {
          name: 'Groceries Payment',
          date: '2024-03-01',
          amount: -150,
          category: 'Food.Groceries',
          amountIsVariable: false,
          amountVariable: null,
        };

        const mockData = {
          asActivity: true,
          isTransfer: false,
          simulation: 'Default',
          accountsAndTransfers: {
            accounts: [mockAccount],
          },
          data: mockActivityData,
        };

        const mockRequest = createMockRequest({
          params: { accountId: 'account-1', billId: 'bill-1' },
        });

        vi.mocked(getData).mockResolvedValue(mockData as any);
        vi.mocked(getById)
          .mockReturnValueOnce(mockAccount as any)
          .mockReturnValueOnce(mockBill as any);

        const result = await updateSpecificBill(mockRequest);

        expect(getData).toHaveBeenCalledWith(mockRequest);
        expect(getById).toHaveBeenNthCalledWith(1, mockData.accountsAndTransfers.accounts, 'account-1');
        expect(getById).toHaveBeenNthCalledWith(2, mockAccount.bills, 'bill-1');
        expect(insertBill).toHaveBeenCalledWith(
          mockData.accountsAndTransfers,
          mockAccount,
          mockBill,
          mockActivityData,
          false,
          'Default',
        );
        expect(saveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
        expect(result).toBe('bill-1');
      });

      it('should insert bill as activity for transfer', async () => {
        const mockBill = {
          id: 'bill-1',
          advance: vi.fn(),
        };

        const mockAccount = {
          id: 'account-1',
          bills: [],
          activity: [],
        };

        const mockActivityData = {
          name: 'Transfer Payment',
          date: '2024-03-01',
          amount: -500,
          category: 'Transfer',
          amountIsVariable: false,
          amountVariable: null,
        };

        const mockData = {
          asActivity: true,
          isTransfer: true,
          simulation: 'Default',
          accountsAndTransfers: {
            accounts: [mockAccount],
            transfers: {
              bills: [mockBill],
              activity: [],
            },
          },
          data: mockActivityData,
        };

        const mockRequest = createMockRequest({
          params: { accountId: 'account-1', billId: 'bill-1' },
        });

        vi.mocked(getData).mockResolvedValue(mockData as any);
        vi.mocked(getById)
          .mockReturnValueOnce(mockAccount as any)
          .mockReturnValueOnce(mockBill as any);

        const result = await updateSpecificBill(mockRequest);

        expect(getById).toHaveBeenNthCalledWith(2, mockData.accountsAndTransfers.transfers.bills, 'bill-1');
        expect(insertBill).toHaveBeenCalledWith(
          mockData.accountsAndTransfers,
          mockAccount,
          mockBill,
          mockActivityData,
          true,
          'Default',
        );
        expect(saveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
        expect(result).toBe('bill-1');
      });
    });

    describe('when skip is true', () => {
      it('should skip a non-transfer bill', async () => {
        const mockBill = {
          id: 'bill-1',
          skip: vi.fn(),
        };

        const mockAccount = {
          id: 'account-1',
          bills: [mockBill],
        };

        const mockData = {
          asActivity: false,
          skip: true,
          isTransfer: false,
          accountsAndTransfers: {
            accounts: [mockAccount],
          },
        };

        const mockRequest = createMockRequest({
          params: { accountId: 'account-1', billId: 'bill-1' },
        });

        vi.mocked(getData).mockResolvedValue(mockData as any);
        vi.mocked(getById)
          .mockReturnValueOnce(mockAccount as any)
          .mockReturnValueOnce(mockBill as any);

        const result = await updateSpecificBill(mockRequest);

        expect(getById).toHaveBeenNthCalledWith(1, mockData.accountsAndTransfers.accounts, 'account-1');
        expect(getById).toHaveBeenNthCalledWith(2, mockAccount.bills, 'bill-1');
        expect(mockBill.skip).toHaveBeenCalled();
        expect(saveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
        expect(result).toBe('bill-1');
      });

      it('should skip a transfer bill', async () => {
        const mockBill = {
          id: 'bill-1',
          skip: vi.fn(),
        };

        const mockAccount = {
          id: 'account-1',
          bills: [],
        };

        const mockData = {
          asActivity: false,
          skip: true,
          isTransfer: true,
          accountsAndTransfers: {
            accounts: [mockAccount],
            transfers: {
              bills: [mockBill],
            },
          },
        };

        const mockRequest = createMockRequest({
          params: { accountId: 'account-1', billId: 'bill-1' },
        });

        vi.mocked(getData).mockResolvedValue(mockData as any);
        vi.mocked(getById)
          .mockReturnValueOnce(mockAccount as any)
          .mockReturnValueOnce(mockBill as any);

        const result = await updateSpecificBill(mockRequest);

        expect(getById).toHaveBeenNthCalledWith(2, mockData.accountsAndTransfers.transfers.bills, 'bill-1');
        expect(mockBill.skip).toHaveBeenCalled();
        expect(saveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
        expect(result).toBe('bill-1');
      });
    });

    describe('when updating as bill (asActivity false, skip false)', () => {
      it('should update a regular bill on an account', async () => {
        const mockBill: any = {
          id: 'bill-1',
          isTransfer: false,
          setIncreaseByDate: vi.fn().mockReturnValue({ day: 1, month: 0 }),
        };

        const mockAccount = {
          id: 'account-1',
          bills: [mockBill],
        };

        const mockStartDate = new Date('2024-01-01');

        const mockData = {
          asActivity: false,
          skip: false,
          isTransfer: false,
          simulation: 'Default',
          accountsAndTransfers: {
            accounts: [mockAccount],
            transfers: { bills: [] },
          },
          data: {
            startDate: '2024-01-01',
            startDateIsVariable: false,
            startDateVariable: null,
            endDate: null,
            endDateIsVariable: false,
            endDateVariable: null,
            category: 'Food.Groceries',
            amount: -100,
            amountIsVariable: false,
            amountVariable: null,
            name: 'Updated Groceries',
            everyN: 1,
            periods: 'month',
            isTransfer: false,
            from: null,
            to: null,
            isAutomatic: false,
            increaseBy: 0.03,
            increaseByIsVariable: false,
            increaseByVariable: null,
            increaseByDate: '01/01',
            flag: false,
            flagColor: null,
            isHealthcare: false,
            healthcarePerson: null,
            copayAmount: null,
            coinsurancePercent: null,
            countsTowardDeductible: true,
            countsTowardOutOfPocket: true,
            spendingCategory: null,
          },
        };

        const mockRequest = createMockRequest({
          params: { accountId: 'account-1', billId: 'bill-1' },
        });

        vi.mocked(getData).mockResolvedValue(mockData as any);
        vi.mocked(getById).mockReturnValue(mockAccount as any);
        vi.mocked(getByIdWithIdx).mockReturnValue({ item: mockBill, idx: 0 } as any);
        vi.mocked(parseDate).mockReturnValue(mockStartDate);

        const result = await updateSpecificBill(mockRequest);

        expect(getData).toHaveBeenCalledWith(mockRequest);
        expect(getById).toHaveBeenCalledWith(mockData.accountsAndTransfers.accounts, 'account-1');
        expect(getByIdWithIdx).toHaveBeenCalledWith(mockAccount.bills, 'bill-1');
        expect(parseDate).toHaveBeenCalledWith('2024-01-01');
        expect(mockBill.startDate).toBe(mockStartDate);
        expect(mockBill.name).toBe('Updated Groceries');
        expect(mockBill.amount).toBe(-100);
        expect(mockBill.category).toBe('Food.Groceries');
        expect(mockBill.isHealthcare).toBe(false);
        expect(mockBill.countsTowardDeductible).toBe(true);
        expect(mockBill.countsTowardOutOfPocket).toBe(true);
        expect(mockBill.spendingCategory).toBeNull();
        expect(saveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
        expect(result).toBe('bill-1');
      });

      it('should update a transfer bill', async () => {
        const mockBill: any = {
          id: 'bill-1',
          isTransfer: true,
          setIncreaseByDate: vi.fn().mockReturnValue({ day: 1, month: 0 }),
        };

        const mockAccount = {
          id: 'account-1',
          bills: [],
        };

        const mockStartDate = new Date('2024-02-01');

        const mockData = {
          asActivity: false,
          skip: false,
          isTransfer: true,
          simulation: 'Default',
          accountsAndTransfers: {
            accounts: [mockAccount],
            transfers: { bills: [mockBill] },
          },
          data: {
            startDate: '2024-02-01',
            startDateIsVariable: false,
            startDateVariable: null,
            endDate: null,
            endDateIsVariable: false,
            endDateVariable: null,
            category: 'Transfer',
            amount: -500,
            amountIsVariable: false,
            amountVariable: null,
            name: 'Monthly Transfer',
            everyN: 1,
            periods: 'month',
            isTransfer: true,
            from: 'account-1',
            to: 'account-2',
            isAutomatic: true,
            increaseBy: 0,
            increaseByIsVariable: false,
            increaseByVariable: null,
            increaseByDate: '01/01',
            flag: false,
            flagColor: null,
            isHealthcare: false,
            healthcarePerson: null,
            copayAmount: null,
            coinsurancePercent: null,
            countsTowardDeductible: true,
            countsTowardOutOfPocket: true,
            spendingCategory: null,
          },
        };

        const mockRequest = createMockRequest({
          params: { accountId: 'account-1', billId: 'bill-1' },
        });

        vi.mocked(getData).mockResolvedValue(mockData as any);
        vi.mocked(getById).mockReturnValue(mockAccount as any);
        vi.mocked(getByIdWithIdx).mockReturnValue({ item: mockBill, idx: 0 } as any);
        vi.mocked(parseDate).mockReturnValue(mockStartDate);

        const result = await updateSpecificBill(mockRequest);

        expect(getByIdWithIdx).toHaveBeenCalledWith(mockData.accountsAndTransfers.transfers.bills, 'bill-1');
        expect(mockBill.startDate).toBe(mockStartDate);
        expect(mockBill.name).toBe('Monthly Transfer');
        expect(saveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
        expect(result).toBe('bill-1');
      });

      it('should throw an error for healthcare bills with zero amount', async () => {
        const mockBill: any = {
          id: 'bill-1',
          isTransfer: false,
          setIncreaseByDate: vi.fn().mockReturnValue({ day: 1, month: 0 }),
        };

        const mockAccount = {
          id: 'account-1',
          bills: [mockBill],
        };

        const mockData = {
          asActivity: false,
          skip: false,
          isTransfer: false,
          simulation: 'Default',
          accountsAndTransfers: {
            accounts: [mockAccount],
            transfers: { bills: [] },
          },
          data: {
            isHealthcare: true,
            amountIsVariable: false,
            amount: 0,
            startDate: '2024-01-01',
            startDateIsVariable: false,
            startDateVariable: null,
            endDate: null,
            endDateIsVariable: false,
            endDateVariable: null,
            name: 'Doctor Visit',
            category: 'Healthcare',
            everyN: 1,
            periods: 'month',
            isTransfer: false,
            from: null,
            to: null,
            isAutomatic: false,
            increaseBy: 0.03,
            increaseByIsVariable: false,
            increaseByVariable: null,
            increaseByDate: '01/01',
            flag: false,
            flagColor: null,
            countsTowardDeductible: true,
            countsTowardOutOfPocket: true,
            spendingCategory: null,
          },
        };

        const mockRequest = createMockRequest({
          params: { accountId: 'account-1', billId: 'bill-1' },
        });

        vi.mocked(getData).mockResolvedValue(mockData as any);

        await expect(updateSpecificBill(mockRequest)).rejects.toThrow(
          'Healthcare bills must have a non-zero amount',
        );
      });

      it('should allow healthcare bills with non-zero amount', async () => {
        const mockBill: any = {
          id: 'bill-1',
          isTransfer: false,
          setIncreaseByDate: vi.fn().mockReturnValue({ day: 1, month: 0 }),
        };

        const mockAccount = {
          id: 'account-1',
          bills: [mockBill],
        };

        const mockData = {
          asActivity: false,
          skip: false,
          isTransfer: false,
          simulation: 'Default',
          accountsAndTransfers: {
            accounts: [mockAccount],
            transfers: { bills: [] },
          },
          data: {
            isHealthcare: true,
            amountIsVariable: false,
            amount: -50,
            startDate: '2024-01-01',
            startDateIsVariable: false,
            startDateVariable: null,
            endDate: null,
            endDateIsVariable: false,
            endDateVariable: null,
            name: 'Doctor Visit',
            category: 'Healthcare',
            everyN: 1,
            periods: 'month',
            isTransfer: false,
            from: null,
            to: null,
            isAutomatic: false,
            increaseBy: 0.03,
            increaseByIsVariable: false,
            increaseByVariable: null,
            increaseByDate: '01/01',
            flag: false,
            flagColor: null,
            healthcarePerson: 'John',
            copayAmount: 20,
            coinsurancePercent: 0.2,
            countsTowardDeductible: true,
            countsTowardOutOfPocket: true,
            spendingCategory: 'Medical',
          },
        };

        const mockRequest = createMockRequest({
          params: { accountId: 'account-1', billId: 'bill-1' },
        });

        vi.mocked(getData).mockResolvedValue(mockData as any);
        vi.mocked(getById).mockReturnValue(mockAccount as any);
        vi.mocked(getByIdWithIdx).mockReturnValue({ item: mockBill, idx: 0 } as any);
        vi.mocked(parseDate).mockReturnValue(new Date('2024-01-01'));

        const result = await updateSpecificBill(mockRequest);

        expect(mockBill.isHealthcare).toBe(true);
        expect(mockBill.healthcarePerson).toBe('John');
        expect(mockBill.copayAmount).toBe(20);
        expect(mockBill.coinsurancePercent).toBe(0.2);
        expect(mockBill.spendingCategory).toBe('Medical');
        expect(result).toBe('bill-1');
      });

      it('should allow healthcare bills with variable amount (amountIsVariable true)', async () => {
        const mockBill: any = {
          id: 'bill-1',
          isTransfer: false,
          setIncreaseByDate: vi.fn().mockReturnValue({ day: 1, month: 0 }),
        };

        const mockAccount = {
          id: 'account-1',
          bills: [mockBill],
        };

        const mockData = {
          asActivity: false,
          skip: false,
          isTransfer: false,
          simulation: 'Default',
          accountsAndTransfers: {
            accounts: [mockAccount],
            transfers: { bills: [] },
          },
          data: {
            isHealthcare: true,
            amountIsVariable: true,
            amount: 0,
            startDate: '2024-01-01',
            startDateIsVariable: false,
            startDateVariable: null,
            endDate: null,
            endDateIsVariable: false,
            endDateVariable: null,
            name: 'Variable Healthcare',
            category: 'Healthcare',
            everyN: 1,
            periods: 'month',
            isTransfer: false,
            from: null,
            to: null,
            isAutomatic: false,
            increaseBy: 0.03,
            increaseByIsVariable: false,
            increaseByVariable: null,
            increaseByDate: '01/01',
            flag: false,
            flagColor: null,
            countsTowardDeductible: true,
            countsTowardOutOfPocket: true,
            spendingCategory: null,
          },
        };

        const mockRequest = createMockRequest({
          params: { accountId: 'account-1', billId: 'bill-1' },
        });

        vi.mocked(getData).mockResolvedValue(mockData as any);
        vi.mocked(getById).mockReturnValue(mockAccount as any);
        vi.mocked(getByIdWithIdx).mockReturnValue({ item: mockBill, idx: 0 } as any);
        vi.mocked(parseDate).mockReturnValue(new Date('2024-01-01'));

        // Should NOT throw because amountIsVariable is true
        const result = await updateSpecificBill(mockRequest);

        expect(result).toBe('bill-1');
      });

      it('should move bill from account to transfers when isTransfer changes to true', async () => {
        const mockBill: any = {
          id: 'bill-1',
          isTransfer: false,
          setIncreaseByDate: vi.fn().mockReturnValue({ day: 1, month: 0 }),
        };

        const accountBills = [mockBill];
        const originalSplice = Array.prototype.splice.bind(accountBills);
        const mockSplice = vi.fn((...args: any[]) => originalSplice(...args));
        accountBills.splice = mockSplice;

        const mockAccount = {
          id: 'account-1',
          bills: accountBills,
        };

        const transferBills: any[] = [];

        const mockData = {
          asActivity: false,
          skip: false,
          isTransfer: false,
          simulation: 'Default',
          accountsAndTransfers: {
            accounts: [mockAccount],
            transfers: { bills: transferBills },
          },
          data: {
            isTransfer: true,
            amount: -200,
            amountIsVariable: false,
            amountVariable: null,
            startDate: '2024-01-01',
            startDateIsVariable: false,
            startDateVariable: null,
            endDate: null,
            endDateIsVariable: false,
            endDateVariable: null,
            name: 'Became Transfer',
            category: 'Transfer',
            everyN: 1,
            periods: 'month',
            from: 'account-1',
            to: 'account-2',
            isAutomatic: false,
            increaseBy: 0,
            increaseByIsVariable: false,
            increaseByVariable: null,
            increaseByDate: '01/01',
            flag: false,
            flagColor: null,
            isHealthcare: false,
            healthcarePerson: null,
            copayAmount: null,
            coinsurancePercent: null,
            countsTowardDeductible: true,
            countsTowardOutOfPocket: true,
            spendingCategory: null,
          },
        };

        const mockRequest = createMockRequest({
          params: { accountId: 'account-1', billId: 'bill-1' },
        });

        vi.mocked(getData).mockResolvedValue(mockData as any);
        vi.mocked(getById).mockReturnValue(mockAccount as any);
        vi.mocked(getByIdWithIdx).mockReturnValue({ item: mockBill, idx: 0 } as any);
        vi.mocked(parseDate).mockReturnValue(new Date('2024-01-01'));

        const result = await updateSpecificBill(mockRequest);

        expect(transferBills).toContain(mockBill);
        expect(mockSplice).toHaveBeenCalledWith(0, 1);
        expect(saveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
        expect(result).toBe('bill-1');
      });

      it('should move bill from transfers to account when isTransfer changes to false', async () => {
        const mockBill: any = {
          id: 'bill-1',
          isTransfer: true,
          setIncreaseByDate: vi.fn().mockReturnValue({ day: 1, month: 0 }),
        };

        const transferBills = [mockBill];
        const originalSplice = Array.prototype.splice.bind(transferBills);
        const mockSplice = vi.fn((...args: any[]) => originalSplice(...args));
        transferBills.splice = mockSplice;

        const mockAccount = {
          id: 'account-1',
          bills: [],
        };

        const mockData = {
          asActivity: false,
          skip: false,
          isTransfer: true,
          simulation: 'Default',
          accountsAndTransfers: {
            accounts: [mockAccount],
            transfers: { bills: transferBills },
          },
          data: {
            isTransfer: false,
            amount: -100,
            amountIsVariable: false,
            amountVariable: null,
            startDate: '2024-01-01',
            startDateIsVariable: false,
            startDateVariable: null,
            endDate: null,
            endDateIsVariable: false,
            endDateVariable: null,
            name: 'No Longer Transfer',
            category: 'Food.Groceries',
            everyN: 1,
            periods: 'month',
            from: null,
            to: null,
            isAutomatic: false,
            increaseBy: 0.03,
            increaseByIsVariable: false,
            increaseByVariable: null,
            increaseByDate: '01/01',
            flag: false,
            flagColor: null,
            isHealthcare: false,
            healthcarePerson: null,
            copayAmount: null,
            coinsurancePercent: null,
            countsTowardDeductible: true,
            countsTowardOutOfPocket: true,
            spendingCategory: null,
          },
        };

        const mockRequest = createMockRequest({
          params: { accountId: 'account-1', billId: 'bill-1' },
        });

        vi.mocked(getData).mockResolvedValue(mockData as any);
        vi.mocked(getById).mockReturnValue(mockAccount as any);
        vi.mocked(getByIdWithIdx).mockReturnValue({ item: mockBill, idx: 0 } as any);
        vi.mocked(parseDate).mockReturnValue(new Date('2024-01-01'));

        const result = await updateSpecificBill(mockRequest);

        expect(mockAccount.bills).toContain(mockBill);
        expect(mockSplice).toHaveBeenCalledWith(0, 1);
        expect(saveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
        expect(result).toBe('bill-1');
      });

      it('should use variable for end date when endDateIsVariable and endDateVariable are set', async () => {
        const mockBill: any = {
          id: 'bill-1',
          isTransfer: false,
          setIncreaseByDate: vi.fn().mockReturnValue({ day: 1, month: 0 }),
        };

        const mockAccount = {
          id: 'account-1',
          bills: [mockBill],
        };

        const mockEndDate = new Date('2030-12-31');

        const mockData = {
          asActivity: false,
          skip: false,
          isTransfer: false,
          simulation: 'Default',
          accountsAndTransfers: {
            accounts: [mockAccount],
            transfers: { bills: [] },
          },
          data: {
            startDate: '2024-01-01',
            startDateIsVariable: false,
            startDateVariable: null,
            endDate: null,
            endDateIsVariable: true,
            endDateVariable: 'RETIREMENT_DATE',
            name: 'Recurring Bill',
            category: 'Bills',
            amount: -100,
            amountIsVariable: false,
            amountVariable: null,
            everyN: 1,
            periods: 'month',
            isTransfer: false,
            from: null,
            to: null,
            isAutomatic: false,
            increaseBy: 0.03,
            increaseByIsVariable: false,
            increaseByVariable: null,
            increaseByDate: '01/01',
            flag: false,
            flagColor: null,
            isHealthcare: false,
            healthcarePerson: null,
            copayAmount: null,
            coinsurancePercent: null,
            countsTowardDeductible: true,
            countsTowardOutOfPocket: true,
            spendingCategory: null,
          },
        };

        const mockRequest = createMockRequest({
          params: { accountId: 'account-1', billId: 'bill-1' },
        });

        vi.mocked(getData).mockResolvedValue(mockData as any);
        vi.mocked(getById).mockReturnValue(mockAccount as any);
        vi.mocked(getByIdWithIdx).mockReturnValue({ item: mockBill, idx: 0 } as any);
        vi.mocked(parseDate).mockReturnValue(new Date('2024-01-01'));
        vi.mocked(loadVariable).mockReturnValue(mockEndDate);

        const result = await updateSpecificBill(mockRequest);

        expect(loadVariable).toHaveBeenCalledWith('RETIREMENT_DATE', 'Default');
        expect(mockBill.endDate).toBe(mockEndDate);
        expect(result).toBe('bill-1');
      });

      it('should fall back to account bills when isTransfer but bill not found in transfers', async () => {
        const mockBill: any = {
          id: 'bill-1',
          isTransfer: false,
          setIncreaseByDate: vi.fn().mockReturnValue({ day: 1, month: 0 }),
        };

        const mockAccount = {
          id: 'account-1',
          bills: [mockBill],
        };

        const mockData = {
          asActivity: false,
          skip: false,
          isTransfer: true,
          simulation: 'Default',
          accountsAndTransfers: {
            accounts: [mockAccount],
            transfers: { bills: [] },
          },
          data: {
            isTransfer: false,
            amount: -100,
            amountIsVariable: false,
            amountVariable: null,
            startDate: '2024-01-01',
            startDateIsVariable: false,
            startDateVariable: null,
            endDate: null,
            endDateIsVariable: false,
            endDateVariable: null,
            name: 'Fallback Bill',
            category: 'Bills',
            everyN: 1,
            periods: 'month',
            from: null,
            to: null,
            isAutomatic: false,
            increaseBy: 0.03,
            increaseByIsVariable: false,
            increaseByVariable: null,
            increaseByDate: '01/01',
            flag: false,
            flagColor: null,
            isHealthcare: false,
            healthcarePerson: null,
            copayAmount: null,
            coinsurancePercent: null,
            countsTowardDeductible: true,
            countsTowardOutOfPocket: true,
            spendingCategory: null,
          },
        };

        const mockRequest = createMockRequest({
          params: { accountId: 'account-1', billId: 'bill-1' },
        });

        vi.mocked(getData).mockResolvedValue(mockData as any);
        vi.mocked(getById).mockReturnValue(mockAccount as any);
        // First call throws (bill not in transfers), second call returns the bill
        vi.mocked(getByIdWithIdx)
          .mockImplementationOnce(() => {
            throw new Error('Bill not found in transfers');
          })
          .mockReturnValueOnce({ item: mockBill, idx: 0 } as any);
        vi.mocked(parseDate).mockReturnValue(new Date('2024-01-01'));

        const result = await updateSpecificBill(mockRequest);

        expect(getByIdWithIdx).toHaveBeenNthCalledWith(1, mockData.accountsAndTransfers.transfers.bills, 'bill-1');
        expect(getByIdWithIdx).toHaveBeenNthCalledWith(2, mockAccount.bills, 'bill-1');
        expect(saveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
        expect(result).toBe('bill-1');
      });
    });
  });

  describe('deleteSpecificBill', () => {
    it('should delete a transfer bill', async () => {
      const mockBill = {
        id: 'bill-1',
        name: 'Transfer Bill',
        isTransfer: true,
      };

      const transferBills = [mockBill];
      const mockSplice = vi.fn();
      transferBills.splice = mockSplice;

      const mockData = {
        isTransfer: true,
        accountsAndTransfers: {
          transfers: {
            bills: transferBills,
          },
        },
      };

      const mockRequest = createMockRequest({
        params: { billId: 'bill-1' },
      });

      vi.mocked(getData).mockResolvedValue(mockData as any);
      vi.mocked(getByIdWithIdx).mockReturnValue({ item: mockBill, idx: 0 } as any);

      const result = await deleteSpecificBill(mockRequest);

      expect(getData).toHaveBeenCalledWith(mockRequest);
      expect(getByIdWithIdx).toHaveBeenCalledWith(mockData.accountsAndTransfers.transfers.bills, 'bill-1');
      expect(mockSplice).toHaveBeenCalledWith(0, 1);
      expect(saveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
      expect(result).toBe('bill-1');
    });

    it('should delete a regular account bill', async () => {
      const mockBill = {
        id: 'bill-2',
        name: 'Grocery Bill',
        isTransfer: false,
      };

      const accountBills = [mockBill];
      const mockSplice = vi.fn();
      accountBills.splice = mockSplice;

      const mockAccount = {
        id: 'account-1',
        bills: accountBills,
      };

      const mockData = {
        isTransfer: false,
        accountsAndTransfers: {
          accounts: [mockAccount],
        },
      };

      const mockRequest = createMockRequest({
        params: { accountId: 'account-1', billId: 'bill-2' },
      });

      vi.mocked(getData).mockResolvedValue(mockData as any);
      vi.mocked(getById).mockReturnValue(mockAccount as any);
      vi.mocked(getByIdWithIdx).mockReturnValue({ item: mockBill, idx: 0 } as any);

      const result = await deleteSpecificBill(mockRequest);

      expect(getData).toHaveBeenCalledWith(mockRequest);
      expect(getById).toHaveBeenCalledWith(mockData.accountsAndTransfers.accounts, 'account-1');
      expect(getByIdWithIdx).toHaveBeenCalledWith(mockAccount.bills, 'bill-2');
      expect(mockSplice).toHaveBeenCalledWith(0, 1);
      expect(saveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
      expect(result).toBe('bill-2');
    });
  });

  describe('changeAccountForBill', () => {
    it('should update fro field for transfer bills', async () => {
      const mockBill = {
        id: 'bill-1',
        name: 'Transfer Bill',
        isTransfer: true,
        fro: 'Old Account',
      };

      const mockOldAccount = {
        id: 'account-1',
        name: 'Old Account',
        bills: [],
      };

      const mockNewAccount = {
        id: 'account-2',
        name: 'New Account',
        bills: [],
      };

      const mockData = {
        isTransfer: true,
        accountsAndTransfers: {
          accounts: [mockOldAccount, mockNewAccount],
          transfers: {
            bills: [mockBill],
          },
        },
      };

      const mockRequest = createMockRequest({
        params: {
          accountId: 'account-1',
          billId: 'bill-1',
          newAccountId: 'account-2',
        },
      });

      vi.mocked(getData).mockResolvedValue(mockData as any);
      vi.mocked(getById)
        .mockReturnValueOnce(mockOldAccount as any)
        .mockReturnValueOnce(mockBill as any)
        .mockReturnValueOnce(mockNewAccount as any);

      const result = await changeAccountForBill(mockRequest);

      expect(getData).toHaveBeenCalledWith(mockRequest);
      expect(getById).toHaveBeenNthCalledWith(1, mockData.accountsAndTransfers.accounts, 'account-1');
      expect(getById).toHaveBeenNthCalledWith(2, mockData.accountsAndTransfers.transfers.bills, 'bill-1');
      expect(getById).toHaveBeenNthCalledWith(3, mockData.accountsAndTransfers.accounts, 'account-2');
      expect(mockBill.fro).toBe('New Account');
      expect(saveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
      expect(result).toBe('bill-1');
    });

    it('should move bill from old account to new account for non-transfer bills', async () => {
      const mockBill = {
        id: 'bill-2',
        name: 'Regular Bill',
        isTransfer: false,
      };

      const mockOldAccount = {
        id: 'account-1',
        name: 'Old Account',
        bills: [mockBill],
      };

      const mockNewAccount = {
        id: 'account-2',
        name: 'New Account',
        bills: [],
      };

      const mockData = {
        isTransfer: false,
        accountsAndTransfers: {
          accounts: [mockOldAccount, mockNewAccount],
        },
      };

      const mockRequest = createMockRequest({
        params: {
          accountId: 'account-1',
          billId: 'bill-2',
          newAccountId: 'account-2',
        },
      });

      vi.mocked(getData).mockResolvedValue(mockData as any);
      vi.mocked(getById)
        .mockReturnValueOnce(mockOldAccount as any)
        .mockReturnValueOnce(mockBill as any)
        .mockReturnValueOnce(mockNewAccount as any);

      const result = await changeAccountForBill(mockRequest);

      expect(getById).toHaveBeenNthCalledWith(1, mockData.accountsAndTransfers.accounts, 'account-1');
      // The second getById call receives the bills array at the time of calling (before removal)
      expect(getById).toHaveBeenNthCalledWith(2, expect.arrayContaining([mockBill]), 'bill-2');
      expect(getById).toHaveBeenNthCalledWith(3, mockData.accountsAndTransfers.accounts, 'account-2');
      expect(mockOldAccount.bills).not.toContain(mockBill);
      expect(mockNewAccount.bills).toContain(mockBill);
      expect(saveData).toHaveBeenCalledWith(mockData.accountsAndTransfers);
      expect(result).toBe('bill-2');
    });
  });
});
