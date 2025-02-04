import fs from 'fs';

const LOG_FILE = '/home/jakekausler/programs/billsV2/log.txt';

export function logToFile(message: string, reset: boolean = false) {
  const logFile = fs.createWriteStream(LOG_FILE, { flags: reset ? 'w' : 'a' });
  logFile.write(message + '\n');
  logFile.end();
}

let functionTimings: Record<string, number> = {};

function getIndent() {
  return '  '.repeat(Object.keys(functionTimings).length);
}

export function startTiming(fn: Function | string) {
  const name = fn instanceof Function ? fn.name : fn;
  functionTimings[name] = Date.now();
  console.log(`=== ${getIndent()}Starting ${name} ===`);
}

export function endTiming(fn: Function | string) {
  const name = fn instanceof Function ? fn.name : fn;
  const startTime = functionTimings[name];
  const endTime = Date.now();
  console.log(`=== ${getIndent()}${name} took ${Math.round(endTime - startTime) / 1000}s ===`);
  delete functionTimings[name];
}
