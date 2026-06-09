# Local Coffee Shop - Backend API

Backend API server for the Local Coffee Shop directory application.

## Overview

Express.js REST API server with SQLite database containing US coffee shop data.

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: SQLite (22MB)
- **Security**: Helmet.js, CORS, Rate Limiting
- **Logging**: Pino
- **Monitoring**: Prometheus metrics

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
npm install
```

### Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Required environment variables:
- `PORT` - Server port (default: 3000)
- `DB_PATH` - Path to SQLite database
- `CORS_ORIGIN` - Allowed frontend origins (comma-separated)
- `FRONTEND_URL` - Frontend base URL for generating links

### Running Locally

```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
```

Server runs at `http://localhost:3000`

## API Endpoints

### Base URL: `/api/v1`

- `GET /health` - Health check endpoint
- `GET /config` - Client configuration (GA ID, frontend URL)
- `GET /states` - List all states with shop counts
- `GET /states/:stateCode` - Get all shops for a state
- `GET /search` - Search shops with filters (query, state, price)
- `GET /nearby` - Search coordinate-bearing shops near `lat`/`lon` (or `lng`)
- `GET /stats` - Database statistics

### Example Requests

```bash
# Get all states
curl http://localhost:3000/api/v1/states

# Get California shops
curl http://localhost:3000/api/v1/states/CA

# Search with filters
curl "http://localhost:3000/api/v1/search?q=coffee&state=CA&price=PRICE_LEVEL_MODERATE"

# Search for shops near Concord, MA
curl "http://localhost:3000/api/v1/nearby?lat=42.4604&lon=-71.3489&limit=10"
```

## Database

SQLite database located at `data/coffee_shops.db` (22MB).

### Schema

```sql
CREATE TABLE coffee_shops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    price_level TEXT,
    language_code TEXT DEFAULT 'en',
    source_file TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    state TEXT,
    latitude REAL,
    longitude REAL
)
```

### Database Operations

```bash
# Run migrations
npm run migrate

# Import coordinates after migration (CSV columns: id,latitude,longitude)
DB_PATH=data/coffee_shops.db npm run import:coordinates -- coordinates.csv

# Backup database
npm run backup

# Query directly
sqlite3 data/coffee_shops.db
```

## Security

- **Rate Limiting**: 100 requests per 15 minutes per IP
- **CORS**: Configurable allowed origins
- **CSP**: Content Security Policy headers
- **Input Validation**: Parameterized queries, sanitized inputs
- **Request Size Limit**: 10KB max body size

## Testing

```bash
npm test
```

## Deployment

### DigitalOcean App Platform

Configured via `.do/app.yaml`. Auto-deploys from main branch.

```bash
git push origin main
```

### Environment Variables (Production)

Set in DigitalOcean dashboard:
- `NODE_ENV=production`
- `CORS_ORIGIN=https://localcoffeeshop.co`
- `FRONTEND_URL=https://localcoffeeshop.co`
- `METRICS_AUTH_TOKEN` (secret)
- `GA_MEASUREMENT_ID`

## Monitoring

- Health check: `/api/v1/health`
- Metrics: `/metrics` (Prometheus format)

## License

MIT
