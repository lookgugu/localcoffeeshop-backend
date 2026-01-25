#!/bin/bash
# Deployment Verification Script
# Run this locally before deploying to catch common issues

echo "🔍 Verifying deployment readiness..."
echo ""

# Track if any warnings occurred
warnings=0
errors=0

# Check if required files exist
echo "✓ Checking required files..."
files=("server.js" "package.json" "coffee_shops.db" ".do/app.yaml")
for file in "${files[@]}"; do
    if [ ! -f "$file" ]; then
        echo "  ❌ Missing required file: $file"
        ((errors++))
    else
        echo "  ✓ $file exists"
    fi
done
echo ""

# Check database file size
echo "✓ Checking database..."
if [ -f "coffee_shops.db" ]; then
    db_size=$(du -h coffee_shops.db | cut -f1)
    echo "  ✓ Database size: $db_size"
    if [ ! -s coffee_shops.db ]; then
        echo "  ❌ Database file is empty"
        ((errors++))
    fi
else
    echo "  ❌ Database file not found"
    ((errors++))
fi
echo ""

# Check Node.js version
echo "✓ Checking Node.js version..."
if command -v node &> /dev/null; then
    node_version=$(node --version)
    echo "  ✓ Node.js $node_version"

    # Extract major version number
    major_version=$(echo "$node_version" | sed 's/v\([0-9]*\).*/\1/')
    if [ "$major_version" -lt 14 ]; then
        echo "  ⚠️  Warning: Node.js 14+ recommended, 20+ preferred"
        ((warnings++))
    fi
else
    echo "  ❌ Node.js not found"
    ((errors++))
fi
echo ""

# Check npm
echo "✓ Checking npm..."
if command -v npm &> /dev/null; then
    npm_version=$(npm --version)
    echo "  ✓ npm $npm_version"
else
    echo "  ❌ npm not found"
    ((errors++))
fi
echo ""

# Check npm dependencies
echo "✓ Checking dependencies..."
if [ ! -d "node_modules" ]; then
    echo "  ℹ️  node_modules not found"
    echo "  ℹ️  Run 'npm install' to install dependencies"
    echo "  ℹ️  (Dependencies will be installed automatically on Digital Ocean)"
else
    echo "  ✓ Dependencies installed locally"
fi
echo ""

# Verify package.json has required scripts
echo "✓ Checking package.json scripts..."
if grep -q '"start"' package.json; then
    echo "  ✓ 'start' script found"
else
    echo "  ❌ 'start' script missing in package.json"
    ((errors++))
fi
echo ""

# Test database connection (if sqlite3 is available)
echo "✓ Testing database..."
if command -v sqlite3 &> /dev/null && [ -f "coffee_shops.db" ]; then
    if shop_count=$(sqlite3 coffee_shops.db "SELECT COUNT(*) FROM coffee_shops;" 2>/dev/null); then
        echo "  ✓ Database contains $shop_count coffee shops"
    else
        echo "  ⚠️  Unable to query database"
        ((warnings++))
    fi
else
    echo "  ℹ️  sqlite3 not installed, skipping database query test"
fi
echo ""

# Check if .env.example exists
echo "✓ Checking environment configuration..."
if [ -f ".env.example" ]; then
    echo "  ✓ .env.example exists"
    echo "  ℹ️  Remember to set environment variables in Digital Ocean dashboard:"
    echo "      - NODE_ENV=production"
    echo "      - PORT=8080"
    echo "      - LOG_LEVEL=info"
else
    echo "  ⚠️  .env.example not found"
    ((warnings++))
fi
echo ""

# Check if port 3000 or 8080 is already in use
echo "✓ Checking ports..."
if command -v lsof &> /dev/null; then
    if lsof -i:3000 &> /dev/null; then
        echo "  ⚠️  Port 3000 is already in use (won't affect DO deployment)"
        ((warnings++))
    else
        echo "  ✓ Port 3000 is available"
    fi
else
    echo "  ℹ️  lsof not available, skipping port check"
fi
echo ""

# Test that server.js can be loaded (syntax check)
echo "✓ Testing server.js syntax..."
if node -c server.js 2>/dev/null; then
    echo "  ✓ server.js syntax is valid"
else
    echo "  ❌ server.js has syntax errors"
    echo "  ℹ️  Run 'node -c server.js' to see details"
    ((errors++))
fi
echo ""

# Verify app.yaml configuration
echo "✓ Checking app.yaml configuration..."
if [ -f ".do/app.yaml" ]; then
    if grep -q "repo: lookgugu/localcoffeeshop.co" .do/app.yaml; then
        echo "  ⚠️  Remember to update GitHub repo in .do/app.yaml with your repository"
        ((warnings++))
    else
        echo "  ✓ app.yaml appears to be configured"
    fi

    # Check for required fields
    if grep -q "run_command:" .do/app.yaml && grep -q "http_port:" .do/app.yaml; then
        echo "  ✓ app.yaml has required fields"
    else
        echo "  ⚠️  app.yaml may be missing required fields"
        ((warnings++))
    fi
else
    echo "  ❌ app.yaml not found"
    ((errors++))
fi
echo ""

# Check file sizes for deployment
echo "✓ Checking deployment size..."
if command -v du &> /dev/null; then
    total_size=$(du -sh . 2>/dev/null | cut -f1)
    echo "  ✓ Total size: $total_size"

    if [ -d "node_modules" ]; then
        node_size=$(du -sh node_modules 2>/dev/null | cut -f1)
        echo "  ℹ️  node_modules: $node_size (will be rebuilt on deployment)"
    fi

    # Check if database is too large
    if [ -f "coffee_shops.db" ]; then
        db_bytes=$(du -b coffee_shops.db 2>/dev/null | cut -f1)
        if [ "$db_bytes" -gt 104857600 ]; then  # 100MB
            echo "  ⚠️  Database is large (>100MB), deployment may be slow"
            ((warnings++))
        fi
    fi
else
    echo "  ℹ️  du not available, skipping size check"
fi
echo ""

# Check git status
echo "✓ Checking git status..."
if command -v git &> /dev/null && [ -d ".git" ]; then
    if [ -n "$(git status --porcelain)" ]; then
        echo "  ⚠️  You have uncommitted changes"
        echo "  ℹ️  Commit and push before deploying"
        ((warnings++))
    else
        echo "  ✓ Working directory is clean"
    fi

    # Check if we're on main branch
    current_branch=$(git branch --show-current)
    if [ "$current_branch" != "main" ]; then
        echo "  ⚠️  Current branch: $current_branch (app.yaml deploys from 'main')"
        ((warnings++))
    else
        echo "  ✓ On main branch"
    fi
else
    echo "  ℹ️  Not a git repository or git not installed"
fi
echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $errors -eq 0 ] && [ $warnings -eq 0 ]; then
    echo "✅ Deployment verification complete! No issues found."
elif [ $errors -eq 0 ]; then
    echo "✅ Deployment verification complete with $warnings warning(s)."
    echo "⚠️  Review warnings above before deploying."
else
    echo "❌ Deployment verification failed with $errors error(s) and $warnings warning(s)."
    echo "🔧 Fix the errors above before deploying."
    exit 1
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ $errors -eq 0 ]; then
    echo "Next steps:"
    echo "1. ✓ Commit and push your code to GitHub (if you have changes)"
    echo "2. → Go to https://cloud.digitalocean.com/apps"
    echo "3. → Create new app and link your repository"
    echo "4. → Set environment variables:"
    echo "     • NODE_ENV=production"
    echo "     • PORT=8080"
    echo "     • LOG_LEVEL=info"
    echo "5. → Deploy!"
    echo ""
    echo "📚 See DEPLOYMENT.md for detailed step-by-step instructions."
fi
