# Local Testing Guide - Backend

## Quick Start

### 1. Install Dependencies
```bash
cd /Users/beno/Documents/Projects/localcoffeeshop-backend
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
```

Edit `.env` for local development:
```bash
PORT=3000
NODE_ENV=development
DB_PATH=./data/coffee_shops.db
CORS_ORIGIN=http://localhost:8080
FRONTEND_URL=http://localhost:8080
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
GA_MEASUREMENT_ID=G-YVSXN7PM48
LOG_LEVEL=info
```

### 3. Start Backend Server
```bash
npm run dev
```

You should see:
```
Server running on http://localhost:3000
Database connected successfully
```

## Testing Endpoints

### Health Check
```bash
curl http://localhost:3000/api/v1/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-24T...",
  "database": "connected",
  "version": "1.0.0"
}
```

### Get Config (Frontend URL)
```bash
curl http://localhost:3000/api/v1/config
```

Expected response:
```json
{
  "gaMeasurementId": "G-YVSXN7PM48",
  "environment": "development",
  "apiVersion": "v1",
  "apiBaseUrl": "/api/v1",
  "frontendUrl": "http://localhost:8080"
}
```

### Get States
```bash
curl http://localhost:3000/api/v1/states
```

Should return array of states with shop counts.

### Get California Shops
```bash
curl http://localhost:3000/api/v1/states/CA
```

Should return coffee shops in California.

### Search
```bash
curl "http://localhost:3000/api/v1/search?q=coffee&state=CA&price=PRICE_LEVEL_MODERATE"
```

### Test CORS Headers
```bash
curl -H "Origin: http://localhost:8080" \
     -H "Access-Control-Request-Method: GET" \
     -X OPTIONS \
     http://localhost:3000/api/v1/states
```

Expected headers in response:
```
Access-Control-Allow-Origin: http://localhost:8080
Access-Control-Allow-Credentials: true
Access-Control-Allow-Methods: GET, POST, OPTIONS
```

## Common Issues

### Database Not Found
```bash
# Check database exists
ls -lh data/coffee_shops.db
# Should show ~22MB file
```

### Port Already in Use
```bash
# Kill process on port 3000
lsof -ti:3000 | xargs kill -9
```

### CORS Errors
Verify `CORS_ORIGIN=http://localhost:8080` in `.env`

## Logs

With `LOG_LEVEL=info`, you should see:
- Incoming requests
- Database queries
- CORS configuration
- Server startup info

Set `LOG_LEVEL=debug` for more verbose output.
