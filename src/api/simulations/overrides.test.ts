import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSimulationOverridesHandler, updateSimulationOverridesHandler } from './overrides';
import { load, save } from '../../utils/io/io';
import { Request } from 'express';

vi.mock('../../utils/io/io');
vi.mock('../../utils/io/dataCache', () => ({ clearDataCache: vi.fn() }));
vi.mock('../../utils/io/projectionsCache', () => ({ clearProjectionsCache: vi.fn() }));
vi.mock('../../utils/io/cache', () => ({ resetCache: vi.fn() }));

function mockRequest(params: Record<string, string> = {}, body: any = {}): Request {
  return { params, body } as unknown as Request;
}

describe('getSimulationOverridesHandler', () => {
  beforeEach(() => vi.resetAllMocks());

  it('should return overrides for a simulation that has them', () => {
    vi.mocked(load).mockReturnValue([
      { name: 'Default', enabled: true, selected: true, rateOverrides: { INFLATION: 0.04 }, systemVariableOverrides: { JAKE_RETIRE_DATE: '2060-01-01' } },
    ]);

    const result = getSimulationOverridesHandler(mockRequest({ name: 'Default' }));
    expect(result).toEqual({
      rateOverrides: { INFLATION: 0.04 },
      systemVariableOverrides: { JAKE_RETIRE_DATE: '2060-01-01' },
    });
  });

  it('should return empty objects when simulation has no overrides', () => {
    vi.mocked(load).mockReturnValue([
      { name: 'Default', enabled: true, selected: true },
    ]);

    const result = getSimulationOverridesHandler(mockRequest({ name: 'Default' }));
    expect(result).toEqual({ rateOverrides: {}, systemVariableOverrides: {} });
  });

  it('should throw 404 when simulation not found', () => {
    vi.mocked(load).mockReturnValue([]);
    expect(() => getSimulationOverridesHandler(mockRequest({ name: 'Missing' }))).toThrow("Simulation 'Missing' not found");
  });

  it('should decode URL-encoded simulation names', () => {
    vi.mocked(load).mockReturnValue([
      { name: 'Kendall Low Pay', enabled: true, selected: true },
    ]);

    const result = getSimulationOverridesHandler(mockRequest({ name: 'Kendall%20Low%20Pay' }));
    expect(result).toEqual({ rateOverrides: {}, systemVariableOverrides: {} });
  });
});

describe('updateSimulationOverridesHandler', () => {
  beforeEach(() => vi.resetAllMocks());

  it('should save overrides and return them', () => {
    vi.mocked(load).mockReturnValue([
      { name: 'Default', enabled: true, selected: true },
    ]);

    const result = updateSimulationOverridesHandler(
      mockRequest({ name: 'Default' }, { rateOverrides: { INFLATION: 0.05 }, systemVariableOverrides: { JAKE_RETIRE_DATE: '2065-01-01' } }),
    );

    expect(result).toEqual({
      rateOverrides: { INFLATION: 0.05 },
      systemVariableOverrides: { JAKE_RETIRE_DATE: '2065-01-01' },
    });
    expect(save).toHaveBeenCalled();
  });

  it('should throw 404 when simulation not found', () => {
    vi.mocked(load).mockReturnValue([]);
    expect(() =>
      updateSimulationOverridesHandler(mockRequest({ name: 'Missing' }, { rateOverrides: {} })),
    ).toThrow("Simulation 'Missing' not found");
  });

  it('should throw 400 when rateOverrides value is not a number', () => {
    vi.mocked(load).mockReturnValue([
      { name: 'Default', enabled: true, selected: true },
    ]);
    expect(() =>
      updateSimulationOverridesHandler(mockRequest({ name: 'Default' }, { rateOverrides: { INFLATION: 'bad' } })),
    ).toThrow("rateOverrides['INFLATION'] must be a number");
  });

  it('should throw 400 when systemVariableOverrides value is not YYYY-MM-DD', () => {
    vi.mocked(load).mockReturnValue([
      { name: 'Default', enabled: true, selected: true },
    ]);
    expect(() =>
      updateSimulationOverridesHandler(mockRequest({ name: 'Default' }, { systemVariableOverrides: { X: 'not-a-date' } })),
    ).toThrow("systemVariableOverrides['X'] must be a date string in YYYY-MM-DD format");
  });

  it('should remove empty override objects from saved data', () => {
    vi.mocked(load).mockReturnValue([
      { name: 'Default', enabled: true, selected: true, rateOverrides: { OLD: 0.01 } },
    ]);

    updateSimulationOverridesHandler(
      mockRequest({ name: 'Default' }, { rateOverrides: {}, systemVariableOverrides: {} }),
    );

    const savedData = vi.mocked(save).mock.calls[0][0] as any[];
    expect(savedData[0]).not.toHaveProperty('rateOverrides');
    expect(savedData[0]).not.toHaveProperty('systemVariableOverrides');
  });
});
