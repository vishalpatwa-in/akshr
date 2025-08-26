# OpenAI-Compatible Assistant API

A Cloudflare Worker implementation that provides an OpenAI-compatible API interface with support for multiple LLM providers (OpenAI and Gemini), comprehensive security, rate limiting, and monitoring.

## Features

- **Multi-Provider Support**: OpenAI and Gemini integration with automatic fallback
- **OpenAI-Compatible API**: Drop-in replacement for OpenAI API endpoints
- **Security**: Comprehensive authentication, CORS, rate limiting, and attack protection
- **Monitoring**: Built-in observability, metrics, and health checks
- **Scalability**: Serverless architecture with Cloudflare Workers
- **Storage**: R2 bucket integration for file storage and data persistence

## Quick Start

### Prerequisites

- Node.js 18+
- Wrangler CLI: `npm install -g wrangler`
- Cloudflare account with Workers access

### Installation

1. **Clone and install dependencies:**
   ```bash
   cd openai-compatible-assistant
   npm install
   ```

2. **Login to Cloudflare:**
   ```bash
   wrangler login
   ```

3. **Configure secrets:**
   ```bash
   # Required secrets
   wrangler secret put GEMINI_API_KEY
   wrangler secret put API_KEY
   wrangler secret put RATE_LIMIT_BYPASS_KEY
   wrangler secret put GC_ADMIN_KEY

   # Optional secrets
   wrangler secret put OPENAI_API_KEY
   ```

4. **Deploy the worker:**
   ```bash
   npm run deploy
   ```

## Configuration

### Environment Variables

The worker is configured through environment variables and secrets. See `.env.example` for a complete list of all configuration options.

#### Required Configuration

| Variable | Type | Description |
|----------|------|-------------|
| `GEMINI_API_KEY` | Secret | Your Gemini API key (required) |
| `API_KEY` | Secret | API key for authentication (required) |
| `RATE_LIMIT_BYPASS_KEY` | Secret | Key to bypass rate limits |
| `GC_ADMIN_KEY` | Secret | Admin key for garbage collection |

#### Optional Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | - | Your OpenAI API key (optional) |
| `NODE_ENV` | `development` | Environment mode |
| `LOG_LEVEL` | `info` | Logging level |
| `ENABLE_CORS` | `true` | Enable CORS headers |
| `ENABLE_AUTH` | `true` | Enable authentication |
| `ENABLE_RATE_LIMIT` | `true` | Enable rate limiting |

#### Provider Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PROVIDER_GEMINI_ENABLED` | `false` | Enable Gemini provider |
| `PROVIDER_OPENAI_ENABLED` | `false` | Enable OpenAI provider |
| `PROVIDER_TIMEOUT` | `30000` | Request timeout (ms) |
| `PROVIDER_MAX_RETRIES` | `3` | Maximum retry attempts |
| `PROVIDER_FALLBACK_ENABLED` | `true` | Enable fallback between providers |

### Provider Setup

#### Gemini Provider (Required)
1. Get your Gemini API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Set the secret: `wrangler secret put GEMINI_API_KEY`
3. Enable the provider by setting `PROVIDER_GEMINI_ENABLED=true`

#### OpenAI Provider (Optional)
1. Get your OpenAI API key from [OpenAI Platform](https://platform.openai.com/api-keys)
2. Set the secret: `wrangler secret put OPENAI_API_KEY`
3. Enable the provider by setting `PROVIDER_OPENAI_ENABLED=true`

## API Endpoints

The worker provides the following OpenAI-compatible endpoints:

### Core API
- `GET /v1/models` - List available models
- `POST /v1/chat/completions` - Chat completions
- `POST /v1/completions` - Text completions

### Health & Monitoring
- `GET /health` - Health check with provider status
- `GET /metrics` - Prometheus-compatible metrics

### File Operations
- `POST /v1/files` - Upload files
- `GET /v1/files/{file_id}` - Retrieve file information
- `DELETE /v1/files/{file_id}` - Delete files

### Assistant API
- `GET /v1/assistants` - List assistants
- `POST /v1/assistants` - Create assistant
- `GET /v1/assistants/{assistant_id}` - Retrieve assistant
- `POST /v1/assistants/{assistant_id}` - Modify assistant
- `DELETE /v1/assistants/{assistant_id}` - Delete assistant

### Thread Management
- `GET /v1/threads` - List threads
- `POST /v1/threads` - Create thread
- `GET /v1/threads/{thread_id}` - Retrieve thread
- `POST /v1/threads/{thread_id}` - Modify thread
- `DELETE /v1/threads/{thread_id}` - Delete thread

### Message Operations
- `GET /v1/threads/{thread_id}/messages` - List messages
- `POST /v1/threads/{thread_id}/messages` - Create message
- `GET /v1/threads/{thread_id}/messages/{message_id}` - Retrieve message
- `POST /v1/threads/{thread_id}/messages/{message_id}` - Modify message
- `DELETE /v1/threads/{thread_id}/messages/{message_id}` - Delete message

### Run Management
- `GET /v1/threads/{thread_id}/runs` - List runs
- `POST /v1/threads/{thread_id}/runs` - Create run
- `GET /v1/threads/{thread_id}/runs/{run_id}` - Retrieve run
- `POST /v1/threads/{thread_id}/runs/{run_id}/cancel` - Cancel run
- `POST /v1/threads/{thread_id}/runs/{run_id}/submit_tool_outputs` - Submit tool outputs

## Usage Examples

### Basic Chat Completion

```bash
curl -X POST https://your-worker.your-subdomain.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "gemini-pro",
    "messages": [
      {
        "role": "user",
        "content": "Hello, how are you?"
      }
    ]
  }'
```

### Health Check

```bash
curl https://your-worker.your-subdomain.workers.dev/health
```

### File Upload

```bash
curl -X POST https://your-worker.your-subdomain.workers.dev/v1/files \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -F "file=@example.txt" \
  -F "purpose=assistants"
```

## Development

### Local Development

```bash
# Start development server
npm run dev

# Run tests
npm test

# Generate TypeScript types
npm run cf-typegen
```

### Project Structure

```
src/
├── index.ts                 # Main worker entry point
├── modules/
│   ├── auth/               # Authentication module
│   ├── config/             # Configuration management
│   ├── errors/             # Error handling
│   ├── providers/          # LLM provider abstractions
│   │   ├── openai-adapter.ts
│   │   ├── gemini-adapter.ts
│   │   └── fallback-manager.ts
│   ├── routing/            # Request routing
│   ├── security/           # Security middleware
│   ├── services/           # Business logic
│   ├── validators/         # Request validation
│   └── r2-helpers/         # R2 storage utilities
├── public/                 # Static assets
└── test/                   # Test files
```

## Security Features

- **Authentication**: API key-based authentication
- **Rate Limiting**: Configurable request limits per IP
- **CORS**: Configurable cross-origin resource sharing
- **Input Validation**: Comprehensive request validation
- **Attack Protection**: Built-in protection against common attacks
- **Security Headers**: Automatic security headers

## Monitoring & Observability

- **Health Checks**: Real-time provider health monitoring
- **Metrics**: Prometheus-compatible metrics endpoint
- **Logging**: Structured logging with correlation IDs
- **Error Tracking**: Comprehensive error reporting
- **Analytics**: Cloudflare Analytics Engine integration

## Deployment

### Staging Deployment

```bash
# Deploy to staging environment
wrangler deploy --env staging
```

### Production Deployment

```bash
# Deploy to production
npm run deploy
```

### Custom Domain

To use a custom domain:

1. Add your domain to Cloudflare
2. Configure the worker route in `wrangler.toml`
3. Deploy the worker

```toml
# wrangler.toml
[[routes]]
pattern = "api.yourdomain.com/*"
zone_name = "yourdomain.com"
```

## Troubleshooting

### Common Issues

1. **Provider Not Available**: Check if API keys are correctly set and providers are enabled
2. **Rate Limited**: Increase rate limit settings or use bypass key
3. **CORS Errors**: Configure allowed origins in environment variables
4. **Authentication Failed**: Verify API key is correct

### Debug Mode

Enable debug logging by setting `LOG_LEVEL=debug` in your environment.

### Health Check

Use the `/health` endpoint to check the status of all providers and the overall system health.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.