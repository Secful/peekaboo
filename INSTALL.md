# Peekaboo Visual API Crawler - Installation Guide

A simple tool to discover API endpoints by crawling websites and analyzing network traffic.

## Prerequisites

- **macOS** (Intel or Apple Silicon)
- **Docker Desktop** - [Download here](https://www.docker.com/products/docker-desktop/)

## Installation Steps

### 1. Install Docker Desktop

1. Download Docker Desktop from https://www.docker.com/products/docker-desktop/
2. Open the downloaded `.dmg` file
3. Drag Docker to your Applications folder
4. Launch Docker from Applications
5. Wait for Docker to start (you'll see the Docker icon in your menu bar)

### 2. Download Peekaboo

Download the Peekaboo package (ZIP file) and extract it to a folder on your computer.

### 3. Build and Run Peekaboo

Open **Terminal** (Applications → Utilities → Terminal) and navigate to the extracted folder:

```bash
cd /path/to/peekaboo
```

#### Build the Docker Image

```bash
docker build -t peekaboo .
```

This will take 2-3 minutes the first time. You'll see progress messages.

#### Run Peekaboo

**Option 1: Use start.sh (Recommended)**
```bash
./start.sh
```
This script automatically detects and mounts your AWS credentials if available.

**Option 2: Manual Docker Command**

*Basic Mode (No AWS):*
```bash
docker run -d -p 8187:8187 --name peekaboo peekaboo
```

*With AWS Credentials:*
```bash
docker run -d -p 8187:8187 \
  -v ~/.aws:/root/.aws:ro \
  --name peekaboo peekaboo
```

**What this does:**
- `-d` - Runs in background
- `-p 8187:8187` - Makes it accessible at http://localhost:8187
- `-v ~/.aws:/root/.aws:ro` - (Optional) Mounts your AWS credentials
- `--name peekaboo` - Names the container "peekaboo"

### AWS Features (Optional)

AWS credentials enable two optional features:

1. **🔐 Proxy Support** - Uses BrightData proxies from AWS Secrets Manager for scanning protected sites
2. **🤖 AI Descriptions** - Generates API endpoint descriptions using AWS Bedrock (Claude AI)

> **Without AWS:** Peekaboo works fine using your computer's IP and without AI descriptions.

### Enable AWS Features

**Easy way:** If you have AWS CLI configured, you're done! The `start.sh` script automatically mounts `~/.aws/credentials`.

**Manual setup:**
```bash
# Install AWS CLI (if not installed)
brew install awscli

# Configure credentials
aws configure
# Enter: Access Key ID, Secret Access Key, Region (us-east-1)

# Run start.sh (it will auto-detect credentials)
./start.sh
```

### 4. Access Peekaboo

Open your web browser and go to:

```
http://localhost:8187
```

You should see the Peekaboo dashboard! 🎉

## Using Peekaboo

### Start a Scan

1. Enter a website URL (e.g., `example.com`)
2. Configure scan options:
   - **Max Pages**: How many pages to crawl (default: 50)
   - **Max Depth**: How deep to crawl links (default: 3)
   - **Concurrent Pages**: How many pages to scan at once (default: 5)
   - **Fast Mode**: Skip screenshots for faster scanning
   - **Stealth Mode**: Use anti-detection features
3. Click **Start Scan**

### View Results

- **Live Preview**: See screenshots of pages being crawled
- **Discovered Endpoints**: Table of all API endpoints found
- **Statistics**: Pages visited, queue size, endpoints discovered

### Export Results

Click **Export to HTML** to save a detailed report with:
- All discovered endpoints
- Screenshots of crawled pages
- Request/response details
- Timestamps

## Managing the Container

### View Logs

```bash
docker logs -f peekaboo
```

Press `Ctrl+C` to stop viewing logs.

### Stop Peekaboo

```bash
docker stop peekaboo
```

### Start Again

```bash
docker start peekaboo
```

### Remove Container

```bash
docker stop peekaboo
docker rm peekaboo
```

### Rebuild After Updates

If you download a new version:

```bash
# Stop and remove old container
docker stop peekaboo
docker rm peekaboo

# Remove old image
docker rmi peekaboo

# Rebuild
docker build -t peekaboo .

# Run again
docker run -d -p 8187:8187 --name peekaboo peekaboo
```

## Troubleshooting

### "Port 8187 is already in use"

Another application is using port 8187. Either:

**Option 1: Stop the other application**

**Option 2: Use a different port**
```bash
docker run -d -p 9000:8187 --name peekaboo peekaboo
```
Then access at http://localhost:9000

### "Cannot connect to Docker daemon"

Docker Desktop is not running. Start Docker Desktop from Applications.

### "docker: command not found"

Docker is not installed or not in your PATH. Restart Terminal after installing Docker Desktop.

### Scan completes too quickly

Some websites have aggressive bot protection. Try:
- Scanning less protected sites first (e.g., `httpbin.org`)
- Enabling **Stealth Mode**
- Reducing **Concurrent Pages** to 1 or 2

### No screenshots appearing

- Make sure **Fast Mode** is OFF
- Check that the website allows your connection
- Look at the logs: `docker logs peekaboo`

## Tips for Best Results

### Good Sites to Scan

✅ **Works well:**
- Public APIs and testing sites (httpbin.org, jsonplaceholder.typicode.com)
- Corporate websites without aggressive protection
- Documentation sites

❌ **May not work:**
- Sites with CAPTCHA on every page
- Sites using Cloudflare with aggressive settings
- Sites that block automated traffic

### Optimize Scan Settings

**For quick exploration:**
- Max Pages: 20
- Max Depth: 2
- Fast Mode: ON

**For thorough discovery:**
- Max Pages: 100
- Max Depth: 4
- Fast Mode: OFF
- Stealth Mode: ON

**If getting blocked:**
- Concurrent Pages: 1
- Stealth Mode: ON
- Min Delay: 3 seconds
- Max Delay: 6 seconds

## System Requirements

- **RAM**: 4GB minimum, 8GB recommended
- **Disk**: 5GB free space (for Docker images)
- **Network**: Internet connection
- **Browser**: Chrome, Firefox, Safari, or Edge

## Support

For issues or questions:
1. Check the [Troubleshooting](#troubleshooting) section
2. Review logs: `docker logs peekaboo`
3. File an issue on GitHub (if applicable)

## AWS Setup (Optional)

### Prerequisites

- AWS Account
- AWS CLI installed (optional, for easier setup)

### Step 1: Create IAM User

1. Go to [AWS IAM Console](https://console.aws.amazon.com/iam/)
2. Click **Users** → **Add users**
3. Username: `peekaboo-user`
4. Click **Next**
5. Select **Attach policies directly**
6. Add these permissions:
   - `SecretsManagerReadWrite` (for proxy configuration)
   - `AmazonBedrockFullAccess` (for AI descriptions)
7. Click **Next** → **Create user**

### Step 2: Create Access Key

1. Click on the newly created user
2. Go to **Security credentials** tab
3. Scroll to **Access keys**
4. Click **Create access key**
5. Choose **Application running outside AWS**
6. Click **Next** → **Create access key**
7. **Important:** Save the **Access key ID** and **Secret access key** (you won't see the secret again!)

### Step 3: Configure Proxy (Optional)

If you have BrightData proxy credentials:

1. Go to [AWS Secrets Manager](https://console.aws.amazon.com/secretsmanager/)
2. Click **Store a new secret**
3. Choose **Other type of secret**
4. Add key/value pairs:
   ```
   host: brd.superproxy.io
   port: 22225
   username: brd-customer-YOUR_ID-zone-residential_proxy1
   password: YOUR_PASSWORD
   pool_size: 5
   ```
5. Secret name: `peekaboo/proxy`
6. Click **Next** → **Next** → **Store**

#### Enable BrightData Scraping Browser (Advanced)

For sites with heavy Cloudflare/CAPTCHA protection, you can enable BrightData's Scraping Browser with built-in anti-bot features:

1. In AWS Secrets Manager, edit the `peekaboo/proxy` secret
2. Add these additional fields to the existing secret:
   ```
   enable_scraping_browser: true
   scraping_browser_zone: scraping_browser1
   ```
3. Ensure your BrightData account has a Scraping Browser zone enabled
4. Restart Peekaboo: `docker restart peekaboo`

**When to use Scraping Browser:**
- ✅ Sites with CAPTCHA challenges (e.g., zap.co.il, qantas.com, rsaconference.com)
- ✅ Sites blocking residential proxies
- ✅ Sites with aggressive Cloudflare protection
- ✅ Sites that detect and block automation tools

**How it works:**
- Uses remote cloud-based browser with built-in anti-bot countermeasures
- Automatically solves CAPTCHAs transparently
- Manages fresh residential IPs with browser fingerprint management
- More expensive than proxy-only mode - use for protected sites only

**Verification:**
After enabling, check logs for confirmation:
```bash
docker logs peekaboo | grep -i "scraping browser"
```
Should see: `🌐 BrightData Scraping Browser enabled (zone: scraping_browser1)`

### Step 4: Enable Bedrock (Optional)

For AI-powered API descriptions:

1. Go to [AWS Bedrock Console](https://console.aws.amazon.com/bedrock/)
2. Click **Model access** in the left sidebar
3. Click **Manage model access**
4. Enable **Anthropic Claude** models
5. Click **Save changes**

### Step 5: Configure AWS CLI

```bash
# Install AWS CLI (if not already installed)
brew install awscli

# Configure with your credentials
aws configure
# Enter your Access Key ID
# Enter your Secret Access Key
# Default region: us-east-1
# Default output format: json
```

### Step 6: Run Peekaboo

```bash
./start.sh
```

The script will automatically detect and mount your AWS credentials.

### Verify AWS Features

After starting with AWS credentials:

1. Check logs for proxy initialization:
   ```bash
   docker logs peekaboo | grep -i proxy
   ```
   Should see: `✅ Loaded BrightData proxy pool with 5 proxies`

2. Check AI descriptions:
   - Start a scan
   - Click on any discovered endpoint
   - Click **Generate Description** button
   - Should see AI-generated description

## Version

Check your version at http://localhost:8187 (click "About" button)

Current version: 0.5

---

**Happy crawling! 🕷️**
