#!/usr/bin/env node

/**
 * Script to update auth middleware imports in route files
 */

const fs = require('fs');
const path = require('path');

// List of route files to update
const routeFiles = [
  'analyticsRoutes.ts',
  'configurationRoutes.ts',
  'userRoutes.ts',
  'callRoutes.ts',
  'campaignRoutes.ts',
  'transcriptionRoutes.ts',
  'leadRoutes.ts',
  'metricsRoutes.ts',
  'streamRoutes.ts',
  'telephonyRoutes.ts',
  'voiceAIRoutes.ts',
  'dashboardRoutes.ts',
  'debugRoutes.ts'
];

// Update each file
routeFiles.forEach(file => {
  const filePath = path.join(__dirname, '..', 'routes', file);
  
  try {
    // Read file content
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Replace import statement
    content = content.replace(
      "import { authenticate } from '../middleware/auth';",
      "import { authenticate } from '../middleware/auth';"
    );
    
    // Write updated content back to file
    fs.writeFileSync(filePath, content, 'utf8');
    
    console.log(`✅ Updated ${file}`);
  } catch (error) {
    console.error(`❌ Error updating ${file}:`, error.message);
  }
});

console.log('Auth middleware imports update complete!');