import * as fs from 'fs';
import * as path from 'path';

describe('Code Changes Validation', () => {
  const twilioServerPath = path.join(__dirname, '../twilioWebSocketServer.ts');
  const streamControllerPath = path.join(__dirname, '../../controllers/streamController.ts');

  test('TwilioWebSocketServer should have OUTBOUND_AUDIO_CHUNK_SIZE constant', () => {
    const content = fs.readFileSync(twilioServerPath, 'utf8');
    expect(content).toContain('OUTBOUND_AUDIO_CHUNK_SIZE = 32 * 1024');
  });

  test('TwilioWebSocketServer should have sendMediaChunks method', () => {
    const content = fs.readFileSync(twilioServerPath, 'utf8');
    expect(content).toContain('private sendMediaChunks(ws: WebSocket, streamSid: string, audioData: Buffer)');
  });

  test('TwilioWebSocketServer should not send JSON keepAlive messages', () => {
    const content = fs.readFileSync(twilioServerPath, 'utf8');
    expect(content).not.toContain('event: "keepAlive"');
    expect(content).toContain('ws.ping()');
  });

  test('TwilioWebSocketServer should not use fabricated streamSid', () => {
    const content = fs.readFileSync(twilioServerPath, 'utf8');
    expect(content).not.toContain('MZ${callId.substring(0, 32)}');
  });

  test('StreamController should use utteranceCompleted for opening message', () => {
    const content = fs.readFileSync(streamControllerPath, 'utf8');
    expect(content).toContain("type: 'utteranceCompleted'");
    expect(content).toContain("scope: 'opening'");
  });

  test('sendAudioResponse should use real streamSid and chunking', () => {
    const content = fs.readFileSync(twilioServerPath, 'utf8');
    const sendAudioResponseMatch = content.match(/public sendAudioResponse[\s\S]*?^  }/m);
    expect(sendAudioResponseMatch).toBeTruthy();
    
    const method = sendAudioResponseMatch![0];
    expect(method).toContain('this.sendMediaChunks(ws, streamSid, audioBuffer)');
    expect(method).toContain('const streamSid = (ws as any).streamSid');
    expect(method).not.toContain('MZ${callId');
  });
});