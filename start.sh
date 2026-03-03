#!/bin/bash

# Peekaboo Visual API Crawler - Quick Start Script
# For macOS users

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo "════════════════════════════════════════════════════════"
echo "  🔍 Peekaboo Visual API Crawler"
echo "════════════════════════════════════════════════════════"
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed${NC}"
    echo ""
    echo "Please install Docker Desktop from:"
    echo "https://www.docker.com/products/docker-desktop/"
    echo ""
    exit 1
fi

# Check if Docker is running
if ! docker info &> /dev/null; then
    echo -e "${RED}❌ Docker is not running${NC}"
    echo ""
    echo "Please start Docker Desktop from your Applications folder"
    echo ""
    exit 1
fi

echo -e "${GREEN}✓${NC} Docker is running"

# Check if container already exists
if docker ps -a --format '{{.Names}}' | grep -q "^peekaboo$"; then
    echo ""
    echo -e "${YELLOW}⚠${NC}  Peekaboo container already exists"
    echo ""
    echo "What would you like to do?"
    echo "  1) Start existing container"
    echo "  2) Rebuild and restart"
    echo "  3) Cancel"
    echo ""
    read -p "Enter choice [1-3]: " choice

    case $choice in
        1)
            echo ""
            echo "Starting existing container..."
            docker start peekaboo
            ;;
        2)
            echo ""
            echo "Stopping and removing old container..."
            docker stop peekaboo 2>/dev/null || true
            docker rm peekaboo 2>/dev/null || true
            echo "Removing old image..."
            docker rmi peekaboo 2>/dev/null || true

            echo ""
            echo "Building Docker image (this may take 2-3 minutes)..."
            docker build -t peekaboo .

            echo ""
            echo "Starting Peekaboo..."

            # Build docker run command with AWS credentials
            DOCKER_CMD="docker run -d -p 8187:8187"

            # Check for AWS credentials (in order of preference)
            if [ -d "$HOME/.aws" ]; then
                # Mount AWS credentials directory (best option)
                echo -e "${GREEN}✓${NC} Found AWS credentials at ~/.aws"
                DOCKER_CMD="$DOCKER_CMD -v $HOME/.aws:/root/.aws:ro"
            elif [ -f ".env" ]; then
                # Use .env file
                echo -e "${GREEN}✓${NC} Found .env file, using AWS credentials"
                DOCKER_CMD="$DOCKER_CMD --env-file .env"
            elif [ -n "$AWS_ACCESS_KEY_ID" ] && [ -n "$AWS_SECRET_ACCESS_KEY" ]; then
                # Use environment variables
                echo -e "${GREEN}✓${NC} Using AWS credentials from environment"
                DOCKER_CMD="$DOCKER_CMD -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION"
            else
                echo -e "${YELLOW}ℹ${NC}  No AWS credentials found (running in basic mode)"
                echo "   To enable AWS features:"
                echo "   - Run 'aws configure' to set up credentials"
                echo "   - Or create a .env file (see .env.example)"
            fi

            # Run container
            $DOCKER_CMD --name peekaboo peekaboo
            ;;
        3)
            echo "Cancelled"
            exit 0
            ;;
        *)
            echo -e "${RED}Invalid choice${NC}"
            exit 1
            ;;
    esac
else
    # First time setup
    echo ""
    echo "Building Docker image (this may take 2-3 minutes)..."
    docker build -t peekaboo .

    echo ""
    echo "Starting Peekaboo..."

    # Build docker run command with AWS credentials
    DOCKER_CMD="docker run -d -p 8187:8187"

    # Check for AWS credentials (in order of preference)
    if [ -d "$HOME/.aws" ]; then
        # Mount AWS credentials directory (best option)
        echo -e "${GREEN}✓${NC} Found AWS credentials at ~/.aws"
        DOCKER_CMD="$DOCKER_CMD -v $HOME/.aws:/root/.aws:ro"
    elif [ -f ".env" ]; then
        # Use .env file
        echo -e "${GREEN}✓${NC} Found .env file, using AWS credentials"
        DOCKER_CMD="$DOCKER_CMD --env-file .env"
    elif [ -n "$AWS_ACCESS_KEY_ID" ] && [ -n "$AWS_SECRET_ACCESS_KEY" ]; then
        # Use environment variables
        echo -e "${GREEN}✓${NC} Using AWS credentials from environment"
        DOCKER_CMD="$DOCKER_CMD -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION"
    else
        echo -e "${YELLOW}ℹ${NC}  No AWS credentials found (running in basic mode)"
        echo "   To enable AWS features:"
        echo "   - Run 'aws configure' to set up credentials"
        echo "   - Or create a .env file (see .env.example)"
    fi

    # Run container
    $DOCKER_CMD --name peekaboo peekaboo
fi

# Wait for container to be ready
echo ""
echo "Waiting for Peekaboo to start..."
sleep 3

# Check if container is running
if docker ps --format '{{.Names}}' | grep -q "^peekaboo$"; then
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  ✅ Peekaboo is now running!${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "Open your browser and go to:"
    echo ""
    echo -e "${BLUE}  http://localhost:8187${NC}"
    echo ""
    echo "To view logs:"
    echo "  docker logs -f peekaboo"
    echo ""
    echo "To stop Peekaboo:"
    echo "  docker stop peekaboo"
    echo ""
else
    echo ""
    echo -e "${RED}❌ Failed to start Peekaboo${NC}"
    echo ""
    echo "Check logs with:"
    echo "  docker logs peekaboo"
    echo ""
    exit 1
fi
