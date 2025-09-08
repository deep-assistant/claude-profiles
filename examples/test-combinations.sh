#!/bin/bash

echo "Testing argument validation for issue #2..."
echo "=========================================="
echo

echo "1. Testing --restore with --watch (should work):"
# Timeout the command after 3 seconds since it will try to actually run
timeout 3s node ../claude-profiles.mjs --restore gitpod --watch gitpod > /dev/null 2>&1
exit_code=$?
if [ $exit_code -eq 124 ] || [ $exit_code -eq 0 ]; then
  echo "✅ PASS: --restore --watch combination is accepted (timed out as expected)"
else 
  echo "❌ FAIL: --restore --watch combination was rejected"
fi

echo
echo "2. Testing --store with --watch (should work):"
# Timeout the command after 3 seconds since it will try to actually run
timeout 3s node ../claude-profiles.mjs --store test --watch test > /dev/null 2>&1
exit_code=$?
if [ $exit_code -eq 124 ] || [ $exit_code -eq 0 ]; then
  echo "✅ PASS: --store --watch combination is accepted (timed out as expected)"
else
  echo "❌ FAIL: --store --watch combination was rejected"  
fi

echo
echo "3. Testing --list with --watch (should fail):"
node ../claude-profiles.mjs --list --watch test > /dev/null 2>&1
if [ $? -ne 0 ]; then
  echo "✅ PASS: --list --watch combination is properly rejected"
else
  echo "❌ FAIL: --list --watch combination was incorrectly accepted"
fi

echo
echo "4. Testing --delete with --watch (should fail):"
node ../claude-profiles.mjs --delete test --watch test > /dev/null 2>&1
if [ $? -ne 0 ]; then
  echo "✅ PASS: --delete --watch combination is properly rejected"
else
  echo "❌ FAIL: --delete --watch combination was incorrectly accepted"
fi

echo
echo "5. Testing --restore --store --watch (should fail - too many options):"
node ../claude-profiles.mjs --restore test --store test --watch test > /dev/null 2>&1
if [ $? -ne 0 ]; then
  echo "✅ PASS: triple combination is properly rejected"
else
  echo "❌ FAIL: triple combination was incorrectly accepted"
fi

echo
echo "Testing complete!"