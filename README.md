# Lumina Outreach

Developer README — comprehensive guide to understand, run, and contribute to Lumina Outreach (Project-Call).

Lumina Outreach is an AI-powered intelligent communication platform and CRM focused on outbound voice outreach, lead management, campaign orchestration, and analytics. The system pairs a React + TypeScript dashboard (client/) with a Node.js + TypeScript backend (server/) and supports multi-provider TTS, telephony integrations, and real-time websocket flows.

## Table of Contents

- [Quick Start](#quick-start-developer)
- [Project Structure](#project-structure)
- [Architecture Overview](#architecture-overview)
- [Key Technologies](#key-technologies)
- [Configuration](#configuration)
- [Developer Workflows](#developer-workflows)
- [API Routes](#api-routes)
- [Services & Integrations](#services--integrations)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)

## Quick start (developer)

**Prerequisites:** Node.js 18+, npm or yarn, MongoDB (local or remote), API keys for Twilio and at least one TTS provider (ElevenLabs and/or Deepgram).

1) Clone repo

```bash
git clone https://github.com/dhruv465/Project-Call.git
cd Project-Call
```

2) Copy env templates and configure

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
# Edit server/.env and client/.env with your keys and DB URL
```

3) Install dependencies

```bash
# From project root
npm install

# Or install per workspace
cd server && npm install && cd ../client && npm install
```

4) Start development servers

```bash
# Terminal 1: Start backend (runs on port 8000 by default)
cd server
npm run dev

# Terminal 2: Start frontend (runs on port 3000 by default)
cd client
npm run dev
```

Helper scripts are available via `Makefile` - run `make install`, `make server`, `make client`, or `make test`.

## Project Structure

```
Project-Call/
├── client/                      # Frontend React application
│   ├── src/
│   │   ├── components/          # Reusable UI components
│   │   ├── pages/               # Page-level components (routes)
│   │   ├── layouts/             # Layout wrappers
│   │   ├── contexts/            # React context providers
│   │   ├── hooks/               # Custom React hooks
│   │   ├── services/            # API client services
│   │   ├── types/               # TypeScript type definitions
│   │   ├── utils/               # Utility functions
│   │   ├── lib/                 # Third-party library configs
│   │   ├── styles/              # Global styles and themes
│   │   ├── icons/               # Icon components
│   │   ├── App.tsx              # Root application component
│   │   └── main.tsx             # Application entry point
│   ├── public/                  # Static assets (favicons, etc.)
│   ├── dist/                    # Production build output
│   ├── vite.config.ts           # Vite bundler configuration
│   ├── tailwind.config.js       # Tailwind CSS configuration
│   └── package.json             # Frontend dependencies
│
├── server/                      # Backend Node.js application
│   ├── src/
│   │   ├── controllers/         # Request handlers (business logic entry)
│   │   ├── routes/              # API route definitions
│   │   │   ├── userRoutes.ts    # User auth & profile routes
│   │   │   ├── leadRoutes.ts    # Lead management routes
│   │   │   ├── streamRoutes.ts  # WebSocket streaming (deprecated)
│   │   │   └── ...              # Campaign, call, analytics routes
│   │   ├── services/            # Core business logic & integrations
│   │   │   ├── elevenLabsConversationalService.ts  # ElevenLabs TTS
│   │   │   ├── speechAnalysisService.ts            # Speech-to-text & analysis
│   │   │   └── ...              # Twilio, Deepgram, campaign services
│   │   ├── models/              # MongoDB schema definitions
│   │   ├── middleware/          # Express/Fastify middleware (auth, validation)
│   │   ├── config/              # Configuration files
│   │   ├── database/            # Database connection & utilities
│   │   ├── microservices/       # Modular service components
│   │   ├── migrations/          # Database migration scripts
│   │   ├── monitoring/          # Logging & performance monitoring
│   │   ├── health/              # Health check endpoints
│   │   ├── types/               # TypeScript type definitions
│   │   ├── utils/               # Utility functions
│   │   └── index.ts             # Server entry point
│   ├── tests/                   # Unit and integration tests
│   ├── logs/                    # Application logs (generated)
│   └── package.json             # Backend dependencies
│
├── fetched_content/             # Documentation & reference materials
│   ├── twiml.txt                # TwiML documentation
│   ├── conversational-intelligence.txt  # Twilio AI features
│   └── ...                      # Other API documentation
│
├── CONTRIBUTING.md              # Contribution guidelines
├── Makefile                     # Development shortcuts
└── README.md                    # This file
```

## Architecture Overview

### System Components

**Frontend (Client)**
- React 18 + TypeScript + Vite
- Tailwind CSS for styling
- Real-time updates via WebSocket
- REST API communication with backend
- Context-based state management

**Backend (Server)**
- Node.js + TypeScript + Fastify
- MongoDB for data persistence
- JWT-based authentication
- WebSocket server for real-time communication
- Multi-provider integration architecture

### Data Flow

1. **User Interaction** → Frontend sends REST API request
2. **Authentication** → JWT middleware validates user
3. **Controller** → Routes request to appropriate controller
4. **Service Layer** → Business logic executes (campaigns, calls, leads)
5. **External APIs** → Integrates with Twilio (telephony), ElevenLabs/Deepgram (TTS/STT)
6. **Database** → MongoDB stores/retrieves data
7. **WebSocket** → Real-time updates pushed to frontend
8. **Response** → Data returned to client

### Call Flow Architecture

```
User initiates call → Campaign Service → Twilio API → TwiML webhook
                                                           ↓
                                                    WebSocket connection
                                                           ↓
                                        ElevenLabs/Deepgram (TTS/STT)
                                                           ↓
                                                  Speech Analysis Service
                                                           ↓
                                                    Call Recording & Logs
```

## Key Technologies

### Frontend Stack
- **React 18**: UI framework
- **TypeScript**: Type safety
- **Vite**: Fast build tool
- **Tailwind CSS**: Utility-first styling
- **React Router**: Client-side routing
- **Axios**: HTTP client

### Backend Stack
- **Node.js 18+**: Runtime environment
- **Fastify**: High-performance web framework
- **TypeScript**: Type safety
- **MongoDB**: NoSQL database
- **Mongoose**: ODM for MongoDB
- **JWT**: Authentication tokens

### Third-Party Integrations
- **Twilio**: Voice calls, SMS, TwiML
- **ElevenLabs**: Text-to-speech (primary)
- **Deepgram**: Speech-to-text, TTS fallback
- **OpenAI**: Conversational AI & analysis
- **Cloudinary**: Media storage

## Configuration

### Environment Variables

**Server (.env)**
```bash
# Core
PORT=8000
NODE_ENV=development
MONGODB_URI=mongodb://...
JWT_SECRET=your-secret-key
CLIENT_URL=http://localhost:3000

# Webhooks (critical for Twilio)
WEBHOOK_BASE_URL=https://your-ngrok-url.ngrok-free.app

# Twilio
TWILIO_ACCOUNT_SID=your-sid
TWILIO_AUTH_TOKEN=your-token
TWILIO_PHONE_NUMBER=+1234567890

# TTS Providers
ELEVENLABS_API_KEY=your-key
ELEVENLABS_ENABLED=true
DEEPGRAM_API_KEY=your-key

# OpenAI
OPENAI_API_KEY=your-key

# Cloudinary
CLOUDINARY_CLOUD_NAME=your-cloud
CLOUDINARY_API_KEY=your-key
CLOUDINARY_API_SECRET=your-secret

# Features
DEMO_MODE=false
USE_MEMORY_STORE=true
```

**Client (.env)**
```bash
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000
```

### Important Notes
- Never commit `.env` files to version control
- Use `.env.example` as template
- For local development with Twilio webhooks, use ngrok or similar tunneling service
- Update `WEBHOOK_BASE_URL` with your ngrok URL

## Developer Workflows

### Local Development
```bash
# Start backend with hot reload
cd server && npm run dev

# Start frontend with hot reload
cd client && npm run dev
```

### Testing
```bash
# Run backend tests
cd server && npm test

# Run specific test file
cd server && npm test -- path/to/test.spec.ts
```

### Linting & Type Checking
```bash
# Backend
cd server && npm run lint
cd server && npm run typecheck

# Frontend
cd client && npm run lint
cd client && npm run typecheck
```

### Building for Production
```bash
# Build backend
cd server && npm run build

# Build frontend
cd client && npm run build
```

## API Routes

### Authentication (`/api/users`)
- `POST /register` - Create new user account
- `POST /login` - Authenticate user, returns JWT
- `GET /profile` - Get current user profile (authenticated)
- `PUT /profile` - Update user profile (authenticated)
- `GET /` - Get all users (authenticated)

### Lead Management (`/api/leads`)
- `POST /` - Upload leads manually
- `GET /` - Get all leads with filtering
- `GET /analytics` - Get lead analytics
- `GET /export` - Export leads to CSV
- `GET /:id` - Get single lead by ID
- `PUT /:id` - Update lead information
- `DELETE /:id` - Delete lead
- `POST /import/csv` - Import leads from CSV file

### Campaign Management (`/api/campaigns`)
- Campaign creation, scheduling, and execution
- Real-time campaign status updates
- Campaign analytics and reporting

### Call Management (`/api/calls`)
- Initiate outbound calls
- Call status tracking
- Call recordings and transcripts
- Call analytics

### WebSocket Endpoints
- `/ws/twilio` - Twilio media stream connection
- `/ws/deepgram` - Deepgram real-time transcription
- `/ws/elevenlabs` - ElevenLabs conversational AI

## Services & Integrations

### Core Services

**elevenLabsConversationalService.ts**
- Manages ElevenLabs TTS and conversational AI
- WebSocket-based real-time voice synthesis
- Fallback to REST API if WebSocket fails
- Configurable voice models and settings

**speechAnalysisService.ts**
- Speech-to-text transcription (Deepgram, Google Speech)
- Sentiment analysis using OpenAI
- Intent detection and classification
- Model compatibility and fallback handling

**Campaign Service**
- Orchestrates outbound call campaigns
- Lead prioritization and scheduling
- Call queue management
- Campaign analytics and reporting

**Twilio Service**
- TwiML generation for call flows
- Media stream handling
- Call recording management
- SMS and voice integration

### Integration Points

1. **Twilio Webhooks**: Server must be publicly accessible (use ngrok for local dev)
2. **TTS Providers**: Multi-provider with automatic fallback (ElevenLabs → Deepgram)
3. **STT Providers**: Deepgram primary, Google Speech fallback
4. **AI Analysis**: OpenAI for conversation intelligence
5. **Media Storage**: Cloudinary for recordings and attachments

## Troubleshooting

### Common Issues

**Server fails to start**
- Check `server/.env` for missing or invalid keys
- Verify MongoDB connection string is correct
- Ensure MongoDB is running and accessible
- Check port 8000 is not already in use

**Client dev server port conflicts**
- Change Vite port in `client/vite.config.ts`
- Or modify dev script in `client/package.json`

**TTS/STT failures**
- Confirm API keys are valid and have sufficient credits
- Check provider status pages
- Verify fallback providers are configured
- Review logs in `server/logs/combined.log`

**Twilio webhook errors**
- Ensure `WEBHOOK_BASE_URL` is publicly accessible
- For local dev, use ngrok: `ngrok http 8000`
- Update Twilio console with ngrok URL
- Check Twilio webhook logs in dashboard

**Authentication issues**
- Verify JWT_SECRET is set in server/.env
- Check token expiration settings
- Clear browser localStorage/cookies
- Review rate limiting configuration

### Logs & Debugging

**Backend Logs**
- Location: `server/logs/` directory
- Combined log: `server/logs/combined.log`
- Error log: `server/logs/error.log`
- Log level controlled by `LOG_LEVEL` env variable

**Frontend Debugging**
- Open browser DevTools console
- Check Network tab for API errors
- Inspect WebSocket connections
- Review React DevTools for component state

## Security Best Practices

- Store all sensitive keys in `.env` files (never commit)
- Use strong JWT secrets (32+ characters)
- Enable rate limiting in production
- Implement CORS properly (restrict origins)
- Validate all user inputs
- Sanitize data before database operations
- Use HTTPS in production
- Regularly update dependencies
- Review and rotate API keys periodically

## Batch Calling Feature

### ✅ Frontend Implementation (Complete)

The batch calling UI is fully implemented and ready to use. Developers only need to connect the backend API endpoint.

**What's Already Built:**

1. **Lead Selection System**
   - Checkbox selection on desktop table view
   - Checkbox selection on mobile/tablet card view
   - "Select All" / "Deselect All" functionality
   - Visual feedback with selected count

2. **Batch Action Toolbar**
   - Appears when leads are selected
   - Shows count of selected leads
   - "Start Batch Call" button
   - "Clear Selection" option

3. **Batch Call Sheet Component**
   - Campaign selector dropdown (loads from `/api/campaigns`)
   - Campaign selection with visual confirmation
   - Summary section showing selected leads and campaign
   - Information about concurrent call limits and queue behavior
   - Fully responsive (works on mobile, tablet, desktop)

4. **API Service Layer**
   - `client/src/services/campaignsApi.ts` - Campaign CRUD operations
   - Ready to integrate with batch call endpoint

**Files Created:**
- `client/src/components/leads/BatchCallSheet.tsx` - Main batch calling UI
- `client/src/services/campaignsApi.ts` - Campaign API service

**Files Modified:**
- `client/src/pages/Leads.tsx` - Added selection state and batch UI

**What Developers Need to Do:**

### Backend API Endpoint Required

Create the following endpoint to enable batch calling:

```typescript
POST /api/calls/batch
Content-Type: application/json

Request Body:
{
  "leadIds": ["lead_id_1", "lead_id_2", "lead_id_3"],
  "campaignId": "campaign_id"
}

Response:
{
  "success": true,
  "queuedCalls": 3,
  "message": "Batch call initiated successfully"
}
```

**Backend Implementation Requirements:**

1. **Validate Request**
   - Check if campaign exists
   - Verify all lead IDs are valid
   - Ensure user has permission to use the campaign

2. **Queue Management**
   - Check current concurrent call count
   - Queue calls if limit is reached (max: 50 concurrent)
   - Implement priority queue for urgent leads

3. **Call Initiation**
   - Use campaign's voice configuration and script
   - Initiate calls respecting concurrent limit
   - Track call status in database

4. **Error Handling**
   - Handle invalid campaign/lead IDs
   - Return appropriate error messages
   - Implement retry logic for failed calls

**Frontend Integration Point:**

Update `client/src/components/leads/BatchCallSheet.tsx`:

```typescript
// Line ~60: Replace the TODO with actual API call
const handleInitiateBatchCall = async () => {
  // ... validation code ...
  
  try {
    // Replace this placeholder with actual API call
    const response = await api.post('/calls/batch', {
      leadIds: selectedLeadIds,
      campaignId: selectedCampaignId
    });
    
    toast({
      title: "Batch Call Started",
      description: `${response.data.queuedCalls} calls have been queued.`,
    });
    
    onSuccess?.();
    handleClose();
  } catch (error) {
    // ... error handling ...
  }
};
```

**Testing the UI (Without Backend):**

The UI is fully functional and can be tested:
1. Navigate to Leads page
2. Select multiple leads using checkboxes
3. Click "Start Batch Call"
4. Select a campaign from dropdown
5. Click "Start Batch Call" button (shows placeholder toast)

---

## TODO: Batch Calling Backend & Improvements

### Current Limitations
The system has partial batch calling capability but requires improvements for production-scale concurrent calling:

**Current State:**
- ✅ Call tracking via `activeCalls` Map
- ✅ Campaign processing in batches of 10 leads
- ✅ WebSocket handling per call
- ⚠️ Max concurrent calls: 50 (configured in `.env`)
- ⚠️ Sequential batch processing (10 leads every 30 seconds)

**Backend Implementation Tasks:**

1. **[ ] Batch Call API Endpoint** (HIGH PRIORITY)
   - Create `POST /api/calls/batch` endpoint
   - Accept `leadIds[]` and `campaignId` in request body
   - Return queue status and confirmation
   - Connect to frontend BatchCallSheet component

2. **[ ] Concurrent Call Limit Enforcement**
   - System doesn't check if max concurrent limit is reached before making new calls
   - Need to implement pre-call validation against `MAX_CONCURRENT_CALLS`
   - Add queue system for calls exceeding limit

3. **[ ] Parallel Campaign Processing**
   - Current: Sequential processing (10 leads → wait 30s → next 10)
   - Target: True parallel processing up to concurrent limit
   - Implement worker pool pattern for call distribution

4. **[ ] Call Queue System**
   - Implement proper queue for hundreds/thousands of leads
   - Priority-based queue (urgent leads first)
   - Retry logic for failed calls
   - Queue persistence across server restarts

5. **[ ] Resource Management & Monitoring**
   - Track Deepgram connection limits and usage
   - Monitor ElevenLabs rate limits
   - Memory usage monitoring for 50+ WebSocket connections
   - Implement circuit breaker pattern for external APIs

6. **[ ] Database Connection Pool Optimization**
   - Current: 10 connections (too low for 50 concurrent calls)
   - Target: Scale pool size to match concurrent call capacity
   - Implement connection pooling best practices

7. **[ ] Modular Voice Agent Pipeline**
   - Current: Using Deepgram Agent API (all-in-one STT+LLM+TTS)
   - Target: Separate pipeline: `User Audio → Deepgram STT → LLM → TTS → Agent Audio`
   - Implement manual barge-in handling
   - Add conversation state management
   - Support for custom LLM providers (Gemini, OpenAI, Anthropic)

**Implementation Priority:**
1. **Batch Call API Endpoint** (Critical - enables the feature)
2. Concurrent limit enforcement (High - prevents system overload)
3. Database pool optimization (High - prevents connection errors)
4. Call queue system (Medium - enables scalability)
5. Parallel processing (Medium - improves throughput)
6. Resource monitoring (Medium - operational visibility)
7. Modular pipeline (Low - architectural improvement)

**Related Files:**

*Frontend (Complete):*
- `client/src/components/leads/BatchCallSheet.tsx` - Batch calling UI
- `client/src/pages/Leads.tsx` - Lead selection interface
- `client/src/services/campaignsApi.ts` - Campaign API service

*Backend (Needs Implementation):*
- `server/src/controllers/callController.ts` - Add batch call endpoint
- `server/src/services/realTelephonyService.ts` - Call management
- `server/src/services/campaignService.ts` - Campaign processing
- `server/src/services/twilioStreamHandler.ts` - WebSocket handling
- `server/src/services/deepgramService.ts` - STT/Agent integration
- `server/.env` - Configuration (MAX_CONCURRENT_CALLS, DB_CONNECTION_POOL_SIZE)

## Contributing

See `CONTRIBUTING.md` for detailed guidelines. Quick summary:

**Branching Strategy**
- Create feature branches from `main`
- Naming: `feat/<description>`, `fix/<description>`, `chore/<description>`
- Example: `feat/add-sms-campaigns`

**Commit Messages**
- Format: `type(scope): description`
- Example: `feat(server): add campaign import endpoint`
- Types: feat, fix, chore, docs, test, refactor

**Pull Request Checklist**
- Code builds without errors
- Tests pass locally (`npm test`)
- New features include tests
- API changes are documented
- UI changes include screenshots
- Update README if behavior changes
- Provide clear PR description with testing steps

**Code Style**
- Follow existing TypeScript patterns
- Use ESLint configuration
- Run linters before committing
- Write meaningful comments for complex logic

## Getting Started as a New Developer

### Day 1: Setup & Exploration

1. **Clone and run** the project following Quick Start
2. **Explore the UI**: Open `http://localhost:3000` and navigate through pages
3. **Review key files**:
   - `client/src/App.tsx` - Frontend routing
   - `server/src/index.ts` - Backend entry point
   - `server/src/routes/` - API endpoints

### Understanding the Codebase

**Frontend Flow**
```
User Action → Component → Hook/Context → Service (API call) → Backend
```
- Start at `client/src/pages/` to see main views
- Check `client/src/services/` for API integration
- Review `client/src/hooks/` for reusable logic

**Backend Flow**
```
API Request → Route → Middleware (auth) → Controller → Service → Database/External API
```
- Start at `server/src/routes/` to see available endpoints
- Follow to `server/src/controllers/` for request handling
- Dive into `server/src/services/` for business logic

**Key Files to Understand**

1. **Authentication**: `server/src/controllers/userController.ts`
2. **Lead Management**: `server/src/controllers/leadController.ts`
3. **Campaign Logic**: `server/src/services/campaignService.ts`
4. **TTS Integration**: `server/src/services/elevenLabsConversationalService.ts`
5. **Speech Analysis**: `server/src/services/speechAnalysisService.ts`
6. **Twilio Integration**: `server/src/services/twilioService.ts`

### Making Your First Change

1. Pick a small feature or bug fix
2. Create a branch: `git checkout -b feat/my-feature`
3. Make changes in relevant files
4. Test locally (run server and client)
5. Add tests if applicable
6. Commit with clear message
7. Push and open PR

### Common Development Tasks

**Adding a new API endpoint**
1. Define route in `server/src/routes/`
2. Create controller function in `server/src/controllers/`
3. Implement business logic in `server/src/services/`
4. Add model if needed in `server/src/models/`
5. Write tests in `server/tests/`

**Adding a new UI page**
1. Create component in `client/src/pages/`
2. Add route in `client/src/App.tsx`
3. Create API service in `client/src/services/`
4. Add types in `client/src/types/`
5. Style with Tailwind CSS

**Integrating a new external service**
1. Add API keys to `.env.example` and `.env`
2. Create service file in `server/src/services/`
3. Add configuration in `server/src/config/`
4. Implement error handling and fallbacks
5. Document in README

## Useful commands (zsh)

```bash
# install deps (root)
npm install

# start backend (dev)
cd server && npm run dev

# start frontend (dev)
cd client && npm run dev

# run server tests
cd server && npm test
```

## Quick Reference: Batch Calling

**For Frontend Developers:**
- UI is complete and ready to use
- Test at: Leads page → Select leads → "Start Batch Call"
- Component: `client/src/components/leads/BatchCallSheet.tsx`

**For Backend Developers:**
- Need to implement: `POST /api/calls/batch`
- Integration point: Line ~60 in `BatchCallSheet.tsx`
- See "Batch Calling Feature" section above for full specs

**For QA/Testing:**
- Frontend can be tested without backend (shows placeholder toast)
- Mobile/tablet responsive design included
- Works with existing campaigns from `/api/campaigns`

---

## License

MIT

---
Additional docs

- Contributing guide: `CONTRIBUTING.md`
- Troubleshooting: `TROUBLESHOOTING.md`
- Quick dev commands: `Makefile` (run `make install`, `make server`, `make client`, `make test`)
