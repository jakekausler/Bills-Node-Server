import { debug, log, warn, err, logger, LogLevel } from './logger';

function testLogging() {
  debug('This is a debug message');
  log('This is an info message');
  warn('This is a warning message');
  err('This is an error message');

  // Test the generic logger function
  logger(LogLevel.LOG, 'This is a message using the generic logger');
}

function anotherFunction() {
  log('Message from another function');

  // Test nested function
  function nestedFunction() {
    warn('Message from nested function');
  }

  nestedFunction();
}

// Test the logger
console.log('=== Testing without SCENARIO env variable ===');
testLogging();
anotherFunction();

console.log('\n=== Testing with SCENARIO env variable ===');
process.env.SCENARIO = 'current_to_near_future';
testLogging();
anotherFunction();

// Clean up
delete process.env.SCENARIO;
