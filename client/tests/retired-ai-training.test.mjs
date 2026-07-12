import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('MVP does not expose the deferred AI Training route', () => {
  const app = read('src/App.tsx');
  const sidebar = read('src/components/layout/Sidebar.tsx');

  assert.doesNotMatch(app, /AITraining|ai-training/);
  assert.doesNotMatch(sidebar, /AI Training|ai-training/);
});

test('MVP removes the dead AI Training page and feedback client', () => {
  assert.equal(fs.existsSync(path.join(root, 'src/pages/AITraining.tsx')), false);
  assert.equal(fs.existsSync(path.join(root, 'src/services/feedbackApi.ts')), false);
});
