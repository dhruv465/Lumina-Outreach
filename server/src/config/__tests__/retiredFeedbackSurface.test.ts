import fs from 'fs';
import path from 'path';

const srcRoot = path.resolve(__dirname, '../..');
const read = (relativePath: string) => fs.readFileSync(path.join(srcRoot, relativePath), 'utf8');

describe('retired Dialogflow feedback surface', () => {
  it('does not register the legacy feedback API', () => {
    const indexSource = read('index.ts');
    expect(indexSource).not.toContain('callFeedbackRoutes');
    expect(indexSource).not.toContain('prefix: "/feedback"');
  });

  it('does not retain the unreachable training-data collector', () => {
    const serviceSource = read('services/aiService.ts');
    expect(serviceSource).not.toContain("models/CallFeedback");
    expect(serviceSource).not.toContain('collectTrainingData');
  });

  it.each([
    'routes/callFeedbackRoutes.ts',
    'controllers/callFeedbackController.ts',
    'models/CallFeedback.ts',
  ])('removes %s from the runtime codebase', (relativePath) => {
    expect(fs.existsSync(path.join(srcRoot, relativePath))).toBe(false);
  });
});
