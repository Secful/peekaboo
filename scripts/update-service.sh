#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# Peekaboo — Rebuild image and force new ECS deployment
###############################################################################

PREFIX="peekaboo"
REGION="${AWS_REGION:-us-east-1}"
IMAGE_TAG="latest"

ECR_REPO="${PREFIX}-repo"
CLUSTER_NAME="${PREFIX}-cluster"
SERVICE_NAME="${PREFIX}-service"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPO}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "${SCRIPT_DIR}")"

echo "▸ Building and pushing Docker image..."
aws ecr get-login-password --region "${REGION}" | \
  docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

docker build --platform linux/amd64 -t "${ECR_REPO}:${IMAGE_TAG}" "${PROJECT_DIR}"
docker tag "${ECR_REPO}:${IMAGE_TAG}" "${ECR_URI}:${IMAGE_TAG}"
docker push "${ECR_URI}:${IMAGE_TAG}"
echo "  ✔ Image pushed to ${ECR_URI}:${IMAGE_TAG}"

echo "▸ Forcing new deployment..."
aws ecs update-service \
  --cluster "${CLUSTER_NAME}" \
  --service "${SERVICE_NAME}" \
  --force-new-deployment \
  --region "${REGION}" > /dev/null

echo "  ✔ Deployment triggered. New task will pull the latest image."
echo "  Run 'bash scripts/logs.sh' to monitor startup."
