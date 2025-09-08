#!/usr/bin/env node

/**
 * Test script to verify that the watch mode doesn't create double uploads
 * This simulates rapid file changes that could trigger concurrent save attempts
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const testProfileName = 'test-concurrency';

async function setupTestEnvironment() {
  console.log('🔧 Setting up test environment...');
  
  // Create a temporary Claude configuration
  const claudeDir = path.join(os.homedir(), '.claude');
  const claudeConfig = path.join(os.homedir(), '.claude.json');
  
  // Ensure .claude directory exists
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }
  
  // Create minimal test credentials
  const testCreds = {
    claudeAiOauth: {
      accessToken: 'test-access-token-' + Date.now(),
      refreshToken: 'test-refresh-token-' + Date.now(),
      expiresAt: Date.now() + 3600000,
      scopes: ['user:inference'],
      subscriptionType: 'max'
    }
  };
  
  fs.writeFileSync(path.join(claudeDir, '.credentials.json'), JSON.stringify(testCreds, null, 2));
  
  // Create minimal test config
  const testConfig = {
    version: '1.0.0',
    lastUsed: new Date().toISOString(),
    settings: {
      theme: 'dark',
      testMode: true
    }
  };
  
  fs.writeFileSync(claudeConfig, JSON.stringify(testConfig, null, 2));
  
  console.log('✅ Test environment ready');
}

async function simulateRapidChanges() {
  console.log('🔄 Simulating rapid file changes...');
  
  const claudeConfig = path.join(os.homedir(), '.claude.json');
  
  // Make several rapid changes
  for (let i = 0; i < 5; i++) {
    const config = JSON.parse(fs.readFileSync(claudeConfig, 'utf8'));
    config.lastModified = new Date().toISOString();
    config.changeNumber = i + 1;
    
    fs.writeFileSync(claudeConfig, JSON.stringify(config, null, 2));
    console.log(`📝 Made change #${i + 1}`);
    
    // Small delay between changes
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log('✅ Rapid changes completed');
}

async function cleanup() {
  console.log('🧹 Cleaning up test environment...');
  
  try {
    // Delete test profile if it exists
    execSync(`./claude-profiles.mjs --delete ${testProfileName}`, { stdio: 'ignore' });
  } catch {
    // Profile might not exist, that's OK
  }
  
  console.log('✅ Cleanup completed');
}

function printInstructions() {
  console.log('');
  console.log('📋 Test Instructions:');
  console.log('1. Run this script to set up test environment');
  console.log(`2. In another terminal, start watch mode: ./claude-profiles.mjs --watch ${testProfileName} --verbose --log`);
  console.log('3. Watch the logs for any double upload indicators');
  console.log('4. The test will simulate rapid file changes');
  console.log('5. Check that only one save operation happens per change batch');
  console.log('');
  console.log('🔍 What to look for:');
  console.log('- "Save already in progress, skipping duplicate save request" messages');
  console.log('- No concurrent "Profile uploaded successfully" messages');
  console.log('- Save counter should increment properly without gaps');
  console.log('');
}

async function main() {
  if (process.argv.includes('--help')) {
    printInstructions();
    return;
  }
  
  if (process.argv.includes('--cleanup')) {
    await cleanup();
    return;
  }
  
  if (process.argv.includes('--simulate')) {
    console.log('Waiting 3 seconds for watch mode to be ready...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    await simulateRapidChanges();
    return;
  }
  
  console.log('🧪 Claude Profiles Watch Mode Concurrency Test');
  console.log('================================================');
  
  await setupTestEnvironment();
  printInstructions();
  
  console.log('💡 Tip: Run with --simulate to trigger rapid changes');
  console.log('💡 Tip: Run with --cleanup to clean up test data');
}

main().catch(error => {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
});