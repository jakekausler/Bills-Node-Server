import fs from 'fs';
import cliProgress from 'cli-progress';
import { formatDate } from './date/date';

const LOG_FILE = '/home/jakekausler/programs/billsV2/log.txt';

export function logToFile(message: string, reset: boolean = false) {
  const logFile = fs.createWriteStream(LOG_FILE, { flags: reset ? 'w' : 'a' });
  logFile.write(message + '\n');
  logFile.end();
}

let functionTimings: Record<string, number> = {};

function getIndent() {
  return '|  '.repeat(Object.keys(functionTimings).length);
}

// TODO: Needs to handle recursive calls
export function startTiming(fn: Function | string) {
  // const name = fn instanceof Function ? fn.name : fn;
  // functionTimings[name] = Date.now();
  // console.log(`=== ${getIndent()}|  ${name} started`);
}

export function endTiming(fn: Function | string) {
  // const name = fn instanceof Function ? fn.name : fn;
  // const startTime = functionTimings[name];
  // const endTime = Date.now();
  // console.log(`=== ${getIndent()}|  ${name} took ${Math.round(endTime - startTime) / 1000}s`);
  // delete functionTimings[name];
}

const SHOW_PROGRESS_BAR = true;
let progressBar: cliProgress.SingleBar;

export function initProgressBar(nDays: number, startDate: Date, nSimulation: number = -1, nSimulations: number = -1) {
  if (!SHOW_PROGRESS_BAR) {
    return;
  }
  progressBar = new cliProgress.SingleBar({
    format: `Progress |{bar}| {percentage}% | ${nSimulation > 0 ? nSimulation + 1 : 1} / ${
      nSimulations > 0 ? nSimulations : 1
    } {date}`,
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
  });
  progressBar.start(nDays, 0, {
    date: formatDate(startDate),
  });
}

export function incrementProgressBar(currentDate: Date) {
  if (!SHOW_PROGRESS_BAR) {
    return;
  }
  progressBar.increment();
  progressBar.update({
    date: formatDate(currentDate),
  });
}

export function stopProgressBar() {
  if (!SHOW_PROGRESS_BAR) {
    return;
  }
  progressBar.stop();
}

// export function logProgressDate(
//   startDate: Date,
//   currDate: Date,
//   endDate: Date,
//   simulationNumber: number,
//   maxSimulations: number,
// ) {
//   // const progress = ((currDate.getTime() - startDate.getTime()) / (endDate.getTime() - startDate.getTime())) * 100;
//   // console.log(
//   //   `=== ${getIndent()}|  ${formatDate(currDate)} ${progress.toFixed(2)}%${
//   //     simulationNumber !== -1 ? ` ${simulationNumber}` : ''
//   //   }${maxSimulations !== -1 ? ` / ${maxSimulations}` : ''}`,
//   // );
// }
