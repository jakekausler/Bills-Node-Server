import path from 'path';

export enum LogLevel {
  DEBUG = 'DEBUG',
  LOG = 'LOG',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

interface LogEntry {
  fileName: string;
  functionName: string;
  scenario?: string;
  level: LogLevel;
  message: string;
}

/**
 * Extracts caller information from the call stack
 * @param depth How deep in the call stack to look (2 = caller of caller)
 */
function getCallerInfo(depth: number = 2): { fileName: string; functionName: string } {
  const originalPrepareStackTrace = Error.prepareStackTrace;

  try {
    Error.prepareStackTrace = (_, stack) => stack;
    const stack = new Error().stack as unknown as NodeJS.CallSite[];

    if (stack && stack.length > depth) {
      const caller = stack[depth];
      const fileName = caller.getFileName();
      const functionName = caller.getFunctionName();

      return {
        fileName: fileName ? path.basename(fileName, '.ts') : 'unknown',
        functionName: functionName || 'anonymous',
      };
    }
  } finally {
    Error.prepareStackTrace = originalPrepareStackTrace;
  }

  return {
    fileName: 'unknown',
    functionName: 'unknown',
  };
}

function formatExtraInformation(extraInformation: Record<string, any>): string {
  return Object.entries(extraInformation)
    .map(([key, value]) => `${key}: ${value}`)
    .join(' | ');
}

/**
 * Main logging function
 * @param level Log level
 * @param args Message parts and optional extraInformation
 */
function logMessage(level: LogLevel, ...args: any[]): void {
  const { fileName, functionName } = getCallerInfo(3); // 3 because we go through helper methods
  const scenario = process.env.SCENARIO;

  // Check if the last argument is extraInformation (an object with string keys)
  let extraInformation: Record<string, any> | undefined;
  let messageParts = args;

  if (args.length > 0) {
    const lastArg = args[args.length - 1];
    // Only treat as extraInformation if it's a plain object with at least one string key
    if (
      lastArg &&
      typeof lastArg === 'object' &&
      lastArg.constructor === Object &&
      Object.keys(lastArg).length > 0 &&
      Object.keys(lastArg).some((key) => typeof key === 'string')
    ) {
      extraInformation = lastArg;
      messageParts = args.slice(0, -1);
    }
  }

  // Join message parts like console.log does
  const message = messageParts.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join(' ');

  const logEntry: LogEntry = {
    fileName,
    functionName,
    level,
    message,
  };

  if (scenario) {
    logEntry.scenario = scenario;
  }

  // Format output
  const parts: string[] = [];

  if (logEntry.scenario) {
    parts.push(`${logEntry.scenario}`);
  }

  parts.push(`${logEntry.level}`);

  parts.push(`${logEntry.fileName}:${logEntry.functionName}`);

  parts.push(logEntry.message);

  // Add extra information as JSON after the message
  if (extraInformation && Object.keys(extraInformation).length > 0) {
    parts.push(formatExtraInformation(extraInformation));
  }

  const fullOutput = parts.join(' | ');

  // Output to appropriate console method based on level
  switch (level) {
    case LogLevel.DEBUG:
      console.debug(fullOutput);
      break;
    case LogLevel.LOG:
      console.log(fullOutput);
      break;
    case LogLevel.WARN:
      console.warn(fullOutput);
      break;
    case LogLevel.ERROR:
      console.error(fullOutput);
      break;
    default:
      console.log(fullOutput);
  }
}

/**
 * Debug level logging - accepts multiple message parts like console.log
 * @param args Message parts and optional extraInformation (e.g., 'Processing', userId, 'for account', { accountId: 1234 })
 */
export function debug(...args: any[]): void {
  logMessage(LogLevel.DEBUG, ...args);
}

/**
 * Info level logging - accepts multiple message parts like console.log
 * @param args Message parts and optional extraInformation (e.g., 'User', userId, 'logged in', { sessionId: 'abc123' })
 */
export function log(...args: any[]): void {
  logMessage(LogLevel.LOG, ...args);
}

/**
 * Warning level logging - accepts multiple message parts like console.log
 * @param args Message parts and optional extraInformation (e.g., 'Low balance for', accountName, { balance: 10.50 })
 */
export function warn(...args: any[]): void {
  logMessage(LogLevel.WARN, ...args);
}

/**
 * Error level logging - accepts multiple message parts like console.log
 * @param args Message parts and optional extraInformation (e.g., 'Failed to process', transactionId, { error: 'timeout' })
 */
export function err(...args: any[]): void {
  logMessage(LogLevel.ERROR, ...args);
}

/**
 * Generic logging function that accepts a level and multiple message parts like console.log
 * @param level Log level
 * @param args Message parts and optional extraInformation
 */
export function logger(level: LogLevel, ...args: any[]): void {
  logMessage(level, ...args);
}
