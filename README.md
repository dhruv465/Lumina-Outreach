# Lumina Outreach: Industrial Conversational AI Platform 🚀

Lumina Outreach is an enterprise-grade, self-learning AI platform focused on automated outbound voice outreach and lead management. Built for massive scale and high-fidelity human interaction, it combines cutting-edge NLU with real-time telephony.

---

## 🌟 Key Industrial Features

### 1. Advanced "Digital Brain" (Dialogflow CX)
*   **Natural Understanding:** High-accuracy intent and entity extraction using Google Dialogflow CX.
*   **Emotional Intelligence:** Real-time sentiment and emotion tracking to adjust conversation tone.
*   **RAG (Retrieval-Augmented Generation):** Mid-call semantic search using MongoDB Atlas Vector Search to answer complex technical questions from your documentation.

### 2. Autonomous Self-Learning (HITL)
*   **Feedback Loop:** Human-in-the-Loop (HITL) dashboard for managers to review and correct AI interactions.
*   **Auto-Retraining:** Scheduled daily cron job that pushes corrected utterances back to Dialogflow to continuously improve accuracy.

### 3. Massive-Scale Batch Calling
*   **Distributed Queueing:** Powered by **BullMQ** and **Redis** for resilient handling of thousands of concurrent calls.
*   **Auto-CRM:** Real-time lead status updates (`Converted`, `Qualified`, `Not Interested`) based on AI conversation outcomes.

### 4. Enterprise Security & Privacy
*   **Twilio Auth:** Signature validation on all incoming webhooks to prevent spoofing.
*   **PII Masking:** Automated scrubbing of sensitive customer data (Emails, Credit Cards, SSNs) from logs and sheets.
*   **Observability:** Full distributed tracing and error tracking via **Sentry**.

---

## 🏗️ Project Structure

```
Project-Call/
├── client/              # React + TypeScript + Tailwind (Dashboard)
├── server/              # Node.js + Fastify + BullMQ (Intelligent Engine)
└── docker-compose.yml   # Full-stack production orchestration
```

---

## 🚀 Quick Start (Production)

### 1. Setup Infrastructure
Clone the repo and configure your environment:
```bash
cp server/.env.example server/.env
# Populate with: MONGODB_URI, REDIS_URL, TWILIO_SID, OPENAI_KEY, SENTRY_DSN
```

### 2. External Console Configuration
*   **Dialogflow CX:** Enable **Hindi (hi-IN)** and **Sentiment Analysis**.
*   **MongoDB Atlas:** Create a `vector_index` on the `KnowledgeBase` collection.
*   **Twilio:** Point your Voice and Status URLs to your stable HTTPS domain.

### 3. Launch
```bash
docker-compose up --build -d
```

---

## 🛠️ Core Technologies

*   **Frontend:** React 18, TypeScript, Vite, TanStack Query, shadcn/ui.
*   **Backend:** Node.js, Fastify, BullMQ, Redis, MongoDB/Mongoose.
*   **AI:** Dialogflow CX (NLU), OpenAI (LLM), Deepgram (STT), ElevenLabs (TTS).
*   **Ops:** Docker, Sentry, Winston Logging.

---

## 📜 License
MIT
