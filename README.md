# Multi-AI Chat Debate

AI Group Chat is an multi-AI conversation platform designed to facilitate dynamic debates, collaborative coding, and complex discussions between various AI personalities. The platform leverages multiple LLM providers to create a rich, interactive environment where users can watch different models interact, challenge each other, and solve problems in real-time.

![AI Group Debate](https://i.ibb.co/CcbWSsW/a-1-2-1.gif "img")

## Core Features
The application is built with a focus on conversation flow to ensure high-quality interactions.

*   **Multi-Model Support**: Integration with DeepInfra and Fireworks.ai to utilize models like DeepSeek, Qwen, and GLM.
*   **Dynamic Personalities**: Create custom AI participants with specific expertise, communication styles, and system instructions.
*   **Intelligent Flow Control**: A dedicated Flow Service manages turn-taking, prevents repetition, and handles @mentions to maintain natural conversation rhythms.
*   **Real-time Streaming**: Messages are streamed via Socket.io, providing a live, responsive chat experience.
*   **Database Persistence**: All conversations, participants, and messages are stored in a PostgreSQL database.
*   **Docker Integration**: Full containerization support for both the application and the database.

## Technical Stack

*   **Backend**: Node.js with Express
*   **Real-time Communication**: Socket.io
*   **Database**: PostgreSQL
*   **Frontend**: Vanilla JavaScript, HTML5, CSS3
*   **Markdown Rendering**: Marked.js with Highlight.js for code blocks
*   **Containerization**: Docker and Docker Compose

## Prerequisites

Before starting the installation, ensure you have the following installed on your system:

*   Node.js (v20 or higher)
*   PostgreSQL (if running locally)
*   Docker and Docker Compose (optional, for containerized setup)
*   API Keys for DeepInfra or Fireworks.ai

## Installation and Setup

### Local Development Setup

1. **Clone the repository**
```bash
git clone https://github.com/TonyGeez/debate-ai
cd debate-ai
```

2. **Install dependencies**
```bash
npm install
```

3. **Configure environment**
```bash
cp .env.example .env
# Edit .env and add your API keys and database credentials
```

4. **Setup database and start application**
```bash
# Initialize PostgreSQL database
npm run db:setup

# Start development server
npm run dev
```

The application will be available at `http://localhost:3000`

**Prerequisites:**
- Node.js 20+ installed
- PostgreSQL 15+ running locally
- API keys for DeepInfra and/or Fireworks AI


### Docker Deployment

1. **Clone the repository**
```bash
git clone https://github.com/TonyGeez/debate-ai
cd debate-ai
```

2. **Configure environment**
```bash
cp .env.docker.example .env.docker
# Edit .env.docker and add your API keys
```

3. **Build and start containers**
```bash
# Build images
docker compose build

# Start services (includes automatic database initialization)
docker compose up -d
```

The application will be available at `http://localhost:3000`

**To stop services:**
```bash
docker compose down
```

**Prerequisites:**
- Docker and Docker Compose installed
- Ports 3000 and 5432 available

---

## Environment Configuration

The application requires several environment variables to function correctly. These should be defined in your `.env` or `.env.docker` file.

*   `PORT`: The port the server will listen on (default: 3000).
*   `DB_HOST`: Database host (use `db` for Docker).
*   `POSTGRES_USER`: PostgreSQL username.
*   `POSTGRES_PASSWORD`: PostgreSQL password.
*   `POSTGRES_DB`: Database name.
*   `FIREWORKS_API_KEY`: Your API key from Fireworks.ai.
*   `DEEPINFRA_API_KEY`: Your API key from DeepInfra.
*   `DEFAULT_MESSAGE_LIMIT`: Default cap on messages per conversation.



## Contributing

Contributions are welcome to help improve the AI Group Chat platform. Please feel free to submit pull requests or open issues for bugs and feature requests.

---

# Todo 

## Essential Features
- [ ] Delete chat from sidebar
- [ ] Edit chat settings (max message, title, topic)
- [ ] Rename conversation
- [ ] Export conversation (JSON, Markdown, PDF)
- [ ] Search conversations by title/topic
- [ ] Search within conversation content
- [ ] Copy message to clipboard
- [ ] Edit sent messages (with edit history)
- [ ] Delete individual messages
- [ ] Reply to specific message (threaded replies)
- [ ] Proper @mention support with autocomplete
- [ ] Typing indicators for AI participants
- [ ] User authentication system
- [ ] Fork/duplicate conversation
- [ ] Archive conversations
- [ ] Bulk actions (delete/archive multiple)

## AI & Conversation Features
- [ ] Add/remove AI participants mid-conversation
- [ ] AI participant library with pre-made personalities
- [ ] Providers managemeng (API models endpoint)
- [ ] Custom API endpoints 
- [ ] AI model switching during conversation
- [ ] Conversation analytics (speaker stats, sentiment analysis)
- [ ] AI confidence scores visualization
- [ ] Advanced flow controls (custom turn-taking logic)
- [ ] Conditional AI responses based on triggers
- [ ] AI memory management and optimization
- [ ] Long-term conversation archiving

## Media & Rich Content
- [ ] File attachments (PDFs, documents)
- [ ] Code execution sandbox
- [ ] Real-time collaborative code editing
- [ ] Video message support
- [ ] File drag-and-drop interface
- [ ] Media gallery view per conversation

## Advanced Features
- [ ] Conversation branching (multiple parallel topics)
- [ ] Speech-to-text input
- [ ] Text-to-speech for AI responses
- [ ] Plugin system for extensibility
- [ ] WebRTC voice/video chat
- [ ] AI model comparison mode (side-by-side responses)
- [ ] A/B testing framework for AI personalities
- [ ] Advanced moderation tools
- [ ] Spam detection for AI responses
- [ ] Conversation templates and presets
- [ ] Smart conversation suggestions

## DevOps & Performance
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Automated E2E testing (Playwright)
- [ ] Unit test coverage >80%
- [ ] Health check endpoints
- [ ] Auto-scaling configuration
- [ ] Backup and restore automation
- [ ] Caching layer (Redis) for frequently accessed data
