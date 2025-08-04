import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import cliProgress from 'cli-progress';
import { logToFile, startTiming, endTiming, initProgressBar, incrementProgressBar, stopProgressBar } from './log';

// Mock dependencies
vi.mock('fs');
vi.mock('cli-progress');

describe('Log Utilities', () => {
  let mockWriteStream: {
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
  let mockProgressBar: {
    start: ReturnType<typeof vi.fn>;
    increment: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock fs.createWriteStream
    mockWriteStream = {
      write: vi.fn(),
      end: vi.fn(),
    };
    vi.mocked(fs.createWriteStream).mockReturnValue(mockWriteStream as fs.WriteStream);

    // Mock cli-progress.SingleBar
    mockProgressBar = {
      start: vi.fn(),
      increment: vi.fn(),
      stop: vi.fn(),
    };
    vi.mocked(cliProgress.SingleBar).mockImplementation(() => mockProgressBar);
  });

  describe('logToFile', () => {
    it('should write message to log file with append flag by default', () => {
      const message = 'Test log message';

      logToFile(message);

      expect(fs.createWriteStream).toHaveBeenCalledWith('/storage/programs/billsV2/log.txt', { flags: 'a' });
      expect(mockWriteStream.write).toHaveBeenCalledWith(message + '\n');
      expect(mockWriteStream.end).toHaveBeenCalled();
    });

    it('should write message to log file with write flag when reset is true', () => {
      const message = 'Test log message with reset';

      logToFile(message, true);

      expect(fs.createWriteStream).toHaveBeenCalledWith('/storage/programs/billsV2/log.txt', { flags: 'w' });
      expect(mockWriteStream.write).toHaveBeenCalledWith(message + '\n');
      expect(mockWriteStream.end).toHaveBeenCalled();
    });

    it('should handle empty message', () => {
      const message = '';

      logToFile(message);

      expect(mockWriteStream.write).toHaveBeenCalledWith('\n');
      expect(mockWriteStream.end).toHaveBeenCalled();
    });

    it('should handle multiline message', () => {
      const message = 'Line 1\nLine 2\nLine 3';

      logToFile(message);

      expect(mockWriteStream.write).toHaveBeenCalledWith(message + '\n');
      expect(mockWriteStream.end).toHaveBeenCalled();
    });

    it('should handle special characters in message', () => {
      const message = 'Special chars: äöü àáâ ñ €';

      logToFile(message);

      expect(mockWriteStream.write).toHaveBeenCalledWith(message + '\n');
      expect(mockWriteStream.end).toHaveBeenCalled();
    });
  });

  describe('startTiming', () => {
    it('should handle function parameter', () => {
      const testFunction = () => {};

      // Since the function is commented out, it should not throw
      expect(() => startTiming(testFunction)).not.toThrow();
    });

    it('should handle string parameter', () => {
      const functionName = 'testFunction';

      // Since the function is commented out, it should not throw
      expect(() => startTiming(functionName)).not.toThrow();
    });

    it('should handle empty string parameter', () => {
      const functionName = '';

      // Since the function is commented out, it should not throw
      expect(() => startTiming(functionName)).not.toThrow();
    });

    it('should handle anonymous function', () => {
      const anonymousFunction = () => {};

      // Since the function is commented out, it should not throw
      expect(() => startTiming(anonymousFunction)).not.toThrow();
    });
  });

  describe('endTiming', () => {
    it('should handle function parameter', () => {
      const testFunction = () => {};

      // Since the function is commented out, it should not throw
      expect(() => endTiming(testFunction)).not.toThrow();
    });

    it('should handle string parameter', () => {
      const functionName = 'testFunction';

      // Since the function is commented out, it should not throw
      expect(() => endTiming(functionName)).not.toThrow();
    });

    it('should handle empty string parameter', () => {
      const functionName = '';

      // Since the function is commented out, it should not throw
      expect(() => endTiming(functionName)).not.toThrow();
    });

    it('should handle anonymous function', () => {
      const anonymousFunction = () => {};

      // Since the function is commented out, it should not throw
      expect(() => endTiming(anonymousFunction)).not.toThrow();
    });
  });

  describe('initProgressBar', () => {
    it('should initialize progress bar with number of days', () => {
      const nDays = 100;

      initProgressBar(nDays);

      expect(cliProgress.SingleBar).toHaveBeenCalledWith({
        format: 'Progress |{bar}| {percentage}% | 1 / 1',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
      });
      expect(mockProgressBar.start).toHaveBeenCalledWith(nDays, 0);
    });

    it('should initialize progress bar with simulation numbers', () => {
      const nDays = 365;
      const nSimulation = 2;
      const nSimulations = 5;

      initProgressBar(nDays, nSimulation, nSimulations);

      expect(cliProgress.SingleBar).toHaveBeenCalledWith({
        format: 'Progress |{bar}| {percentage}% | 3 / 5',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
      });
      expect(mockProgressBar.start).toHaveBeenCalledWith(nDays, 0);
    });

    it('should handle zero simulation number', () => {
      const nDays = 30;
      const nSimulation = 0;
      const nSimulations = 10;

      initProgressBar(nDays, nSimulation, nSimulations);

      expect(cliProgress.SingleBar).toHaveBeenCalledWith({
        format: 'Progress |{bar}| {percentage}% | 1 / 10',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
      });
      expect(mockProgressBar.start).toHaveBeenCalledWith(nDays, 0);
    });

    it('should handle negative simulation numbers', () => {
      const nDays = 50;
      const nSimulation = -1;
      const nSimulations = -1;

      initProgressBar(nDays, nSimulation, nSimulations);

      expect(cliProgress.SingleBar).toHaveBeenCalledWith({
        format: 'Progress |{bar}| {percentage}% | 1 / 1',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
      });
      expect(mockProgressBar.start).toHaveBeenCalledWith(nDays, 0);
    });

    it('should handle zero days', () => {
      const nDays = 0;

      initProgressBar(nDays);

      expect(cliProgress.SingleBar).toHaveBeenCalled();
      expect(mockProgressBar.start).toHaveBeenCalledWith(0, 0);
    });

    it('should handle large numbers', () => {
      const nDays = 10000;
      const nSimulation = 999;
      const nSimulations = 1000;

      initProgressBar(nDays, nSimulation, nSimulations);

      expect(cliProgress.SingleBar).toHaveBeenCalledWith({
        format: 'Progress |{bar}| {percentage}% | 1000 / 1000',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
      });
      expect(mockProgressBar.start).toHaveBeenCalledWith(nDays, 0);
    });
  });

  describe('incrementProgressBar', () => {
    beforeEach(() => {
      // Initialize progress bar before each test
      initProgressBar(100);
    });

    it('should increment progress bar', () => {
      incrementProgressBar();

      expect(mockProgressBar.increment).toHaveBeenCalled();
    });

    it('should handle multiple increments', () => {
      incrementProgressBar();
      incrementProgressBar();
      incrementProgressBar();

      expect(mockProgressBar.increment).toHaveBeenCalledTimes(3);
    });
  });

  describe('stopProgressBar', () => {
    beforeEach(() => {
      // Initialize progress bar before each test
      initProgressBar(100);
    });

    it('should stop progress bar', () => {
      stopProgressBar();

      expect(mockProgressBar.stop).toHaveBeenCalled();
    });

    it('should handle multiple stops', () => {
      stopProgressBar();
      stopProgressBar();

      expect(mockProgressBar.stop).toHaveBeenCalledTimes(2);
    });
  });

  describe('Progress Bar Integration', () => {
    it('should handle full progress bar lifecycle', () => {
      const nDays = 10;

      // Initialize
      initProgressBar(nDays);
      expect(mockProgressBar.start).toHaveBeenCalledWith(nDays, 0);

      // Increment multiple times
      for (let i = 0; i < nDays; i++) {
        incrementProgressBar();
      }
      expect(mockProgressBar.increment).toHaveBeenCalledTimes(nDays);

      // Stop
      stopProgressBar();
      expect(mockProgressBar.stop).toHaveBeenCalled();
    });

    it('should handle progress bar with simulation tracking', () => {
      const nDays = 5;
      const nSimulation = 1;
      const nSimulations = 3;

      // Initialize with simulation info
      initProgressBar(nDays, nSimulation, nSimulations);
      expect(cliProgress.SingleBar).toHaveBeenCalledWith({
        format: 'Progress |{bar}| {percentage}% | 2 / 3',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
      });

      // Run simulation
      for (let i = 0; i < nDays; i++) {
        incrementProgressBar();
      }

      // Complete simulation
      stopProgressBar();
      expect(mockProgressBar.stop).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle file system errors in logToFile', () => {
      const mockError = new Error('File system error');
      vi.mocked(fs.createWriteStream).mockImplementation(() => {
        throw mockError;
      });

      expect(() => logToFile('test message')).toThrow('File system error');
    });

    it('should handle progress bar construction errors', () => {
      const mockError = new Error('Progress bar error');
      vi.mocked(cliProgress.SingleBar).mockImplementation(() => {
        throw mockError;
      });

      expect(() => initProgressBar(100)).toThrow('Progress bar error');
    });
  });
});
