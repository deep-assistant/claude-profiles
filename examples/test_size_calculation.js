#!/usr/bin/env node

// Simple test to verify size calculation

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function calculateBase64Size(originalBytes) {
  // Base64 encoding adds ~33% overhead
  return Math.ceil(originalBytes * 1.33);
}

// Test the issue case
const issueSize = Math.floor(38.43 * 1024 * 1024);
const base64Size = calculateBase64Size(issueSize);

console.log('Issue case analysis:');
console.log(`Original zip: ${formatBytes(issueSize)}`);
console.log(`Base64 encoded: ${formatBytes(base64Size)}`);
console.log(`Overhead: ${(base64Size / issueSize * 100 - 100).toFixed(1)}%`);

// Test various limits
const limits = [
  { name: 'Old limit (100 MB)', size: 100 * 1024 * 1024 },
  { name: 'New limit (50 MB)', size: 50 * 1024 * 1024 },
  { name: 'Web limit (25 MB)', size: 25 * 1024 * 1024 }
];

console.log('\nLimit analysis:');
limits.forEach(limit => {
  console.log(`${limit.name}: ${formatBytes(limit.size)}`);
  console.log(`  Max zip size (accounting for base64): ${formatBytes(Math.floor(limit.size / 1.33))}`);
});

// Check if the issue size would pass with new limits
console.log('\nWould the issue case pass?');
console.log(`Base64 size (${formatBytes(base64Size)}) vs New limit (${formatBytes(50 * 1024 * 1024)}): ${base64Size <= 50 * 1024 * 1024 ? 'PASS' : 'FAIL'}`);