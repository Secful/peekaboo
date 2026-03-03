# 🚀 Peekaboo Quick Start

Get Peekaboo running in **3 easy steps**!

## Step 1: Install Docker Desktop

Download and install Docker Desktop for Mac:
**👉 https://www.docker.com/products/docker-desktop/**

After installing, launch Docker from your Applications folder.

## Step 2: Run the Start Script

Open **Terminal** and navigate to this folder:

```bash
cd /path/to/peekaboo
```

Then run:

```bash
./start.sh
```

The script will:
- ✅ Check Docker is running
- ✅ Build the Peekaboo image (takes 2-3 minutes first time)
- ✅ Auto-detect AWS credentials (if configured)
- ✅ Start the container

> **Note:** AWS credentials are optional. If you have AWS CLI configured (`aws configure`), the script automatically enables proxy support and AI descriptions.

## Step 3: Open Peekaboo

Open your browser and go to:

```
http://localhost:8187
```

**That's it!** 🎉

---

## Your First Scan

1. Enter a website URL (try `httpbin.org` first)
2. Click **Start Scan**
3. Watch the Live Preview as pages are crawled
4. See discovered API endpoints in the table
5. Click **Export to HTML** to save your results

---

## Need Help?

- **Full Installation Guide**: See [INSTALL.md](INSTALL.md)
- **AWS Setup** (optional): See [INSTALL.md#aws-setup](INSTALL.md#aws-setup-optional)
- **Troubleshooting**: See [INSTALL.md#troubleshooting](INSTALL.md#troubleshooting)
- **Project Details**: See [README.md](README.md)

---

## Stop/Restart Peekaboo

**Stop:**
```bash
docker stop peekaboo
```

**Start again:**
```bash
docker start peekaboo
```

**Or use the script:**
```bash
./start.sh
```

---

**Happy scanning! 🕷️**
