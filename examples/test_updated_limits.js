#!/usr/bin/env node

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function checkArchiveSize(sizeBytes) {
  const GIST_SIZE_LIMIT_API = 40 * 1024 * 1024;      // ~40 MB for base64 encoded content
  const GIST_SIZE_LIMIT_WEB = 20 * 1024 * 1024;      // ~20 MB via web interface
  const GIST_SIZE_WARNING = 10 * 1024 * 1024;        // 10 MB warning threshold
  
  const actualSize = Math.ceil(sizeBytes * 1.33); // Base64 encoding overhead
  
  return {
    size: sizeBytes,
    actualUploadSize: actualSize,
    sizeFormatted: formatBytes(sizeBytes),
    actualSizeFormatted: formatBytes(actualSize),
    withinLimit: actualSize <= GIST_SIZE_LIMIT_API,
    isLarge: actualSize > GIST_SIZE_WARNING,
    exceedsWebLimit: actualSize > GIST_SIZE_LIMIT_WEB,
    exceedsApiLimit: actualSize > GIST_SIZE_LIMIT_API
  };
}

// Test the issue case with updated limits
const issueSize = Math.floor(38.43 * 1024 * 1024);
const result = checkArchiveSize(issueSize);

console.log('Testing issue case with updated limits:');
console.log(`Original: ${result.sizeFormatted}`);
console.log(`Base64 encoded: ${result.actualSizeFormatted}`);
console.log(`Within API limit: ${result.withinLimit}`);
console.log(`Exceeds API limit: ${result.exceedsApiLimit}`);
console.log(`Exceeds web limit: ${result.exceedsWebLimit}`);
console.log(`Is large: ${result.isLarge}`);

// Test a size that should work
const workingSize = Math.floor(28 * 1024 * 1024); // 28 MB should become ~37 MB when base64 encoded
const workingResult = checkArchiveSize(workingSize);

console.log('\nTesting a size that should work (28 MB):');
console.log(`Original: ${workingResult.sizeFormatted}`);
console.log(`Base64 encoded: ${workingResult.actualSizeFormatted}`);
console.log(`Within API limit: ${workingResult.withinLimit}`);