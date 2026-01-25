#!/bin/bash
# Quick Backend Test Script

echo "🧪 Testing Local Coffee Shop Backend..."
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

BASE_URL="http://localhost:3000"

# Check if server is running
echo -n "1. Checking if server is running... "
if curl -s "${BASE_URL}/api/v1/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    echo -e "${YELLOW}Backend server is not running!${NC}"
    echo "Start it with: npm run dev"
    exit 1
fi

# Test health endpoint
echo -n "2. Testing /api/v1/health... "
HEALTH=$(curl -s "${BASE_URL}/api/v1/health")
if echo "$HEALTH" | grep -q '"status":"ok"'; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    echo "Response: $HEALTH"
fi

# Test config endpoint
echo -n "3. Testing /api/v1/config... "
CONFIG=$(curl -s "${BASE_URL}/api/v1/config")
if echo "$CONFIG" | grep -q '"frontendUrl"'; then
    echo -e "${GREEN}✓${NC}"
    FRONTEND_URL=$(echo "$CONFIG" | grep -o '"frontendUrl":"[^"]*"' | cut -d'"' -f4)
    echo "   Frontend URL: $FRONTEND_URL"
else
    echo -e "${RED}✗${NC}"
    echo "Response: $CONFIG"
fi

# Test states endpoint
echo -n "4. Testing /api/v1/states... "
STATES=$(curl -s "${BASE_URL}/api/v1/states")
if echo "$STATES" | grep -q '"state"'; then
    COUNT=$(echo "$STATES" | grep -o '"state"' | wc -l)
    echo -e "${GREEN}✓${NC}"
    echo "   Found $COUNT states"
else
    echo -e "${RED}✗${NC}"
    echo "Response: $STATES"
fi

# Test California endpoint
echo -n "5. Testing /api/v1/states/CA... "
CA_SHOPS=$(curl -s "${BASE_URL}/api/v1/states/CA")
if echo "$CA_SHOPS" | grep -q '"displayName"'; then
    COUNT=$(echo "$CA_SHOPS" | grep -o '"displayName"' | wc -l)
    echo -e "${GREEN}✓${NC}"
    echo "   Found $COUNT shops in CA"
else
    echo -e "${RED}✗${NC}"
    echo "Response: $CA_SHOPS"
fi

# Test search endpoint
echo -n "6. Testing /api/v1/search?q=coffee... "
SEARCH=$(curl -s "${BASE_URL}/api/v1/search?q=coffee")
if echo "$SEARCH" | grep -q '"displayName"'; then
    COUNT=$(echo "$SEARCH" | grep -o '"displayName"' | wc -l)
    echo -e "${GREEN}✓${NC}"
    echo "   Found $COUNT results"
else
    echo -e "${RED}✗${NC}"
    echo "Response: $SEARCH"
fi

# Test CORS headers
echo -n "7. Testing CORS headers... "
CORS=$(curl -s -I -H "Origin: http://localhost:8080" \
    -H "Access-Control-Request-Method: GET" \
    -X OPTIONS \
    "${BASE_URL}/api/v1/states")
if echo "$CORS" | grep -q "Access-Control-Allow-Origin"; then
    echo -e "${GREEN}✓${NC}"
    ORIGIN=$(echo "$CORS" | grep "Access-Control-Allow-Origin" | cut -d':' -f2- | tr -d ' \r')
    echo "   Allowed origin: $ORIGIN"
else
    echo -e "${RED}✗${NC}"
    echo "CORS headers missing!"
fi

# Test database
echo -n "8. Checking database file... "
if [ -f "data/coffee_shops.db" ]; then
    SIZE=$(du -h data/coffee_shops.db | cut -f1)
    echo -e "${GREEN}✓${NC}"
    echo "   Database size: $SIZE"
else
    echo -e "${RED}✗${NC}"
    echo "Database file not found!"
fi

echo ""
echo -e "${GREEN}✅ Backend tests complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Keep this terminal running with the backend server"
echo "2. In a new terminal, test the frontend with: cd ../localcoffeeshop-frontend && npm run dev"
