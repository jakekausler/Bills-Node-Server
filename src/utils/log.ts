import fs from 'fs';
import path from 'path';
import cliProgress from 'cli-progress';

const LOG_FILE = path.join(__dirname, '../../log.txt');

/**
 * Logs a message to a file with optional reset flag
 *
 * @param message - The message to log to the file
 * @param reset - If true, overwrites the file; if false, appends to the file
 */
export function logToFile(message: string, reset: boolean = false) {
  const logFile = fs.createWriteStream(LOG_FILE, { flags: reset ? 'w' : 'a' });
  logFile.write(message + '\n');
  logFile.end();
}

/**
 * Starts timing for a function (currently disabled — logic commented out)
 *
 * Still referenced by src/utils/graph/graph.ts and legacy calculate/ code.
 * TODO: Needs to handle recursive calls
 * @param _fn - Function or function name to start timing for
 */
export function startTiming(_fn: Function | string) {
  // const name = _fn instanceof Function ? _fn.name : _fn;
  // functionTimings[name] = Date.now();
  // console.log(`=== ${_getIndent()}|  ${name} started`);
}

/**
 * Ends timing for a function (currently disabled — logic commented out)
 *
 * Still referenced by src/utils/graph/graph.ts and legacy calculate/ code.
 * @param _fn - Function or function name to end timing for
 */
export function endTiming(_fn: Function | string) {
  // const name = _fn instanceof Function ? _fn.name : _fn;
  // const startTime = functionTimings[name];
  // const endTime = Date.now();
  // console.log(`=== ${_getIndent()}|  ${name} took ${Math.round(endTime - startTime) / 1000}s`);
  // delete functionTimings[name];
}

const SHOW_PROGRESS_BAR = true;
let progressBar: cliProgress.SingleBar;

/**
 * Initializes a progress bar for tracking simulation progress
 *
 * @param nDays - Total number of days to process
 * @param nSimulation - Current simulation number (0-indexed, -1 for single simulation)
 * @param nSimulations - Total number of simulations (-1 for single simulation)
 */
export function initProgressBar(nDays: number, nSimulation: number = -1, nSimulations: number = -1) {
  if (!SHOW_PROGRESS_BAR) {
    return;
  }
  progressBar = new cliProgress.SingleBar({
    format: `Progress |{bar}| {percentage}% | ${nSimulation > 0 ? nSimulation + 1 : 1} / ${
      nSimulations > 0 ? nSimulations : 1
    }`,
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
  });
  progressBar.start(nDays, 0);
}

/**
 * Increments the progress bar by one step
 */
export function incrementProgressBar() {
  if (!SHOW_PROGRESS_BAR) {
    return;
  }
  progressBar.increment();
}

/**
 * Stops and cleans up the progress bar
 */
export function stopProgressBar() {
  if (!SHOW_PROGRESS_BAR) {
    return;
  }
  progressBar.stop();
}
