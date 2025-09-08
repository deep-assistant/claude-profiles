#!/usr/bin/env node

// Test script to verify gist scope detection works correctly
// This simulates the gh auth status output format shown in the GitHub issue

// Simulate the gh auth status output from the issue
const mockGhAuthOutput = `github.com
  ✓ Logged in to github.com account konard (keyring)
  - Active account: true
  - Git operations protocol: https
  - Token: gho_************************************
  - Token scopes: 'delete_repo', 'gist', 'read:org', 'repo', 'workflow'

  ✓ Logged in to github.com account Konard (keyring)
  - Active account: false
  - Git operations protocol: https
  - Token: gho_************************************
  - Token scopes: 'admin:public_key', 'gist', 'read:org', 'repo'`;

// Test the old (buggy) logic
function testOldLogic(output) {
  console.log('🧪 Testing OLD (buggy) logic:');
  const scopesMatch = output.match(/Token scopes:\s*'([^']+)'/);
  
  if (scopesMatch) {
    console.log('   Found scopes match:', scopesMatch[1]);
    const hasGistScope = scopesMatch[1].includes('gist');
    console.log('   Has gist scope:', hasGistScope);
    
    if (!hasGistScope) {
      console.log('   ❌ WOULD SHOW WARNING: Your GitHub token does not have "gist" scope');
    } else {
      console.log('   ✅ No warning would be shown');
    }
  } else {
    console.log('   ❌ No scopes found');
  }
}

// Test the new (fixed) logic
function testNewLogic(output) {
  console.log('🔧 Testing NEW (fixed) logic:');
  const scopesMatch = output.match(/Token scopes:\s*(.+)/);
  
  if (scopesMatch) {
    const scopesLine = scopesMatch[1];
    console.log('   Found scopes line:', scopesLine);
    
    // Extract all quoted strings
    const quotedScopes = scopesLine.match(/'([^']+)'/g);
    if (quotedScopes) {
      // Remove quotes from each scope
      const scopes = quotedScopes.map(s => s.replace(/'/g, ''));
      console.log('   Parsed scopes:', scopes);
      const hasGistScope = scopes.includes('gist');
      console.log('   Has gist scope:', hasGistScope);
      
      if (!hasGistScope) {
        console.log('   ❌ WOULD SHOW WARNING: Your GitHub token does not have "gist" scope');
      } else {
        console.log('   ✅ No warning would be shown');
      }
    } else {
      // Fallback: split by comma if no quotes found
      const scopes = scopesLine.split(',').map(s => s.trim());
      console.log('   Fallback parsed scopes:', scopes);
      const hasGistScope = scopes.includes('gist');
      console.log('   Has gist scope:', hasGistScope);
      
      if (!hasGistScope) {
        console.log('   ❌ WOULD SHOW WARNING: Your GitHub token does not have "gist" scope');
      } else {
        console.log('   ✅ No warning would be shown');
      }
    }
  } else {
    console.log('   ❌ No scopes found');
  }
}

console.log('🐛 Testing gist scope detection fix\n');

console.log('📄 Sample gh auth status output:');
console.log(mockGhAuthOutput.split('\n').slice(0, 6).join('\n'));
console.log('...\n');

testOldLogic(mockGhAuthOutput);
console.log('');
testNewLogic(mockGhAuthOutput);

console.log('\n✅ Test completed!');