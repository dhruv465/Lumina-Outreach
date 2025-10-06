// server/test-deepgram-ws.js
const WebSocket = require('ws');

const key = process.env.DEEPGRAM_API_KEY;
if (!key) {
  console.error('Please set DEEPGRAM_API_KEY in env and re-run: export DEEPGRAM_API_KEY=...');
  process.exit(1);
}

const url = 'wss://agent.deepgram.com/v1/agent/converse';

console.log('Connecting to', url);
const ws = new WebSocket(url, {
  headers: {
    Authorization: `Token ${key}`
  },
  handshakeTimeout: 10000
});

ws.on('open', () => {
  console.log('OPEN - WebSocket handshake succeeded');

  const settings = {
    type: 'Settings',
    audio: {
      input: {
        encoding: 'linear16',
        sample_rate: 16000
      }
    },
    agent: {
      language: 'en',
      listen: {
        provider: {
          type: 'deepgram',
          model: 'nova-2'
        }
      }
    }
  };

  ws.send(JSON.stringify(settings));
  console.log('Sent Settings:', JSON.stringify(settings, null, 2));
});

ws.on('message', (data) => {
  const message = JSON.parse(data);
  console.log('Received message:', JSON.stringify(message, null, 2));

  if (message.type === 'SettingsApplied') {
    console.log('Settings were applied. You can now send audio. Closing for now.');
    ws.close();
  }
});

ws.on('close', (code, reason) => {
  console.log('CLOSE', { code, reason: reason && reason.toString() });
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('ERROR', err && err.toString());
  console.error('ERR full:', err);
  process.exit(1);
});
