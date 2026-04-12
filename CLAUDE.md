# Visual Crawler — Claude Code Instructions

## Deployment

**Deploy command:**
```bash
unset AWS_PROFILE && bash scripts/deploy.sh
```

**Details:**
- Always run the deploy command above when asked to deploy — no confirmation needed
- Uses default AWS credentials from ~/.aws/credentials (account 329599622528)
- Region: us-east-1
- Deploys to AWS ECS Fargate (Docker build → ECR push → ECS service update)
- IMPORTANT: Never use AWS_PROFILE (especially not "bedrock")
