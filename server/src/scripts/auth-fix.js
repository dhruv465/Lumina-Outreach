/**
 * Utility script to check and update authentication middleware usage
 * 
 * This script:
 * 1. Identifies all files importing from middleware/auth.ts
 * 2. Updates them to use the new unified authMiddleware.ts
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const readdir = promisify(fs.readdir);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

// Search for files recursively
async function findFiles(dir, pattern) {
  const files = await readdir(dir, { withFileTypes: true });
  
  let results = [];
  
  for (const file of files) {
    const fullPath = path.join(dir, file.name);
    
    if (file.isDirectory() && !file.name.startsWith('node_modules') && !file.name.startsWith('.')) {
      results = results.concat(await findFiles(fullPath, pattern));
    } else if (file.isFile() && (file.name.endsWith('.ts') || file.name.endsWith('.js'))) {
      // Check if file contains the pattern
      const content = await readFile(fullPath, 'utf8');
      if (pattern.test(content)) {
        results.push({ 
          path: fullPath, 
          content 
        });
      }
    }
  }
  
  return results;
}

// Update auth imports in files
async function updateAuthImports() {
  try {
    console.log('Checking for files with old auth middleware imports...');
    
    // Search pattern for the old middleware
    const oldAuthPattern = /from\s+['"]\.\.\/(\.\.\/)*middleware\/auth['"]/;
    
    // Start from the src directory
    const srcDir = path.resolve(__dirname, '..');
    const filesWithOldAuth = await findFiles(srcDir, oldAuthPattern);
    
    console.log(`Found ${filesWithOldAuth.length} files with old auth middleware imports.`);
    
    // Update each file
    for (const file of filesWithOldAuth) {
      console.log(`Updating file: ${file.path}`);
      
      // Replace the import
      const updatedContent = file.content.replace(
        /from\s+['"](\.\.\/)*middleware\/auth['"]/g, 
        'from \'$1middleware/authMiddleware\''
      );
      
      // Write the updated content
      await writeFile(file.path, updatedContent, 'utf8');
    }
    
    console.log('Auth middleware imports have been updated successfully.');
  } catch (error) {
    console.error('Error updating auth middleware imports:', error);
  }
}

// Check for inconsistencies in auth usage
async function checkAuthUsageInconsistencies() {
  try {
    console.log('Checking for auth usage inconsistencies...');
    
    // Search patterns for user property access
    const userIdPattern = /req\.user\.userId/g;
    const userIdPattern2 = /req\.user\._id/g;
    const userRolePattern = /req\.user\.role/g;
    
    // Start from the src directory
    const srcDir = path.resolve(__dirname, '..');
    const files1 = await findFiles(srcDir, userIdPattern);
    const files2 = await findFiles(srcDir, userIdPattern2);
    const files3 = await findFiles(srcDir, userRolePattern);
    
    console.log(`Found ${files1.length} files using req.user.userId`);
    console.log(`Found ${files2.length} files using req.user._id`);
    console.log(`Found ${files3.length} files using req.user.role`);
    
    // List files that use both patterns (potentially inconsistent)
    const allFiles = [...files1, ...files2].map(file => file.path);
    const uniqueFiles = [...new Set(allFiles)];
    
    // Check if any files use both patterns
    for (const filePath of uniqueFiles) {
      const content = await readFile(filePath, 'utf8');
      const hasUserId = content.includes('req.user.userId');
      const hasId = content.includes('req.user._id');
      
      if (hasUserId && hasId) {
        console.log(`Inconsistency detected in: ${filePath}`);
        console.log(`  Uses both req.user.userId and req.user._id`);
      }
    }
  } catch (error) {
    console.error('Error checking auth usage inconsistencies:', error);
  }
}

// Run the functions
async function main() {
  // Check for inconsistencies first
  await checkAuthUsageInconsistencies();
  
  // Ask if user wants to update imports
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  readline.question('Do you want to update auth middleware imports? (y/n): ', async (answer) => {
    if (answer.toLowerCase() === 'y') {
      await updateAuthImports();
    }
    readline.close();
  });
}

main();
