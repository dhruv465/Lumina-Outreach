#!/usr/bin/env node

/**
 * Script to run web call tests
 */

const { execSync } = require('child_process');
const path = require('path');

console.log('Running Web Call Tests...');

try {
  // Run server-side tests
  console.log('\n=== Running Server-Side Tests ===\n');
  execSync('npx vitest run "src/services/__tests__/web-call/*.test.ts" "src/controllers/__tests__/webCallController.test.ts" --run', { 
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '../../')
  });
  
  // Run client-side tests
  console.log('\n=== Running Client-Side Tests ===\n');
  execSync('cd ../../client && npx vitest run "src/components/__tests__/WebCallAudioProcessor.test.ts" "src/components/__tests__/WebCallTesting.test.tsx" --run', { 
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '../../')
  });
  
  console.log('\n✅ All tests completed successfully!');
} catch (error) {
  console.error('\n❌ Tests failed:', error.message);
  process.exit(1);
}