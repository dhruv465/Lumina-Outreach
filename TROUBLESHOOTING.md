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

4) ASR (Speech-to-Text) configuration

- Ensure ASR provider API key is configured in `server/.env`. Currently supported: Deepgram.
- Required environment variables:
  ```bash
  DEEPGRAM_API_KEY=your_deepgram_api_key_here
  ```
- If ASR is misconfigured, the system can speak but not listen, breaking bidirectional call functionality.
- Check system configuration status via the configuration UI or health endpoints.
- Verify Deepgram account has sufficient credits and API access permissions.
- Error symptoms: WebSocket sessions close immediately with "Speech recognition not configured" message.

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
