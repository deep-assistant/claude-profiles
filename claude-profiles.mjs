#!/usr/bin/env node

/**
 * Claude Profiles - Manage Claude configuration profiles using GitHub Gists
 * 
 * This tool uses use-m for dynamic module loading, requiring no package.json dependencies.
 * It stores Claude configurations as base64-encoded zip files in GitHub Gists.
 * 
 * Features:
 * - Store/restore Claude configurations
 * - Multiple profile management
 * - Profile verification
 * - Watch mode with filesystem monitoring
 * - Verbose logging and file logging support
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { createWriteStream } from 'fs';
import { promises as fsPromises } from 'fs';
import { createHash } from 'crypto';
import { execSync } from 'child_process';

// Dynamically load dependencies using use-m
const { use } = eval(
  await fetch('https://unpkg.com/use-m/use.js').then(r => r.text())
);

// Load required packages dynamically with specific versions
const [{ $ }, yargs, yargsHelpers, archiver] = await Promise.all([
  use('command-stream@0.7.0'),
  use('yargs@17.7.2'),
  use('yargs@17.7.2/helpers'),
  use('archiver@7.0.1')
]);

const { hideBin } = yargsHelpers;

const PROFILE_NAME_REGEX = /^[a-z0-9-]+$/;

// Global logging configuration
let logFile = null;
let isVerbose = false;

/**
 * Initialize logging based on options
 */
function initLogging(options) {
  isVerbose = options.verbose || false;
  
  if (options.log !== undefined) {
    // User specified log option
    if (typeof options.log === 'string' && options.log.length > 0) {
      // User provided specific log file path
      logFile = options.log;
    } else {
      // User enabled logging with default filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, -5);
      logFile = `claude-profiles-${timestamp}.txt.log`;
    }
    
    // Write initial log header
    const header = `Claude Profiles Log - Started at ${new Date().toISOString()}\n${'='.repeat(60)}\n\n`;
    try {
      fs.writeFileSync(logFile, header);
      log('INFO', `Logging initialized to file: ${logFile}`);
    } catch (error) {
      log('WARN', `Could not create log file: ${error.message}`);
      logFile = null;
    }
  }
}

/**
 * Log a message to console and optionally to file
 */
function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  
  // Console output - clean and user-friendly (no timestamps or level prefixes for INFO)
  if (level === 'ERROR') {
    console.error(message);
  } else if (level === 'WARN') {
    console.warn(message);
  } else if (level === 'INFO') {
    console.log(message);
  } else if (level === 'DEBUG' && isVerbose) {
    console.log(`[DEBUG] ${message}`);
  } else if (level === 'TRACE' && isVerbose) {
    console.log(`[TRACE] ${message}`);
  }
  
  // File output - detailed with timestamps and levels
  if (logFile) {
    try {
      const logEntry = `[${timestamp}] [${level}] ${message}`;
      let fileEntry = logEntry;
      if (data) {
        fileEntry += '\n' + JSON.stringify(data, null, 2);
      }
      fs.appendFileSync(logFile, fileEntry + '\n');
    } catch (error) {
      // Silently fail to avoid recursive logging issues
    }
  }
}

// Files and directories to backup/restore
const BACKUP_PATHS = [
  { source: '~/.claude', dest: '.claude' },
  { source: '~/.claude.json', dest: '.claude.json' },
  { source: '~/.claude.json.backup', dest: '.claude.json.backup' }
];

/**
 * Expand tilde (~) to home directory
 */
function expandHome(filepath) {
  if (filepath.startsWith('~/')) {
    return path.join(os.homedir(), filepath.slice(2));
  }
  return filepath;
}

/**
 * Get credentials from macOS Keychain
 */
async function getKeychainCredentials() {
  try {
    const result = await $`security find-generic-password -a $USER -s "Claude Code-credentials" -w`.run({ 
      capture: true, 
      mirror: false 
    });
    
    if (result.code !== 0) {
      return null;
    }
    
    const keychainData = JSON.parse(result.stdout.trim());
    // Return the keychain data exactly as stored (no conversion)
    // This preserves the exact format Claude Code expects
    return keychainData;
  } catch (error) {
    // Credentials not found in keychain
    return null;
  }
}

/**
 * Set credentials in macOS Keychain
 */
async function setKeychainCredentials(credentials) {
  try {
    // Handle different credential formats for backward compatibility
    let keychainData;
    
    if (credentials.claudeAiOauth) {
      // Already in correct keychain format - use as-is
      keychainData = credentials;
    } else if (credentials.access_token) {
      // Old format with underscores - convert to Claude's format
      keychainData = {
        claudeAiOauth: {
          accessToken: credentials.access_token,
          refreshToken: credentials.refresh_token,
          expiresAt: credentials.expiry_date || credentials.expiresAt,
          scopes: credentials.scopes || ['user:inference'],
          subscriptionType: credentials.subscriptionType || 'max'
        }
      };
    } else if (credentials.accessToken) {
      // Already in Claude's format but not wrapped - wrap it
      keychainData = {
        claudeAiOauth: credentials
      };
    } else {
      // Unknown format - try to use as-is
      keychainData = credentials;
    }
    
    const jsonStr = JSON.stringify(keychainData);
    // Escape exactly like Claude Code does - only escape double quotes
    const escapedJson = jsonStr.replace(/"/g, '\\"');
    
    try {
      // Use execSync like Claude Code does, with shell: true
      const command = `security add-generic-password -U -a $USER -s "Claude Code-credentials" -w "${escapedJson}"`;
      execSync(command, { 
        shell: true,
        stdio: isVerbose ? 'inherit' : 'ignore'
      });
      
      /* FAILED APPROACH - command-stream $ function adds extra quotes
       * This approach fails because the command-stream library's $ function
       * adds an extra layer of shell quoting when interpolating variables.
       * When we pass "${escapedJson}", it gets wrapped in single quotes,
       * resulting in the keychain storing: '{"claudeAiOauth":{...}}'
       * instead of: {"claudeAiOauth":{...}}
       * 
       * This makes the JSON invalid and Claude Code cannot parse it.
       * 
       * const result = await $`security add-generic-password -U -a $USER -s "Claude Code-credentials" -w "${escapedJson}"`.run({
       *   capture: true,
       *   mirror: false
       * });
       * return result.code === 0;
       */
      
      return true;
    } catch (error) {
      if (isVerbose) {
        log('DEBUG', `Security command failed: ${error.message}`);
      }
      return false;
    }
  } catch (error) {
    if (isVerbose) {
      log('DEBUG', `Failed to set keychain credentials: ${error.message}`);
    }
    return false;
  }
}

/**
 * Validate profile name
 */
function validateProfileName(name) {
  if (!PROFILE_NAME_REGEX.test(name)) {
    throw new Error(`Invalid profile name: ${name}. Only lowercase letters, numbers, and hyphens are allowed.`);
  }
  return true;
}

/**
 * Find or create the gist for storing profiles
 */
async function findOrCreateGist() {
  // Use API to find gist by description
  try {
    const apiResult = await $`gh api /gists --jq '.[] | select(.description == "claude-profiles-backup") | .id' | head -1`.run({ capture: true, mirror: false });
    const gistId = apiResult.stdout.trim();
    if (gistId) {
      return gistId;
    }
  } catch (error) {
    // Check if it's a network/API error
    if (error.message?.includes('404') || error.message?.includes('not found')) {
      // Gist not found, will create new one
    } else if (error.message?.includes('rate limit')) {
      log('ERROR', '⚠️  GitHub API rate limit exceeded');
      log('ERROR', '   Please wait a few minutes and try again');
      log('ERROR', '   Or authenticate with a different account');
      process.exit(1);
    } else if (error.message?.includes('network') || error.message?.includes('timeout')) {
      log('ERROR', '🌐 Network error while accessing GitHub');
      log('ERROR', '   Please check your internet connection and try again');
      process.exit(1);
    }
    // Otherwise, gist just doesn't exist yet
  }
  
  // Create new gist if not found
  log('INFO', `📝 Creating new secret gist for profile storage...`);
  const tempFile = path.join(os.tmpdir(), 'claude-profiles-readme.md');
  const readmeContent = `# Claude Profiles Backup

This gist stores Claude profile backups as zip files (base64 encoded).

Created by claude-profiles.mjs tool.
Do not edit this gist manually.

## Profiles

Each .zip.base64 file contains a backup of:
- ~/.claude/ directory
- ~/.claude.json
- ~/.claude.json.backup
`;
  
  await fsPromises.writeFile(tempFile, readmeContent);
  
  try {
    const createResult = await $`gh gist create ${tempFile} --desc "claude-profiles-backup" 2>&1`.run({ capture: true, mirror: false });
    await fsPromises.unlink(tempFile);
    
    if (createResult.code !== 0) {
      if (createResult.stdout.includes('gist.github.com')) {
        // Sometimes gh returns non-zero but still creates the gist
        const gistUrl = createResult.stdout.match(/https:\/\/gist\.github\.com\/\S+/)?.[0];
        if (gistUrl) {
          const gistId = gistUrl.split('/').pop();
          log('INFO', `✅ Gist created successfully`);
          return gistId;
        }
      }
      
      // Parse error message for common issues
      if (createResult.stdout.includes('permission') || createResult.stdout.includes('scope')) {
        // Get detailed auth status for better error reporting
        const authStatus = await getDetailedAuthStatus();
        
        log('ERROR', '❌ Permission error creating gist');
        log('ERROR', '');
        
        if (authStatus) {
          log('ERROR', '🔍 Current GitHub Authentication:');
          log('ERROR', `   • Account: ${authStatus.account || 'Not logged in'}`);
          log('ERROR', `   • Protocol: ${authStatus.protocol || 'Unknown'}`);
          log('ERROR', `   • Token scopes: ${authStatus.scopes.join(', ') || 'None'}`);
          log('ERROR', `   • Has gist scope: ${authStatus.hasGistScope ? 'Yes' : 'No'}`);
          log('ERROR', '');
        }
        
        log('ERROR', '💡 To fix:');
        log('ERROR', '   • Add gist scope: gh auth refresh -s gist');
        log('ERROR', '   • Or re-login: gh auth login');
        process.exit(1);
      }
      
      throw new Error(createResult.stdout || 'Unknown error creating gist');
    }
    
    // Extract gist ID from the URL
    const gistUrl = createResult.stdout.trim();
    const gistId = gistUrl.split('/').pop();
    log('INFO', `✅ Gist created successfully`);
    return gistId;
  } catch (error) {
    await fsPromises.unlink(tempFile).catch(() => {});
    
    log('ERROR', '❌ Failed to create gist');
    log('ERROR', `   Error: ${error.message}`);
    log('ERROR', '');
    
    // Get detailed auth status for diagnostics
    const authStatus = await getDetailedAuthStatus();
    if (authStatus) {
      log('ERROR', '🔍 Current GitHub Authentication:');
      log('ERROR', `   • Account: ${authStatus.account || 'Not logged in'}`);
      log('ERROR', `   • Token scopes: ${authStatus.scopes.join(', ') || 'None'}`);
      log('ERROR', `   • Has gist scope: ${authStatus.hasGistScope ? 'Yes' : 'No'}`);
      log('ERROR', '');
    }
    
    log('ERROR', '🔧 Troubleshooting:');
    log('ERROR', '   1. Check your internet connection');
    log('ERROR', '   2. Ensure you have gist permissions: gh auth refresh -s gist');
    log('ERROR', '   3. Try creating a test gist manually: echo "test" | gh gist create -');
    process.exit(1);
  }
}

/**
 * List all profiles in the gist
 */
async function listProfiles() {
  try {
    const gistId = await findOrCreateGist();
    
    // Get gist files
    const result = await $`gh gist view ${gistId} --files`.run({ capture: true, mirror: false });
    const allFiles = result.stdout.trim().split('\n');
    const files = allFiles.filter(f => f.endsWith('.zip.base64'));
    
    if (files.length === 0) {
      log('INFO', '📋 No saved profiles found');
      log('INFO', '');
      log('INFO', '💡 To store your first profile, run:');
      log('INFO', '   ./claude-profiles.mjs --store <profile_name>');
      return;
    }
    
    log('INFO', '📋 Saved Claude Profiles:');
    log('INFO', '');
    
    for (const file of files) {
      const profileName = file.replace('.zip.base64', '');
      log('INFO', `  📁 ${profileName}`);
    }
    
    log('INFO', '');
    log('INFO', '💡 Usage:');
    log('INFO', '   ./claude-profiles.mjs --restore <profile_name>   # Restore a profile');
    log('INFO', '   ./claude-profiles.mjs --store <profile_name>     # Store current state');
    log('INFO', '   ./claude-profiles.mjs --delete <profile_name>    # Delete a profile');
  } catch (error) {
    log('ERROR', `❌ Error listing profiles: ${error.message}`);
    log('ERROR', '');
    
    // Get detailed auth status for diagnostics
    const authStatus = await getDetailedAuthStatus();
    if (authStatus && !authStatus.authenticated) {
      log('ERROR', '🔍 GitHub Authentication Issue:');
      log('ERROR', '   • Not authenticated with GitHub');
      log('ERROR', '   • Run: gh auth login');
      log('ERROR', '');
    } else if (authStatus && !authStatus.hasGistScope) {
      log('ERROR', '🔍 GitHub Authentication:');
      log('ERROR', `   • Account: ${authStatus.account}`);
      log('ERROR', `   • Missing gist scope`);
      log('ERROR', '   • Run: gh auth refresh -s gist');
      log('ERROR', '');
    }
    
    log('ERROR', '🔧 Troubleshooting:');
    log('ERROR', '   • Check your internet connection');
    log('ERROR', '   • Try: gh gist list --limit 1');
    process.exit(1);
  }
}

/**
 * Verify local files before creating a profile
 */
async function verifyLocalFiles() {
  // On macOS, credentials can be in Keychain instead of file
  const isMacOS = process.platform === 'darwin';
  
  const checks = [
    {
      path: expandHome('~/.claude/.credentials.json'),
      essential: !isMacOS, // Not essential on macOS (might use Keychain)
      description: 'Claude credentials (file)',
      icon: '🔑',
      skipIfKeychainExists: isMacOS // Skip if we find credentials in Keychain
    },
    {
      path: expandHome('~/.claude.json'),
      essential: true,
      description: 'Claude configuration',
      icon: '⚙️ '
    },
    {
      path: expandHome('~/.claude.json.backup'),
      essential: false,
      description: 'Configuration backup',
      icon: '💾'
    }
  ];
  
  log('INFO', '🔍 Verifying local Claude configuration...');
  log('INFO', '');
  
  let hasAllEssential = true;
  const issues = [];
  
  // Check macOS Keychain first if on macOS
  let hasKeychainCreds = false;
  if (isMacOS) {
    const keychainCreds = await getKeychainCredentials();
    if (keychainCreds) {
      hasKeychainCreds = true;
      log('INFO', '   🔐 Claude Keychain credentials: ✅');
    }
  }
  
  for (const check of checks) {
    // Skip file-based credentials check if we have Keychain credentials
    if (check.skipIfKeychainExists && hasKeychainCreds) {
      continue;
    }
    try {
      const stats = fs.statSync(check.path);
      if (stats.isFile()) {
        log('INFO', `   ${check.icon} ${check.description}: ✅`);
        
        // For credentials, do a basic validation
        if (check.path.includes('.credentials.json')) {
          try {
            const content = fs.readFileSync(check.path, 'utf8');
            const creds = JSON.parse(content);
            // Check for correct OAuth fields as per Claude Code CLI
            if (!creds.access_token && !creds.refresh_token) {
              log('WARN', `      └─ ⚠️  Credentials may be incomplete`);
              issues.push('Credentials file exists but may be incomplete');
            }
          } catch {
            log('WARN', `      └─ ⚠️  Could not parse credentials file`);
            issues.push('Credentials file could not be parsed');
          }
        }
      }
    } catch (error) {
      if (check.essential) {
        log('ERROR', `   ${check.icon} ${check.description}: ❌ Missing (REQUIRED)`);
        hasAllEssential = false;
        issues.push(`Missing required file: ${check.description}`);
      } else {
        log('WARN', `   ${check.icon} ${check.description}: ⚠️  Missing (optional)`);
      }
    }
  }
  
  log('INFO', '');
  
  return { valid: hasAllEssential, issues };
}

/**
 * Verify a profile contains essential files
 */
async function verifyProfile(profileName) {
  try {
    validateProfileName(profileName);
    
    log('INFO', `🔍 Verifying Claude profile: ${profileName}`);
    
    // Get gist ID
    const gistId = await findOrCreateGist();
    
    // Create temporary directory
    const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'claude-verify-'));
    const zipPath = path.join(tempDir, `${profileName}.zip`);
    
    try {
      // Download the profile using API (more reliable for large files)
      log('INFO', `📥 Downloading profile for verification...`);
      
      // First check if file exists
      const filesResult = await $`gh gist view ${gistId} --files`.run({ capture: true, mirror: false });
      if (!filesResult.stdout.includes(`${profileName}.zip.base64`)) {
        throw new Error(`Profile '${profileName}' not found`);
      }
      
      // Use API to get the raw URL
      const apiResult = await $`gh api /gists/${gistId}`.run({ capture: true, mirror: false });
      const gistData = JSON.parse(apiResult.stdout);
      const fileData = gistData.files[`${profileName}.zip.base64`];
      
      if (!fileData) {
        throw new Error(`Profile '${profileName}' not found in gist`);
      }
      
      let base64Data;
      
      if (fileData.truncated) {
        // File is truncated, need to fetch from raw_url
        log('INFO', `   Profile is large (${Math.round(fileData.size / 1024)} KB), downloading from raw URL...`);
        const rawResult = await $`curl -s "${fileData.raw_url}"`.run({ capture: true, mirror: false });
        base64Data = rawResult.stdout.trim();
      } else {
        // Small file, content is in the API response
        base64Data = fileData.content.trim();
      }
      
      // Validate it's base64
      if (!base64Data || base64Data.length === 0) {
        throw new Error('Downloaded profile data is empty');
      }
      
      try {
        const zipBuffer = Buffer.from(base64Data, 'base64');
        await fsPromises.writeFile(zipPath, zipBuffer);
      } catch (err) {
        throw new Error(`Failed to decode profile data: ${err.message}`);
      }
      
      // Extract to verify contents
      log('INFO', `📂 Extracting profile...`);
      const extractDir = path.join(tempDir, 'extract');
      await fsPromises.mkdir(extractDir);
      
      const extractResult = await $`unzip -q -o ${zipPath} -d ${extractDir} 2>&1`.run({ 
        capture: true, 
        mirror: false 
      });
      
      if (extractResult.code !== 0) {
        throw new Error(`Failed to extract profile archive: ${extractResult.stdout || 'Unknown error'}`);
      }
      
      // Check for essential files
      log('INFO', `\n📋 Checking profile contents:`);
      log('INFO', '');
      
      const checks = [
        {
          path: '.claude/.credentials.json',
          essential: true,
          description: 'Claude credentials',
          icon: '🔑'
        },
        {
          path: '.claude.json',
          essential: true,
          description: 'Claude configuration',
          icon: '⚙️'
        },
        {
          path: '.claude.json.backup',
          essential: false,
          description: 'Configuration backup',
          icon: '💾'
        },
        {
          path: '.claude',
          essential: false,
          description: 'Claude directory',
          icon: '📁',
          isDirectory: true
        }
      ];
      
      let hasEssentialFiles = true;
      let totalSize = 0;
      const foundFiles = [];
      
      for (const check of checks) {
        const fullPath = path.join(extractDir, check.path);
        try {
          const stats = await fsPromises.stat(fullPath);
          
          if (check.isDirectory) {
            if (stats.isDirectory()) {
              // Count files in directory
              const files = await fsPromises.readdir(fullPath);
              log('INFO', `   ${check.icon} ${check.description}: ✅ (${files.length} files)`);
              foundFiles.push(check.path);
            } else {
              log('INFO', `   ${check.icon} ${check.description}: ❌ Not a directory`);
            }
          } else {
            if (stats.isFile()) {
              const sizeKB = Math.round(stats.size / 1024);
              totalSize += stats.size;
              log('INFO', `   ${check.icon} ${check.description}: ✅ (${sizeKB} KB)`);
              foundFiles.push(check.path);
              
              // For credentials, do a basic validation
              if (check.path === '.claude/.credentials.json') {
                try {
                  const content = await fsPromises.readFile(fullPath, 'utf8');
                  const creds = JSON.parse(content);
                  if (creds.sessionKey || creds.token) {
                    log('INFO', `      └─ Valid credentials structure detected`);
                  } else {
                    log('INFO', `      └─ ⚠️  Credentials file exists but may be incomplete`);
                  }
                } catch {
                  log('WARN', `      └─ ⚠️  Could not parse credentials file`);
                }
              }
            } else {
              log('INFO', `   ${check.icon} ${check.description}: ❌ Not a file`);
              if (check.essential) {
                hasEssentialFiles = false;
              }
            }
          }
        } catch (error) {
          if (check.essential) {
            log('ERROR', `   ${check.icon} ${check.description}: ❌ Missing (REQUIRED)`);
            hasEssentialFiles = false;
          } else {
            log('WARN', `   ${check.icon} ${check.description}: ⚠️  Missing (optional)`);
          }
        }
      }
      
      // Show summary
      log('INFO', '');
      log('INFO', `📊 Summary:`);
      log('INFO', `   • Profile size: ${Math.round(totalSize / 1024)} KB compressed`);
      log('INFO', `   • Files found: ${foundFiles.length}`);
      log('INFO', `   • Created: Check gist history`);
      
      log('INFO', '');
      if (hasEssentialFiles) {
        log('INFO', `✅ Profile '${profileName}' is valid and ready to restore`);
      } else {
        log('INFO', `❌ Profile '${profileName}' is missing essential files`);
        log('INFO', '   This profile may not restore correctly');
        log('INFO', '   Consider creating a new backup with --store');
      }
      
    } finally {
      // Clean up temp directory
      await fsPromises.rm(tempDir, { recursive: true }).catch(() => {});
    }
    
  } catch (error) {
    log('ERROR', '❌ Error verifying profile:', error.message);
    
    if (error.message.includes('not found')) {
      log('ERROR', '');
      log('ERROR', '📝 Available profiles:');
      try {
        const listResult = await $`gh gist view ${gistId} --files`.run({ capture: true, mirror: false });
        const files = listResult.stdout.trim().split('\n').filter(f => f.endsWith('.zip.base64'));
        if (files.length > 0) {
          files.forEach(f => log('ERROR', `   • ${f.replace('.zip.base64', '')}`));
        } else {
          log('ERROR', '   (no profiles found)');
        }
      } catch {}
    } else if (error.message.includes('unzip')) {
      log('ERROR', '');
      log('ERROR', '📦 The unzip command is required for verification');
      log('ERROR', '   • macOS: Should be pre-installed');
      log('ERROR', '   • Ubuntu/Debian: sudo apt-get install unzip');
      log('ERROR', '   • Alpine: apk add unzip');
    }
    
    process.exit(1);
  }
}

/**
 * Calculate hash of files to detect changes
 */
async function calculateFilesHash() {
  const hash = createHash('sha256');
  
  for (const item of BACKUP_PATHS) {
    const sourcePath = expandHome(item.source);
    
    try {
      const stats = await fsPromises.stat(sourcePath);
      
      if (stats.isDirectory()) {
        // Hash directory structure and file names
        const files = await fsPromises.readdir(sourcePath, { recursive: true });
        hash.update(files.sort().join('|'));
        
        // Hash each file's content
        for (const file of files) {
          const filePath = path.join(sourcePath, file);
          try {
            const fileStats = await fsPromises.stat(filePath);
            if (fileStats.isFile()) {
              const content = await fsPromises.readFile(filePath);
              hash.update(content);
            }
          } catch {
            // Skip files we can't read
          }
        }
      } else if (stats.isFile()) {
        const content = await fsPromises.readFile(sourcePath);
        hash.update(content);
      }
    } catch {
      // File doesn't exist, that's ok
    }
  }
  
  // Include macOS Keychain credentials in hash if on macOS
  if (process.platform === 'darwin') {
    const keychainCreds = await getKeychainCredentials();
    if (keychainCreds) {
      hash.update(JSON.stringify(keychainCreds));
    }
  }
  
  return hash.digest('hex');
}

/**
 * Watch for changes and auto-save profile
 */
async function watchProfile(profileName) {
  try {
    validateProfileName(profileName);
    
    log('INFO', `🔄 Starting watch mode for profile: ${profileName}`);
    log('INFO', '   Monitoring Claude configuration files for changes...');
    log('INFO', '   Press Ctrl+C to stop watching');
    
    // Verify initial state
    const verification = await verifyLocalFiles();
    if (!verification.valid) {
      log('ERROR', '❌ Cannot start watch mode - essential files are missing');
      if (verification.issues.length > 0) {
        verification.issues.forEach(issue => log('ERROR', `   • ${issue}`));
      }
      process.exit(1);
    }
    
    let lastSaveTime = 0;
    let pendingSave = false;
    let lastHash = await calculateFilesHash();
    let saveCount = 0;
    
    log('DEBUG', `Initial files hash: ${lastHash}`);
    
    // Watch configuration
    const minSaveInterval = 30000; // Minimum 30 seconds between saves
    const debounceDelay = 2000; // Wait 2 seconds after last change
    
    let pendingSaveTimeout = null;
    let changeDetected = false;
    const watchers = [];
    
    // Function to handle file changes
    const handleFileChange = (eventType, filename) => {
      log('DEBUG', `File change detected: ${eventType} on ${filename || 'unknown'}`);
      changeDetected = true;
      
      // Clear any pending save timeout
      if (pendingSaveTimeout) {
        clearTimeout(pendingSaveTimeout);
        log('TRACE', 'Cleared pending save timeout due to new change');
      }
      
      // Debounce: wait for changes to settle
      log('TRACE', `Setting debounce timer for ${debounceDelay}ms`);
      pendingSaveTimeout = setTimeout(async () => {
        if (!changeDetected) {
          log('TRACE', 'No changes detected during debounce period');
          return;
        }
        changeDetected = false;
        
        const now = Date.now();
        const timeSinceLastSave = now - lastSaveTime;
        
        if (timeSinceLastSave >= minSaveInterval) {
          // Enough time has passed, save immediately
          log('INFO', '📝 Changes detected, saving profile...');
          
          try {
            // Don't show all the normal save output in watch mode
            const originalLog = console.log;
            const originalError = console.error;
            
            if (!isVerbose) {
              console.log = () => {};
              console.error = () => {};
            }
            
            await saveProfileSilent(profileName);
            
            if (!isVerbose) {
              console.log = originalLog;
              console.error = originalError;
            }
            
            lastSaveTime = now;
            lastHash = await calculateFilesHash();
            saveCount++;
            pendingSave = false;
            
            log('INFO', `✅ Profile auto-saved (save #${saveCount})`);
            log('DEBUG', `Save completed at ${new Date(now).toISOString()}`);
            log('TRACE', `Next save allowed after: ${new Date(now + minSaveInterval).toISOString()}`);
            
          } catch (error) {
            log('ERROR', `❌ Failed to auto-save: ${error.message}`);
          }
        } else if (!pendingSave) {
          // Schedule a save for when enough time has passed
          pendingSave = true;
          const timeToWait = minSaveInterval - timeSinceLastSave;
          log('INFO', `⏳ Changes detected, will save in ${Math.round(timeToWait / 1000)} seconds...`);
          
          pendingSaveTimeout = setTimeout(async () => {
            if (pendingSave) {
              log('INFO', '📝 Saving pending changes...');
              
              try {
                const originalLog = console.log;
                const originalError = console.error;
                
                if (!isVerbose) {
                  console.log = () => {};
                  console.error = () => {};
                }
                
                await saveProfileSilent(profileName);
                
                if (!isVerbose) {
                  console.log = originalLog;
                  console.error = originalError;
                }
                
                lastSaveTime = Date.now();
                lastHash = await calculateFilesHash();
                saveCount++;
                pendingSave = false;
                
                log('INFO', `✅ Profile auto-saved (save #${saveCount})`);
                
              } catch (error) {
                log('ERROR', `❌ Failed to auto-save: ${error.message}`);
                pendingSave = false;
              }
            }
          }, timeToWait);
        }
      }, debounceDelay);
    };
    
    // Set up file watchers for each backup path
    for (const item of BACKUP_PATHS) {
      const watchPath = expandHome(item.source);
      
      try {
        const stats = await fsPromises.stat(watchPath);
        
        // Create watcher with options
        const watcher = fs.watch(watchPath, { 
          recursive: stats.isDirectory(),
          persistent: true
        }, (eventType, filename) => {
          handleFileChange(eventType, `${item.source}/${filename || ''}`);
        });
        
        // Add error handler for watcher
        watcher.on('error', (error) => {
          log('ERROR', `Watcher error for ${item.source}: ${error.message}`);
        });
        
        watchers.push(watcher);
        log('DEBUG', `Watching: ${item.source} (${stats.isDirectory() ? 'directory' : 'file'})`);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          log('WARN', `Could not watch ${item.source}: ${error.message}`);
        }
      }
    }
    
    if (watchers.length === 0) {
      log('ERROR', 'No files to watch!');
      process.exit(1);
    }
    
    log('INFO', `📊 Watching ${watchers.length} paths for changes`);
    
    // Set up periodic check for keychain changes on macOS
    let keychainCheckInterval = null;
    if (process.platform === 'darwin') {
      log('INFO', '🔐 Monitoring macOS Keychain for credential changes');
      
      // Check keychain every 5 seconds for changes
      keychainCheckInterval = setInterval(async () => {
        try {
          const currentHash = await calculateFilesHash();
          if (currentHash !== lastHash) {
            log('DEBUG', 'Keychain credentials changed, triggering save');
            lastHash = currentHash;
            handleFileChange('change', 'macOS Keychain');
          }
        } catch (error) {
          log('ERROR', `Error checking keychain: ${error.message}`);
        }
      }, 5000);
    }
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      log('INFO', '\n👋 Stopping watch mode...');
      
      // Close all watchers
      watchers.forEach(watcher => watcher.close());
      
      // Clear keychain check interval
      if (keychainCheckInterval) {
        clearInterval(keychainCheckInterval);
      }
      
      // Clear any pending timeouts
      if (pendingSaveTimeout) {
        clearTimeout(pendingSaveTimeout);
        log('INFO', 'Cancelled pending save');
      }
      
      log('INFO', `Watch mode ended - Total saves: ${saveCount}`);
      
      if (logFile) {
        console.log(`\n📄 Log saved to: ${logFile}`);
      }
      
      process.exit(0);
    });
    
    // Keep process running
    process.stdin.resume();
    
  } catch (error) {
    log('ERROR', `❌ Error in watch mode: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Save profile without console output (for watch mode)
 */
async function saveProfileSilent(profileName) {
  // This is a simplified version of saveProfile that doesn't output to console
  // It reuses the same logic but skips console.log calls
  
  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'claude-profile-'));
  const zipPath = path.join(tempDir, `${profileName}.zip`);
  
  try {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    const archivePromise = new Promise((resolve, reject) => {
      output.on('close', () => resolve());
      archive.on('error', (err) => reject(err));
    });
    
    archive.pipe(output);
    
    // Add files to archive
    for (const item of BACKUP_PATHS) {
      const sourcePath = expandHome(item.source);
      try {
        const stats = await fsPromises.stat(sourcePath);
        if (stats.isDirectory()) {
          archive.directory(sourcePath, item.dest);
        } else if (stats.isFile()) {
          archive.file(sourcePath, { name: item.dest });
        }
      } catch {
        // Skip missing files
      }
    }
    
    // Handle macOS Keychain credentials (silent version)
    if (process.platform === 'darwin') {
      const keychainCreds = await getKeychainCredentials();
      if (keychainCreds) {
        const credsPath = path.join(tempDir, '.macos.credentials.json');
        await fsPromises.writeFile(credsPath, JSON.stringify(keychainCreds, null, 2));
        archive.file(credsPath, { name: '.macos.credentials.json' });
      }
    }
    
    await archive.finalize();
    await archivePromise;
    
    // Get or create gist
    const gistId = await findOrCreateGist();
    
    // Convert to base64
    const zipBuffer = await fsPromises.readFile(zipPath);
    const base64Content = zipBuffer.toString('base64');
    const base64Path = path.join(tempDir, `${profileName}.zip.base64`);
    await fsPromises.writeFile(base64Path, base64Content);
    
    // Upload to gist
    const uploadResult = await $`gh gist edit ${gistId} --add ${base64Path} --filename "${profileName}.zip.base64" 2>&1`.run({ 
      capture: true, 
      mirror: false 
    });
    
    if (uploadResult.code !== 0 && !uploadResult.stdout.includes('Added')) {
      // Get detailed auth status for better error reporting
      const authStatus = await getDetailedAuthStatus();
      
      if (uploadResult.stdout.includes('409') || uploadResult.stdout.includes('Gist cannot be updated')) {
        log('ERROR', `Failed to upload: HTTP 409 - Gist cannot be updated`);
        
        if (authStatus) {
          log('ERROR', '🔍 GitHub Authentication Status:');
          log('ERROR', `   • Account: ${authStatus.account || 'Not logged in'}`);
          log('ERROR', `   • Protocol: ${authStatus.protocol || 'Unknown'}`);
          log('ERROR', `   • Token scopes: ${authStatus.scopes.join(', ') || 'None'}`);
          log('ERROR', `   • Has gist scope: ${authStatus.hasGistScope ? 'Yes' : 'No'}`);
          
          if (isVerbose && authStatus.rawOutput) {
            log('DEBUG', 'Full gh auth status output:', authStatus.rawOutput);
          }
        }
        
        log('ERROR', '');
        log('ERROR', '💡 Possible causes:');
        log('ERROR', '   • Gist may be owned by a different account');
        log('ERROR', '   • Token may lack write permissions');
        log('ERROR', '   • Try: gh auth refresh -s gist');
        
        throw new Error(`Failed to upload: HTTP 409 - Gist cannot be updated`);
      }
      
      throw new Error(`Failed to upload: ${uploadResult.stdout}`);
    }
    
    log('DEBUG', `Profile uploaded successfully - Size: ${Math.round(zipBuffer.length / 1024)} KB`);
    
  } finally {
    await fsPromises.rm(tempDir, { recursive: true }).catch(() => {});
  }
}

/**
 * Delete a profile from the gist
 */
async function deleteProfile(profileName) {
  try {
    validateProfileName(profileName);
    
    log('INFO', `🗑️  Deleting Claude profile: ${profileName}`);
    
    // Get gist ID
    const gistId = await findOrCreateGist();
    
    // Check if profile exists
    const listResult = await $`gh gist view ${gistId} --files`.run({ capture: true, mirror: false });
    const files = listResult.stdout.trim().split('\n').filter(f => f);
    const profileFile = `${profileName}.zip.base64`;
    
    if (!files.includes(profileFile)) {
      throw new Error(`Profile '${profileName}' not found`);
    }
    
    // We need to use a different approach - gh api to update gist
    
    // Create update payload - set the file to delete as null
    const updatePayload = {
      files: {
        [profileFile]: null  // Setting to null deletes the file
      }
    };
    
    // Update the gist using gh api
    const updateResult = await $`gh api /gists/${gistId} --method PATCH --input -`.run({
      capture: true,
      mirror: false,
      stdin: JSON.stringify(updatePayload)
    });
    
    if (updateResult.code === 0) {
      log('INFO', `✅ Profile '${profileName}' deleted successfully`);
    } else {
      throw new Error('Failed to delete profile from gist');
    }
    
  } catch (error) {
    log('ERROR', '❌ Error deleting profile:', error.message);
    
    if (error.message.includes('not found')) {
      log('ERROR', '');
      log('ERROR', '📝 Profile does not exist. Available profiles:');
      try {
        await listProfiles();
      } catch {}
    } else {
      log('ERROR', '');
      
      // Get detailed auth status for diagnostics
      const authStatus = await getDetailedAuthStatus();
      if (authStatus) {
        log('ERROR', '🔍 Current GitHub Authentication:');
        log('ERROR', `   • Account: ${authStatus.account || 'Not logged in'}`);
        log('ERROR', `   • Has gist scope: ${authStatus.hasGistScope ? 'Yes' : 'No'}`);
        log('ERROR', '');
      }
      
      log('ERROR', '🔧 Troubleshooting:');
      log('ERROR', '   • Check your internet connection');
      log('ERROR', '   • Verify the profile exists: ./claude-profiles.mjs --list');
      log('ERROR', '   • Ensure you have write permissions to the gist');
      log('ERROR', '   • Try: gh auth refresh -s gist');
    }
    process.exit(1);
  }
}

/**
 * Save current Claude configuration to a profile
 */
async function saveProfile(profileName) {
  try {
    validateProfileName(profileName);
    
    log('INFO', `💾 Preparing to save Claude profile: ${profileName}`);
    log('INFO', '');
    
    // Verify local files before creating backup
    const verification = await verifyLocalFiles();
    
    if (!verification.valid) {
      log('ERROR', '❌ Cannot create profile - essential files are missing');
      log('ERROR', '');
      if (verification.issues.length > 0) {
        log('ERROR', 'Issues found:');
        verification.issues.forEach(issue => log('ERROR', `   • ${issue}`));
        log('ERROR', '');
      }
      log('ERROR', '💡 Tips:');
      log('ERROR', '   • Ensure Claude is properly configured');
      log('ERROR', '   • Try using Claude at least once to generate config files');
      log('ERROR', '   • Check that ~/.claude/ directory exists');
      process.exit(1);
    }
    
    log('INFO', '✅ Local configuration verified');
    log('INFO', '');
    
    // Create temporary directory for staging
    const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'claude-profile-'));
    const zipPath = path.join(tempDir, `${profileName}.zip`);
    
    // Create zip archive
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    // Create a promise to track when archiving is complete
    const archivePromise = new Promise((resolve, reject) => {
      output.on('close', () => {
        resolve();
      });
      
      archive.on('error', (err) => {
        reject(err);
      });
    });
    
    archive.pipe(output);
    
    // Add files to archive
    let hasFiles = false;
    for (const item of BACKUP_PATHS) {
      const sourcePath = expandHome(item.source);
      
      try {
        const stats = await fsPromises.stat(sourcePath);
        
        if (stats.isDirectory()) {
          archive.directory(sourcePath, item.dest);
          log('INFO', `📂 Added directory: ${item.source}`);
          hasFiles = true;
        } else if (stats.isFile()) {
          archive.file(sourcePath, { name: item.dest });
          log('INFO', `📄 Added file: ${item.source}`);
          hasFiles = true;
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          log('WARN', `⚠️  Could not add ${item.source}: ${error.message}`);
        }
      }
    }
    
    // Handle macOS Keychain credentials
    if (process.platform === 'darwin') {
      const keychainCreds = await getKeychainCredentials();
      if (keychainCreds) {
        // Save credentials to a temporary file and add to archive
        const credsPath = path.join(tempDir, '.macos.credentials.json');
        await fsPromises.writeFile(credsPath, JSON.stringify(keychainCreds, null, 2));
        archive.file(credsPath, { name: '.macos.credentials.json' });
        log('INFO', `🔐 Added macOS Keychain credentials`);
        hasFiles = true;
      } else {
        log('WARN', 'No credentials found in macOS Keychain');
      }
    }
    
    if (!hasFiles) {
      log('ERROR', '❌ No Claude configuration files found to backup');
      log('ERROR', '');
      log('ERROR', '📝 Expected files:');
      log('ERROR', '   • ~/.claude/ directory');
      log('ERROR', '   • ~/.claude.json file');
      log('ERROR', '   • ~/.claude.json.backup file');
      log('ERROR', '');
      log('ERROR', '🔧 This usually means Claude is not configured yet');
      log('ERROR', '   Please use Claude at least once to generate config files');
      await fsPromises.rm(tempDir, { recursive: true });
      process.exit(1);
    }
    
    await archive.finalize();
    
    // Wait for the archive to be written to disk
    await archivePromise;
    
    const archiveStats = await fsPromises.stat(zipPath);
    log('INFO', `📦 Archive created: ${Math.round(archiveStats.size / 1024)} KB`);
    
    // Get or create gist
    const gistId = await findOrCreateGist();
    
    // Convert zip to base64 for gist storage
    const zipBuffer = await fsPromises.readFile(zipPath);
    const base64Content = zipBuffer.toString('base64');
    
    // Save base64 as text file
    const base64Path = path.join(tempDir, `${profileName}.zip.base64`);
    await fsPromises.writeFile(base64Path, base64Content);
    
    // Upload base64 file to gist
    log('INFO', `📤 Uploading profile to gist...`);
    const uploadResult = await $`gh gist edit ${gistId} --add ${base64Path} --filename "${profileName}.zip.base64" 2>&1`.run({ 
      capture: true, 
      mirror: false 
    });
    
    if (uploadResult.code !== 0 && !uploadResult.stdout.includes('Added')) {
      // Check for common issues
      if (uploadResult.stdout.includes('too large')) {
        log('ERROR', '❌ Profile is too large for GitHub Gist (>10MB)');
        log('ERROR', '   Consider cleaning up ~/.claude/ directory');
        throw new Error('Profile too large');
      } else if (uploadResult.stdout.includes('rate limit')) {
        log('ERROR', '⚠️  GitHub API rate limit exceeded');
        log('ERROR', '   Please wait a few minutes and try again');
        throw new Error('Rate limit exceeded');
      } else if (uploadResult.stdout.includes('409') || uploadResult.stdout.includes('Gist cannot be updated')) {
        // Get detailed auth status for better error reporting
        const authStatus = await getDetailedAuthStatus();
        
        log('ERROR', '❌ Failed to upload: HTTP 409 - Gist cannot be updated');
        log('ERROR', '');
        
        if (authStatus) {
          log('ERROR', '🔍 Current GitHub Authentication:');
          log('ERROR', `   • Account: ${authStatus.account || 'Not logged in'}`);
          log('ERROR', `   • Protocol: ${authStatus.protocol || 'Unknown'}`);
          log('ERROR', `   • Token scopes: ${authStatus.scopes.join(', ') || 'None'}`);
          log('ERROR', `   • Has gist scope: ${authStatus.hasGistScope ? 'Yes' : 'No'}`);
          log('ERROR', '');
        }
        
        log('ERROR', '💡 How to fix:');
        log('ERROR', '   • Gist may be owned by a different account');
        log('ERROR', '   • Check gist owner: gh gist view ' + gistId);
        log('ERROR', '   • Re-authenticate: gh auth refresh -s gist');
        log('ERROR', '   • Or login as the gist owner: gh auth login');
        
        throw new Error('HTTP 409: Gist cannot be updated');
      }
      
      throw new Error(`Failed to upload profile to gist: ${uploadResult.stdout}`);
    }
    
    // Clean up temp directory
    await fsPromises.rm(tempDir, { recursive: true });
    
    log('INFO', `✅ Profile '${profileName}' saved successfully`);
    log('INFO', '');
    log('INFO', '💡 To restore this profile later, run:');
    log('INFO', `   ./claude-profiles.mjs --restore ${profileName}`);
  } catch (error) {
    log('ERROR', '❌ Error saving profile:', error.message);
    log('ERROR', '');
    
    if (error.message.includes('Profile too large') || error.message.includes('Rate limit') || error.message.includes('HTTP 409')) {
      // Specific error messages already shown with detailed diagnostics
    } else {
      // Get detailed auth status for diagnostics
      const authStatus = await getDetailedAuthStatus();
      if (authStatus && !authStatus.hasGistScope) {
        log('ERROR', '🔍 Missing gist permissions:');
        log('ERROR', `   • Account: ${authStatus.account || 'Unknown'}`);
        log('ERROR', '   • Run: gh auth refresh -s gist');
        log('ERROR', '');
      }
      
      log('ERROR', '🔧 Troubleshooting:');
      log('ERROR', '   • Check your internet connection');
      log('ERROR', '   • Try creating a test gist: echo "test" | gh gist create -');
      log('ERROR', '   • Check available profiles: ./claude-profiles.mjs --list');
    }
    process.exit(1);
  }
}

/**
 * Verify a downloaded profile before restoring
 */
async function verifyDownloadedProfile(profileName, tempDir) {
  const extractDir = path.join(tempDir, 'verify');
  const zipPath = path.join(tempDir, `${profileName}.zip`);
  
  try {
    await fsPromises.mkdir(extractDir);
    
    // Extract for verification
    const extractResult = await $`unzip -q -o ${zipPath} -d ${extractDir} 2>&1`.run({ 
      capture: true, 
      mirror: false 
    });
    
    if (extractResult.code !== 0) {
      return { valid: false, issues: ['Failed to extract profile archive'] };
    }
    
    // Check essential files
    const checks = [
      {
        path: path.join(extractDir, '.claude/.credentials.json'),
        essential: process.platform !== 'darwin', // Not essential on macOS (uses Keychain)
        description: 'Claude credentials (file)'
      },
      {
        path: path.join(extractDir, '.macos.credentials.json'),
        essential: process.platform === 'darwin', // Essential on macOS
        description: 'Claude credentials (macOS)'
      },
      {
        path: path.join(extractDir, '.claude.json'),
        essential: true,
        description: 'Claude configuration'
      }
    ];
    
    let valid = true;
    const issues = [];
    
    for (const check of checks) {
      try {
        const stats = await fsPromises.stat(check.path);
        if (!stats.isFile() && check.essential) {
          valid = false;
          issues.push(`Missing: ${check.description}`);
        }
      } catch {
        if (check.essential) {
          valid = false;
          issues.push(`Missing: ${check.description}`);
        }
      }
    }
    
    // Clean up verification directory
    await fsPromises.rm(extractDir, { recursive: true }).catch(() => {});
    
    return { valid, issues };
  } catch (error) {
    return { valid: false, issues: [error.message] };
  }
}

/**
 * Restore a profile from the gist
 */
async function restoreProfile(profileName) {
  try {
    validateProfileName(profileName);
    
    log('INFO', `📦 Preparing to restore Claude profile: ${profileName}`);
    log('INFO', '');
    
    // Get gist ID
    const gistId = await findOrCreateGist();
    
    // Create temporary directory
    const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'claude-restore-'));
    const zipPath = path.join(tempDir, `${profileName}.zip`);
    
    // Download the profile using API (same as verify function)
    log('INFO', `📥 Downloading profile from gist...`);
    
    // First check if file exists
    const filesResult = await $`gh gist view ${gistId} --files`.run({ capture: true, mirror: false });
    if (!filesResult.stdout.includes(`${profileName}.zip.base64`)) {
      log('ERROR', `❌ Profile '${profileName}' not found`);
      log('ERROR', '');
      log('ERROR', '📝 Available profiles:');
      const files = filesResult.stdout.trim().split('\n').filter(f => f.endsWith('.zip.base64'));
      if (files.length > 0) {
        files.forEach(f => log('ERROR', `   • ${f.replace('.zip.base64', '')}`));
      } else {
        log('ERROR', '   (no profiles found)');
      }
      throw new Error('Profile not found');
    }
    
    // Use API to get the file content or raw URL
    const apiResult = await $`gh api /gists/${gistId}`.run({ capture: true, mirror: false });
    const gistData = JSON.parse(apiResult.stdout);
    const fileData = gistData.files[`${profileName}.zip.base64`];
    
    if (!fileData) {
      throw new Error(`Profile '${profileName}' not found in gist`);
    }
    
    let base64Data;
    
    if (fileData.truncated) {
      // File is truncated, need to fetch from raw_url
      log('INFO', `   Profile is large (${Math.round(fileData.size / 1024)} KB), downloading from raw URL...`);
      const rawResult = await $`curl -s "${fileData.raw_url}"`.run({ capture: true, mirror: false });
      base64Data = rawResult.stdout.trim();
    } else {
      // Small file, content is in the API response
      base64Data = fileData.content.trim();
    }
    
    if (!base64Data || base64Data.length === 0) {
      throw new Error('Downloaded profile data is empty');
    }
    
    // Decode base64 and write to zip file
    const zipBuffer = Buffer.from(base64Data, 'base64');
    await fsPromises.writeFile(zipPath, zipBuffer);
    
    // Verify the profile before restoring
    log('INFO', `🔍 Verifying profile integrity...`);
    const verification = await verifyDownloadedProfile(profileName, tempDir);
    
    if (!verification.valid) {
      log('ERROR', '');
      log('ERROR', '❌ Cannot restore profile - verification failed');
      if (verification.issues.length > 0) {
        log('ERROR', '');
        log('ERROR', 'Issues found:');
        verification.issues.forEach(issue => log('ERROR', `   • ${issue}`));
      }
      log('ERROR', '');
      log('ERROR', '💡 This profile appears to be corrupted or incomplete');
      log('ERROR', '   Consider creating a new backup with --store');
      throw new Error('Profile verification failed');
    }
    
    log('INFO', '✅ Profile verified successfully');
    log('INFO', '');
    
    // Extract zip archive for restoration
    log('INFO', `📂 Extracting profile...`);
    const extractDir = path.join(tempDir, 'extract');
    await fsPromises.mkdir(extractDir);
    
    // Use unzip command to extract
    await $`unzip -q -o ${zipPath} -d ${extractDir}`.run({ mirror: false });
    
    // Restore files from extracted directory
    for (const item of BACKUP_PATHS) {
      const sourcePath = path.join(extractDir, item.dest);
      const destPath = expandHome(item.source);
      
      try {
        const stats = await fsPromises.stat(sourcePath);
        
        if (stats.isDirectory()) {
          // Ensure parent directory exists
          await fsPromises.mkdir(path.dirname(destPath), { recursive: true });
          // Copy directory recursively
          await $`cp -r ${sourcePath} ${destPath}`.run({ mirror: false });
          log('INFO', `📂 Restored directory: ${item.source}`);
        } else if (stats.isFile()) {
          // Ensure parent directory exists
          await fsPromises.mkdir(path.dirname(destPath), { recursive: true });
          // Copy file
          await fsPromises.copyFile(sourcePath, destPath);
          log('INFO', `📄 Restored file: ${item.source}`);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          log('WARN', `⚠️  Could not restore ${item.source}: ${error.message}`);
        }
      }
    }
    
    // Handle macOS Keychain credentials restoration
    if (process.platform === 'darwin') {
      const macosCredsPath = path.join(extractDir, '.macos.credentials.json');
      try {
        const macosCredsData = await fsPromises.readFile(macosCredsPath, 'utf8');
        const macosCreds = JSON.parse(macosCredsData);
        
        if (await setKeychainCredentials(macosCreds)) {
          log('INFO', '🔐 Restored macOS Keychain credentials');
        } else {
          log('WARN', '⚠️  Could not restore macOS Keychain credentials');
          if (isVerbose) {
            log('DEBUG', 'Credential data: ' + JSON.stringify(macosCreds, null, 2).substring(0, 200) + '...');
          }
        }
      } catch (error) {
        log('WARN', `⚠️  Failed to restore macOS credentials: ${error.message}`);
        if (isVerbose && error.code !== 'ENOENT') {
          log('DEBUG', `Error details: ${error.stack || error}`);
        }
      }
    }
    
    // Verify credentials were restored (for non-macOS or fallback)
    const credFile = expandHome('~/.claude/.credentials.json');
    try {
      await fsPromises.stat(credFile);
      log('INFO', '🔑 Credentials file restored');
    } catch {
      if (process.platform !== 'darwin') {
        log('WARN', '⚠️  No credentials file found in profile');
      }
    }
    
    // Clean up temp directory
    await fsPromises.rm(tempDir, { recursive: true });
    
    log('INFO', `✅ Profile '${profileName}' restored successfully`);
    log('INFO', '');
    log('INFO', '💡 To save current state as a profile, run:');
    log('INFO', '   ./claude-profiles.mjs --save <profile_name>');
  } catch (error) {
    if (!error.message.includes('Profile not found')) {
      log('ERROR', '❌ Error restoring profile:', error.message);
    }
    
    if (error.message.includes('unzip')) {
      log('ERROR', '');
      log('ERROR', '📦 The unzip command is required but not installed');
      log('ERROR', '   • macOS: Should be pre-installed');
      log('ERROR', '   • Ubuntu/Debian: sudo apt-get install unzip');
      log('ERROR', '   • Alpine: apk add unzip');
    } else if (!error.message.includes('Profile not found')) {
      log('ERROR', '');
      log('ERROR', '🔧 Troubleshooting:');
      log('ERROR', '   • Check your internet connection');
      log('ERROR', '   • Verify the profile exists: ./claude-profiles.mjs --list');
      log('ERROR', '   • Ensure you have read permissions for the gist');
      log('ERROR', '   • Check disk space for extracting the profile');
    }
    process.exit(1);
  }
}

// Main CLI setup
const argv = yargs(hideBin(process.argv))
  .usage('Usage: $0 [options]')
  .option('list', {
    alias: 'l',
    type: 'boolean',
    description: 'List all saved profiles'
  })
  .option('store', {
    alias: ['s', 'save'],
    type: 'string',
    description: 'Store current Claude configuration to a profile'
  })
  .option('restore', {
    alias: 'r',
    type: 'string',
    description: 'Restore a saved profile'
  })
  .option('delete', {
    alias: 'd',
    type: 'string',
    description: 'Delete a saved profile'
  })
  .option('verify', {
    alias: 'v',
    type: 'string',
    description: 'Verify a profile contains essential files'
  })
  .option('watch', {
    alias: 'w',
    type: 'string',
    description: 'Watch for changes and auto-save to profile (30s throttle)'
  })
  .option('verbose', {
    type: 'boolean',
    description: 'Enable verbose logging for debugging',
    default: false
  })
  .option('log', {
    type: 'string',
    description: 'Log output to file (provide path or use default)',
    coerce: (arg) => {
      // If --log is provided without value, return empty string to trigger default
      return arg === true ? '' : arg;
    }
  })
  .help('help')
  .alias('help', 'h')
  .example('$0 --list', 'List all saved profiles')
  .example('$0 --store work', 'Store current config as "work" profile')
  .example('$0 --save work', 'Same as --store (alias)')
  .example('$0 --restore personal', 'Restore "personal" profile')
  .example('$0 --delete old-profile', 'Delete "old-profile"')
  .example('$0 --verify work', 'Verify "work" profile integrity')
  .example('$0 --watch work', 'Watch for changes and auto-save')
  .example('$0 --watch work --verbose --log', 'Watch with debugging and logging')
  .epilogue('Profile names must contain only lowercase letters, numbers, and hyphens')
  .check((argv) => {
    const mainOptions = [argv.list, argv.store, argv.restore, argv.delete, argv.verify, argv.watch].filter(Boolean);
    if (mainOptions.length === 0) {
      throw new Error('Please specify one of: --list, --store, --restore, --delete, --verify, or --watch');
    }
    if (mainOptions.length > 1) {
      throw new Error('Please specify only one main option at a time');
    }
    return true;
  })
  .argv;

/**
 * Check GitHub authentication status with friendly messaging
 */
async function checkGitHubAuth() {
  try {
    const authResult = await $`gh auth status 2>&1`.run({ capture: true, mirror: false });
    
    if (authResult.code === 0) {
      // Parse the output to check for gist scope
      const output = authResult.stdout;
      const scopesMatch = output.match(/Token scopes:\s*'([^']+)'/);
      
      // Check if gist scope is present
      if (scopesMatch && !scopesMatch[1].includes('gist')) {
        log('INFO', '⚠️  Warning: Your GitHub token does not have "gist" scope');
        log('INFO', '   You may need to re-authenticate with: gh auth login -s gist');
        log('INFO', '');
      }
      
      return true;
    } else {
      return false;
    }
  } catch (error) {
    // gh command might not be installed
    if (error.message?.includes('not found') || error.message?.includes('command not found')) {
      log('ERROR', '❌ GitHub CLI (gh) is not installed');
      log('ERROR', '');
      log('ERROR', '📦 To install GitHub CLI:');
      log('ERROR', '   • macOS: brew install gh');
      log('ERROR', '   • Linux: See https://github.com/cli/cli#installation');
      log('ERROR', '   • Windows: winget install --id GitHub.cli');
      process.exit(1);
    }
    return false;
  }
}

/**
 * Get detailed GitHub auth status for error diagnostics
 */
async function getDetailedAuthStatus() {
  try {
    const authResult = await $`gh auth status 2>&1`.run({ capture: true, mirror: false });
    const output = authResult.stdout;
    
    // Parse auth status details
    const details = {
      authenticated: authResult.code === 0,
      loggedInAs: null,
      account: null,
      protocol: null,
      token: null,
      scopes: [],
      hasGistScope: false,
      rawOutput: output // Include raw output for debugging
    };
    
    // Parse logged in account - updated pattern for new format
    const accountMatch = output.match(/Logged in to github\.com account (\S+)|Logged in to [\w\.]+ as (\S+)/);
    if (accountMatch) {
      details.account = accountMatch[1] || accountMatch[2];
    }
    
    // Parse git operations protocol
    const protocolMatch = output.match(/Git operations protocol:\s*(\w+)/);
    if (protocolMatch) {
      details.protocol = protocolMatch[1];
    }
    
    // Parse token (masked)
    const tokenMatch = output.match(/Token:\s*(\S+)/);
    if (tokenMatch) {
      details.token = tokenMatch[1];
    }
    
    // Parse token scopes - capture the entire line after "Token scopes:"
    const scopesMatch = output.match(/Token scopes:\s*(.+)/);
    if (scopesMatch) {
      const scopesLine = scopesMatch[1];
      // Extract all quoted strings (e.g., 'gist', 'read:org', 'repo')
      const quotedScopes = scopesLine.match(/'([^']+)'/g);
      if (quotedScopes) {
        // Remove quotes from each scope
        details.scopes = quotedScopes.map(s => s.replace(/'/g, ''));
      } else {
        // Fallback: split by comma if no quotes found
        details.scopes = scopesLine.split(',').map(s => s.trim());
      }
      details.hasGistScope = details.scopes.includes('gist');
    }
    
    // Check if completely logged out
    if (output.includes('You are not logged into any GitHub hosts')) {
      details.authenticated = false;
      details.account = null;
    }
    
    return details;
  } catch (error) {
    return null;
  }
}

// Execute the requested action
(async () => {
  try {
    // Initialize logging if needed
    initLogging({
      verbose: argv.verbose,
      log: argv.log
    });
    
    // Check if gh is authenticated
    const isAuthenticated = await checkGitHubAuth();
    
    if (!isAuthenticated) {
      log('ERROR', '🔐 GitHub CLI is not authenticated');
      log('ERROR', '');
      log('ERROR', '📝 To authenticate with GitHub:');
      log('ERROR', '   1. Run: gh auth login');
      log('ERROR', '   2. Follow the prompts to authenticate');
      log('ERROR', '   3. Make sure to grant "gist" scope when asked');
      log('ERROR', '');
      log('ERROR', '💡 Tips:');
      log('ERROR', '   • Use SSH if you have SSH keys set up');
      log('ERROR', '   • Use HTTPS with a token for simpler setup');
      log('ERROR', '   • You can also use: gh auth login -s gist');
      process.exit(1);
    }
    
    if (argv.list) {
      await listProfiles();
    } else if (argv.store) {
      await saveProfile(argv.store);
    } else if (argv.restore) {
      await restoreProfile(argv.restore);
    } else if (argv.delete) {
      await deleteProfile(argv.delete);
    } else if (argv.verify) {
      await verifyProfile(argv.verify);
    } else if (argv.watch) {
      await watchProfile(argv.watch);
    }
  } catch (error) {
    log('ERROR', '❌ Unexpected error:', error.message);
    
    // Provide helpful context for common errors
    if (error.code === 'EACCES') {
      log('ERROR', '');
      log('ERROR', '📝 Permission denied. This could mean:');
      log('ERROR', '   • You need sudo access (not recommended)');
      log('ERROR', '   • File permissions are incorrect');
      log('ERROR', '   • Try: ls -la ~/.claude/');
    } else if (error.code === 'ENOENT') {
      log('ERROR', '');
      log('ERROR', '📝 File or directory not found');
      log('ERROR', '   This usually means Claude configuration doesn\'t exist yet');
    } else if (error.code === 'ENOSPC') {
      log('ERROR', '');
      log('ERROR', '💾 No space left on device');
      log('ERROR', '   Please free up some disk space and try again');
    } else if (error.message?.includes('network')) {
      log('ERROR', '');
      log('ERROR', '🌐 Network issue detected');
      log('ERROR', '   • Check your internet connection');
      log('ERROR', '   • Check if GitHub is accessible');
      log('ERROR', '   • Try: ping github.com');
    }
    
    log('ERROR', '');
    log('ERROR', 'For more help, check the tool documentation or report an issue');
    process.exit(1);
  }
})();
