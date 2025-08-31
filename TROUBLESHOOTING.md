# Troubleshooting — Lumina Outreach (developer)

Quick solutions for common setup and runtime problems.

1) Server won't start / crashes

- Check `server/.env` for required variables and a valid `MONGODB_URI`.
- Inspect logs: `server/logs/` and `server/combined.log`.
- Run with debug logging enabled if available (check `server/package.json` scripts). Example:

```bash
cd server
NODE_ENV=development npm run dev
```

2) Frontend fails to compile or HMR doesn't work

- Ensure `client/.env` exists and contains any required VITE_ variables.
- Delete `node_modules` and reinstall: `cd client && rm -rf node_modules && npm install`.
- Check `client/vite.config.ts` for custom port; adjust if conflicts occur.

3) TTS or Telephony errors

- Confirm API keys in `server/.env` for ElevenLabs/Deepgram/Twilio.
- Check provider-specific error messages in backend logs; many TTS errors are permission/quota related.

## ASR (Speech-to-Text): Deepgram

### Required Configuration
- Configure Deepgram API key in `server/.env`:
  ```bash
  DEEPGRAM_API_KEY=your_deepgram_api_key_here
  ```
- Alternatively, configure via the web UI under Configuration → ASR Settings

### Common Error Symptoms
- **No transcripts appearing**: User speaks but no text appears in conversation logs
- **Agent never responds to user**: System can speak but cannot listen, causing one-way communication
- **WebSocket sessions close immediately**: Error message "ASR not configured: Deepgram API key missing"
- **Calls connect but hang silently**: Missing bidirectional functionality

### Quick Verification Steps
1. Check configuration status via web UI Configuration page
2. Verify Deepgram account has sufficient credits at [Deepgram Console](https://console.deepgram.com/)
3. Test API key validity via Configuration → ASR Settings → Test Connection
4. Check server logs for ASR-related errors during call setup
5. Verify health endpoint shows `asr: true` at `/api/health`

### Account Requirements
- Active Deepgram account with API access
- Sufficient credit balance for transcription usage
- API key with appropriate permissions for speech-to-text operations

5) Tests failing locally

- Ensure node modules are installed for the package containing tests (root vs server/client).
- Run tests with increased verbosity to see stack traces: `cd server && npm test -- --runInBand`.

5) File upload or recording not found

- Check `uploads/` path permissions and storage configuration in `server/config`.

6) Database migrations / seeding issues

- Verify migration scripts under `server/migrations` and seeding utilities. Use the configured MongoDB user with appropriate permissions.

7) Where to find logs

- Backend logs: `server/logs/`, `server/combined.log`, `server/error.log`.

If you run into an issue not covered here, open an issue or PR with reproduction steps and any relevant logs.
