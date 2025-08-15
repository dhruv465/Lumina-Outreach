# Lumina Outreach: Intelligent Communication System

A comprehensive intelligent communication platform with AI-powered outreach capabilities, integrated with a custom CRM dashboard that manages leads, executes outbound calls, handles conversations intelligently, and provides detailed performance analytics.

## Getting Started

### Setup

1. Clone the repository
   ```bash
   git clone https://github.com/dhruv465/Project-Call.git
   cd Project-Call
   ```

2. Run the setup script to initialize your environment
   ```bash
   ./setup-env.sh
   ```
   This script will:
   - Create a `.env` file from the template
   - Install git hooks to prevent accidental commits of sensitive data
   - Run npm install if needed

3. Update your `.env` file with actual credentials
   ```bash
   # Open the .env file and replace placeholder values
   nano server/.env
   ```

4. Start the server and client
   ```bash
   # Start the server
   cd server
   npm run dev
   
   # In a new terminal, start the client
   cd client
   npm run dev
   ```

### Environment Variables

The project requires several environment variables to be set in the `server/.env` file. The `setup-env.sh` script creates this file from the `.env.example` template, but you need to update it with your actual credentials.

Important security note: **Never commit your `.env` file to the repository.** It contains sensitive information like API keys and database credentials.

### TTS Configuration

The system supports multiple Text-to-Speech providers with automatic fallback:

#### Multi-Provider Setup
- **Primary Provider**: ElevenLabs (default) or Deepgram TTS
- **Fallback Provider**: Automatic fallback to secondary provider on failure
- **Voice Models**: Support for multiple voice personalities and models

#### Quick TTS Setup
1. Add API keys to your configuration via the admin interface
2. Choose your primary TTS provider (ElevenLabs or Deepgram)
3. Enable automatic fallback for improved reliability
4. Test your configuration using the built-in verification tools

For detailed TTS configuration, see [DEEPGRAM_TTS.md](./DEEPGRAM_TTS.md).

## Features

### Lead Management
- CSV import with validation
- API endpoints for real-time lead ingestion
- Data validation and integrity
- Lead segmentation capabilities
- Comprehensive lead tracking

### Campaign Configuration
- Campaign setup wizard
- Script generation system
- A/B testing framework
- Template library
- Compliance checking for Indian telecommunication standards

### Voice AI System
- Advanced emotion detection with cultural context
- Multiple voice personalities with adaptation
- **Multi-provider TTS system** (ElevenLabs + Deepgram TTS) with automatic fallback
- Bilingual conversation support (English/Hindi)
- Real-time personality adaptation based on customer emotions
- Cultural intelligence and communication patterns
- Natural conversation flow management
- Comprehensive demo and testing framework

### Telephony Integration
- Twilio API integration for outbound calling
- **Dual TTS provider support** (ElevenLabs + Deepgram TTS) with intelligent fallback
- Call queue management
- Automatic retry logic
- Call recording and storage

### Conversation AI Engine
- Multi-LLM selection system
- Multi-language support
- Speech-to-Text processing
- Intent analysis
- Objection handling framework
- Callback scheduling
- Dynamic conversation flow management

### CRM Dashboard
- Real-time KPI visualization
- Role-based access control
- Customizable widget arrangement
- Dark/light theme support
- Comprehensive metrics and analytics

## Technology Stack

### Frontend
- React.js
- TypeScript
- ShadCN UI
- Chart.js/D3.js for visualizations
- WebSocket for real-time updates

### Backend
- Node.js
- Express.js
- TypeScript
- MongoDB
- In-memory caching

### APIs
- Twilio for telephony
- **Multi-provider TTS**: ElevenLabs + Deepgram for voice synthesis with automatic fallback
- Various LLM APIs (OpenAI, Anthropic, etc.)
- Speech-to-Text services

### Infrastructure
- Native Node.js development
- Local development environment
- MongoDB database
- Monitoring and logging

## Getting Started

### Prerequisites
- Node.js (v18+)
- MongoDB
- API keys for Twilio, ElevenLabs, and LLM services

### Installation

#### Development Setup
1. Clone the repository
2. Copy the example environment files:
   ```bash
   cp server/.env.example server/.env
   cp client/.env.example client/.env
   ```
3. Edit the `.env` files with your API keys and configuration
4. Run the application using the provided script:
   ```bash
   ./run.sh start
   ```
   
#### Method 2: Manual Setup
1. Clone the repository
2. Install root dependencies:
   ```bash
   npm install
   ```
3. Install server dependencies:
   ```bash
   cd server
   npm install
   cp .env.example .env
   # Edit .env with your configuration
   ```
4. Install client dependencies:
   ```bash
   cd client
   npm install
   cp .env.example .env
   # Edit .env with your configuration
   ```
5. Start development servers:
   ```bash
   # From project root
   npm run start:dev
   ```

## Project Structure
```
lumina-outreach/
├── client/                  # Frontend React application
│   ├── public/
│   └── src/
│       ├── components/      # UI components
│       ├── hooks/           # Custom React hooks
│       ├── layouts/         # Page layouts
│       ├── pages/           # Application pages
│       ├── services/        # API service connections
│       ├── store/           # State management
│       ├── styles/          # Global styles
│       └── utils/           # Utility functions
├── server/                  # Backend Node.js application
│   ├── src/
│   │   ├── config/          # Configuration files
│   │   ├── controllers/     # Route controllers
│   │   ├── models/          # Database models
│   │   ├── routes/          # API routes
│   │   ├── services/        # Business logic
│   │   ├── types/           # TypeScript types
│   │   └── utils/           # Utility functions
│   ├── tests/               # Backend tests
│   └── tsconfig.json        # TypeScript configuration
├── shared/                  # Shared TypeScript types
├── scripts/                 # Development and testing scripts
├── .env.example             # Example environment variables
├── .gitignore               # Git ignore file
├── package.json             # Project configuration
└── README.md                # Project documentation
```

## Security and Compliance
- End-to-end encryption for sensitive data
- Audit trails for system interactions
- Compliance monitoring dashboard
- Rate limiting to prevent abuse
- Data retention policies aligned with Indian regulations
- User authentication and authorization

## Performance Optimization
- Connection pooling for database operations
- CDN integration for static assets
- Caching strategies
- Optimized API responses
- Lazy loading for dashboard components
- Performance monitoring and alerting

## License
MIT
