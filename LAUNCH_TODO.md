# Lumina Outreach MVP Launch Checklist

This checklist tracks gates that still need evidence before a production launch.
The current codebase uses LiveKit for voice, per-user provider credentials, and
MongoDB-backed batch recovery without a separate queue service.

## LiveKit and telephony gates

- [ ] Deploy the `lumina-outbound` agent to the intended LiveKit environment.
- [ ] Configure production LiveKit credentials for the API and agent.
- [ ] Configure the outbound SIP trunk and verify E.164 dialing on target regions.
- [ ] Exercise the full call lifecycle through dispatch, SIP, webhooks, transcript,
  outcome, and terminal call state.
- [ ] Verify barge-in, voicemail handling, callbacks, and transfer behavior on the
  production telephony path.
- [ ] Verify optional GCS recording delivery if recording is enabled.

## Data, credentials, and operations gates

- [ ] Configure the production MongoDB deployment and validate batch recovery from
  `processedLeadIds` after a controlled restart.
- [ ] Store a strong `CONFIG_ENCRYPTION_KEY` in the production secret manager.
- [ ] Have each user configure and verify their own Deepgram and LLM credentials in
  the app; do not depend on shared provider keys.
- [ ] Confirm logs and error monitoring are connected to the production observability
  stack without exposing provider credentials or customer data.
- [ ] Verify Google Sheets sync if it is enabled for the launch workflow.
- [ ] Run an agreed pilot/load test and record the acceptance results before rollout.

## Post-MVP backlog

- [ ] Build Conversation Review and human quality scoring.
- [ ] Add per-turn annotations and automatic prompt evaluation.
- [ ] Evaluate provider-specific fine-tuning and automatic campaign-script changes
  only after review data and explicit safeguards exist.
