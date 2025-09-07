const WebSocket = require('ws');
const http = require('http');

const PORT = 8001; // Use a different port than your main app

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Minimal WebSocket Server\n');
});

const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', ws => {
  console.log('Minimal WS: Client connected!');

  ws.on('message', message => {
    console.log(`Minimal WS: Received message: ${message.toString()}`);
    try {
      const parsedMessage = JSON.parse(message.toString());
      if (parsedMessage.event === 'connected') {
        console.log('Minimal WS: Received Twilio connected message!');
        // Send a simple acknowledgment back to Twilio
        ws.send(JSON.stringify({ event: 'start', streamSid: parsedMessage.streamSid }));
        console.log('Minimal WS: Sent Twilio start acknowledgment.');
      } else if (parsedMessage.event === 'start') {
        console.log('Minimal WS: Received Twilio start message!');
      } else if (parsedMessage.event === 'media') {
        // Log media messages, but don't process them
        // console.log('Minimal WS: Received media message (not processed).');
      }
    } catch (e) {
      console.error('Minimal WS: Error parsing message:', e);
      console.log(`Minimal WS: Raw message: ${message.toString().substring(0, 200)}`);
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`Minimal WS: Client disconnected. Code: ${code}, Reason: ${reason.toString()}`);
  });

  ws.on('error', error => {
    console.error('Minimal WS: WebSocket error:', error);
  });

  // Send a simple "hello" to the client after connection
  ws.send('Hello from Minimal WebSocket Server!');
});

server.on('upgrade', (request, socket, head) => {
  // Only handle WebSocket upgrades for specific paths if needed,
  // otherwise, let wss handle all upgrades.
  // For Twilio, it will be a specific path like /voice/stream/...
  if (request.url.startsWith('/voice/stream')) { // Adjust this path if your Twilio URL is different
    wss.handleUpgrade(request, socket, head, ws => {
      wss.emit('connection', ws, request);
      console.log(`Minimal WS: Handled upgrade for URL: ${request.url}`);
    });
  } else {
    socket.destroy(); // Destroy if not a path we care about
  }
});

server.listen(PORT, () => {
  console.log(`Minimal WebSocket Server listening on port ${PORT}`);
  console.log(`Expose this with ngrok: ngrok http ${PORT}`);
});