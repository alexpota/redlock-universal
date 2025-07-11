#!/bin/bash

# Docker Integration Test Script
# Starts Redis instances and runs comprehensive integration tests

set -e

echo "🐳 Starting Redis Docker containers for integration tests..."

# Detect docker compose command (newer versions use 'docker compose', older use 'docker-compose')
if command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE="docker-compose"
elif docker compose version &> /dev/null; then
    DOCKER_COMPOSE="docker compose"
else
    echo "❌ Neither 'docker-compose' nor 'docker compose' found. Please install Docker Compose."
    exit 1
fi

echo "ℹ️ Using: $DOCKER_COMPOSE"

# Function to cleanup on exit
cleanup() {
    echo "🧹 Cleaning up Docker containers..."
    $DOCKER_COMPOSE -f docker-compose.test.yml down -v
}
trap cleanup EXIT

# Start Redis containers
echo "🚀 Starting Redis containers..."
$DOCKER_COMPOSE -f docker-compose.test.yml up -d redis-1 redis-2 redis-3 redis-4 redis-5

# Wait for all Redis instances to be healthy
echo "⏳ Waiting for Redis instances to be ready..."
for i in {1..30}; do
    if $DOCKER_COMPOSE -f docker-compose.test.yml ps | grep -q "healthy"; then
        healthy_count=$($DOCKER_COMPOSE -f docker-compose.test.yml ps | grep "healthy" | wc -l)
        if [ "$healthy_count" -eq 5 ]; then
            echo "✅ All Redis instances are healthy!"
            break
        fi
    fi
    echo "⏳ Waiting for Redis instances... ($i/30)"
    sleep 2
done

# Check if all instances are healthy
healthy_count=$($DOCKER_COMPOSE -f docker-compose.test.yml ps | grep "healthy" | wc -l)
if [ "$healthy_count" -ne 5 ]; then
    echo "❌ Not all Redis instances are healthy. Exiting..."
    $DOCKER_COMPOSE -f docker-compose.test.yml ps
    exit 1
fi

echo "🧪 Running integration tests..."

# Set environment variables for local testing
export REDIS_1_HOST=localhost
export REDIS_1_PORT=6379
export REDIS_2_HOST=localhost
export REDIS_2_PORT=6380
export REDIS_3_HOST=localhost
export REDIS_3_PORT=6381
export REDIS_4_HOST=localhost
export REDIS_4_PORT=6382
export REDIS_5_HOST=localhost
export REDIS_5_PORT=6383
export NODE_ENV=test

# Run integration tests
echo "🔬 Running unit tests (fast, no Redis required)..."
npm test

echo "🔬 Running integration and e2e tests..."
npm run test:integration

echo "🔬 Running all tests with coverage..."
npm run test:coverage

echo "✅ All integration tests completed successfully!"

# Optional: Run example scripts to verify everything works
echo "🎯 Running usage examples..."
if [ -f "examples/simple-lock-usage.ts" ]; then
    echo "Running SimpleLock examples..."
    npx tsx examples/simple-lock-usage.ts
fi

if [ -f "examples/redlock-usage.ts" ]; then
    echo "Running RedLock examples..."
    # Note: RedLock examples might need actual multiple Redis servers
    echo "RedLock examples ready to run (requires manual execution due to complexity)"
fi

echo "🎉 Docker integration testing complete!"