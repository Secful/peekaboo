#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# Peekaboo — Deploy to AWS ECS Fargate
#
# Idempotent: safe to re-run. Creates resources only when they don't exist.
# Prerequisites: aws cli v2, docker, jq
###############################################################################

# ── Configuration ────────────────────────────────────────────────────────────
PREFIX="peekaboo"
REGION="${AWS_REGION:-us-east-1}"
IMAGE_TAG="latest"
DESIRED_COUNT="${DESIRED_COUNT:-1}"
CONTAINER_PORT=8187

# Auth credentials (override via env vars)
BASIC_AUTH_USER="${BASIC_AUTH_USER:-Shufuni}"
BASIC_AUTH_PASS="${BASIC_AUTH_PASS:-l6XmIx08G21A3z4+vCqSZ5Jx}"

# Resource names derived from prefix
ECR_REPO="${PREFIX}-repo"
CLUSTER_NAME="${PREFIX}-cluster"
SERVICE_NAME="${PREFIX}-service"
TASK_FAMILY="${PREFIX}-task"
ALB_NAME="${PREFIX}-alb"
TG_NAME="${PREFIX}-tg"
ALB_SG_NAME="${PREFIX}-alb-sg"
ECS_SG_NAME="${PREFIX}-ecs-sg"
EXEC_ROLE_NAME="${PREFIX}-exec-role"
TASK_ROLE_NAME="${PREFIX}-task-role"
LOG_GROUP="/ecs/${PREFIX}"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPO}"

echo "============================================================"
echo " Peekaboo — ECS Fargate Deployment"
echo "============================================================"
echo " Region:    ${REGION}"
echo " Account:   ${ACCOUNT_ID}"
echo " Auth user: ${BASIC_AUTH_USER}"
echo "============================================================"

# ── Helper ───────────────────────────────────────────────────────────────────
wait_for() {
  local msg="$1"; shift
  echo -n "  ⏳ ${msg}..."
  "$@"
  echo " done"
}

# ── 1. ECR Repository ───────────────────────────────────────────────────────
echo ""
echo "▸ Step 1: ECR Repository"
if aws ecr describe-repositories --repository-names "${ECR_REPO}" --region "${REGION}" &>/dev/null; then
  echo "  ✔ Repository ${ECR_REPO} already exists"
else
  aws ecr create-repository --repository-name "${ECR_REPO}" --region "${REGION}" --output text > /dev/null
  echo "  ✔ Created repository ${ECR_REPO}"
fi

# ── 2. Docker Build & Push ──────────────────────────────────────────────────
echo ""
echo "▸ Step 2: Docker Build & Push"
aws ecr get-login-password --region "${REGION}" | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "${SCRIPT_DIR}")"

# Capture deploy timestamp
DEPLOY_TIME=$(date -u +"%Y-%m-%d %H:%M:%S UTC")
DEPLOY_DATE=$(date -u +"%Y-%m-%d")

docker build --platform linux/amd64 \
  --build-arg DEPLOY_TIME="${DEPLOY_TIME}" \
  --build-arg DEPLOY_DATE="${DEPLOY_DATE}" \
  -t "${ECR_REPO}:${IMAGE_TAG}" "${PROJECT_DIR}"
docker tag "${ECR_REPO}:${IMAGE_TAG}" "${ECR_URI}:${IMAGE_TAG}"
docker push "${ECR_URI}:${IMAGE_TAG}"
echo "  ✔ Image pushed to ${ECR_URI}:${IMAGE_TAG}"

# ── 3. Discover VPC & Public Subnets ─────────────────────────────────────────
echo ""
echo "▸ Step 3: Networking"

# Use VPC_ID from env, or find the first VPC that has an internet gateway
if [[ -z "${VPC_ID:-}" ]]; then
  # Find VPCs that have an internet gateway attached (i.e. can reach the internet)
  VPC_ID=$(aws ec2 describe-internet-gateways \
    --query "InternetGateways[0].Attachments[0].VpcId" --output text --region "${REGION}")
fi

if [[ -z "${VPC_ID}" || "${VPC_ID}" == "None" ]]; then
  echo "  ✘ No VPC with internet gateway found. Set VPC_ID env var." >&2
  exit 1
fi
echo "  VPC: ${VPC_ID}"

# Find public subnets (MapPublicIpOnLaunch=true) in that VPC
SUBNET_IDS=$(aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=${VPC_ID}" "Name=map-public-ip-on-launch,Values=true" \
  --query "Subnets[*].SubnetId" --output text --region "${REGION}")

if [[ -z "${SUBNET_IDS}" || "${SUBNET_IDS}" == "None" ]]; then
  echo "  ✘ No public subnets found in ${VPC_ID}. Need subnets with MapPublicIpOnLaunch=true." >&2
  exit 1
fi
SUBNET_ARRAY=(${SUBNET_IDS})
echo "  Public subnets: ${SUBNET_IDS}"

# ── 4. Security Groups ──────────────────────────────────────────────────────
echo ""
echo "▸ Step 4: Security Groups"

get_or_create_sg() {
  local name="$1" desc="$2"
  local sg_id
  sg_id=$(aws ec2 describe-security-groups \
    --filters "Name=group-name,Values=${name}" "Name=vpc-id,Values=${VPC_ID}" \
    --query "SecurityGroups[0].GroupId" --output text --region "${REGION}" 2>/dev/null)
  if [[ "${sg_id}" == "None" || -z "${sg_id}" ]]; then
    sg_id=$(aws ec2 create-security-group \
      --group-name "${name}" --description "${desc}" \
      --vpc-id "${VPC_ID}" --query "GroupId" --output text --region "${REGION}")
    echo "  ✔ Created SG ${name} (${sg_id})"
  else
    echo "  ✔ SG ${name} already exists (${sg_id})"
  fi
  echo "${sg_id}"
}

# ALB security group — allow inbound 80 from anywhere
ALB_SG_ID=$(get_or_create_sg "${ALB_SG_NAME}" "ALB security group for ${PREFIX}" | tail -1)

# Check if rule already exists before adding
EXISTING_RULE=$(aws ec2 describe-security-group-rules \
  --filters "Name=group-id,Values=${ALB_SG_ID}" \
  --query "SecurityGroupRules[?FromPort==\`80\` && ToPort==\`80\` && IpProtocol==\`tcp\` && CidrIpv4==\`0.0.0.0/0\`].SecurityGroupRuleId" \
  --output text --region "${REGION}" 2>/dev/null || true)
if [[ -z "${EXISTING_RULE}" || "${EXISTING_RULE}" == "None" ]]; then
  aws ec2 authorize-security-group-ingress --group-id "${ALB_SG_ID}" \
    --protocol tcp --port 80 --cidr 0.0.0.0/0 --region "${REGION}" > /dev/null 2>&1 || true
fi

# ECS security group — allow inbound from ALB SG only on container port
ECS_SG_ID=$(get_or_create_sg "${ECS_SG_NAME}" "ECS tasks security group for ${PREFIX}" | tail -1)

EXISTING_ECS_RULE=$(aws ec2 describe-security-group-rules \
  --filters "Name=group-id,Values=${ECS_SG_ID}" \
  --query "SecurityGroupRules[?FromPort==\`${CONTAINER_PORT}\` && ToPort==\`${CONTAINER_PORT}\` && IpProtocol==\`tcp\`].SecurityGroupRuleId" \
  --output text --region "${REGION}" 2>/dev/null || true)
if [[ -z "${EXISTING_ECS_RULE}" || "${EXISTING_ECS_RULE}" == "None" ]]; then
  aws ec2 authorize-security-group-ingress --group-id "${ECS_SG_ID}" \
    --protocol tcp --port "${CONTAINER_PORT}" \
    --source-group "${ALB_SG_ID}" --region "${REGION}" > /dev/null 2>&1 || true
fi

# ── 5. IAM Roles ────────────────────────────────────────────────────────────
echo ""
echo "▸ Step 5: IAM Roles"

create_role_if_missing() {
  local role_name="$1" trust_policy="$2"
  if aws iam get-role --role-name "${role_name}" &>/dev/null; then
    echo "  ✔ Role ${role_name} already exists"
  else
    aws iam create-role --role-name "${role_name}" \
      --assume-role-policy-document "${trust_policy}" --output text > /dev/null
    echo "  ✔ Created role ${role_name}"
  fi
}

ECS_TRUST_POLICY='{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "ecs-tasks.amazonaws.com"},
    "Action": "sts:AssumeRole"
  }]
}'

# Execution role (pull images + write logs)
create_role_if_missing "${EXEC_ROLE_NAME}" "${ECS_TRUST_POLICY}"
aws iam attach-role-policy --role-name "${EXEC_ROLE_NAME}" \
  --policy-arn "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy" 2>/dev/null || true

# Task role (Bedrock access)
create_role_if_missing "${TASK_ROLE_NAME}" "${ECS_TRUST_POLICY}"

BEDROCK_POLICY='{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:*:'${ACCOUNT_ID}':secret:peekaboo/*"
    }
  ]
}'

BEDROCK_POLICY_NAME="${PREFIX}-bedrock-policy"
BEDROCK_POLICY_ARN="arn:aws:iam::${ACCOUNT_ID}:policy/${BEDROCK_POLICY_NAME}"
if ! aws iam get-policy --policy-arn "${BEDROCK_POLICY_ARN}" &>/dev/null; then
  BEDROCK_POLICY_ARN=$(aws iam create-policy \
    --policy-name "${BEDROCK_POLICY_NAME}" \
    --policy-document "${BEDROCK_POLICY}" \
    --query "Policy.Arn" --output text)
  echo "  ✔ Created Bedrock policy"
fi
aws iam attach-role-policy --role-name "${TASK_ROLE_NAME}" \
  --policy-arn "${BEDROCK_POLICY_ARN}" 2>/dev/null || true

# ── 6. CloudWatch Log Group ─────────────────────────────────────────────────
echo ""
echo "▸ Step 6: CloudWatch Logs"
if aws logs describe-log-groups --log-group-name-prefix "${LOG_GROUP}" --region "${REGION}" \
    --query "logGroups[?logGroupName=='${LOG_GROUP}']" --output text | grep -q "${LOG_GROUP}"; then
  echo "  ✔ Log group ${LOG_GROUP} already exists"
else
  aws logs create-log-group --log-group-name "${LOG_GROUP}" --region "${REGION}"
  echo "  ✔ Created log group ${LOG_GROUP}"
fi
aws logs put-retention-policy --log-group-name "${LOG_GROUP}" \
  --retention-in-days 7 --region "${REGION}" 2>/dev/null || true

# ── 7. ALB + Target Group ───────────────────────────────────────────────────
echo ""
echo "▸ Step 7: ALB + Target Group"

# Target Group
TG_ARN=$(aws elbv2 describe-target-groups --names "${TG_NAME}" \
  --query "TargetGroups[0].TargetGroupArn" --output text --region "${REGION}" 2>/dev/null || true)
if [[ -z "${TG_ARN}" || "${TG_ARN}" == "None" ]]; then
  TG_ARN=$(aws elbv2 create-target-group \
    --name "${TG_NAME}" \
    --protocol HTTP --port "${CONTAINER_PORT}" \
    --vpc-id "${VPC_ID}" \
    --target-type ip \
    --health-check-path "/health" \
    --health-check-interval-seconds 30 \
    --healthy-threshold-count 2 \
    --unhealthy-threshold-count 3 \
    --query "TargetGroups[0].TargetGroupArn" --output text --region "${REGION}")
  echo "  ✔ Created target group ${TG_NAME}"
else
  echo "  ✔ Target group ${TG_NAME} already exists"
fi

# Enable sticky sessions for WebSocket support
aws elbv2 modify-target-group-attributes \
  --target-group-arn "${TG_ARN}" \
  --attributes \
    Key=stickiness.enabled,Value=true \
    Key=stickiness.type,Value=lb_cookie \
    Key=stickiness.lb_cookie.duration_seconds,Value=86400 \
  --region "${REGION}" > /dev/null

# ALB
ALB_ARN=$(aws elbv2 describe-load-balancers --names "${ALB_NAME}" \
  --query "LoadBalancers[0].LoadBalancerArn" --output text --region "${REGION}" 2>/dev/null || true)
if [[ -z "${ALB_ARN}" || "${ALB_ARN}" == "None" ]]; then
  ALB_ARN=$(aws elbv2 create-load-balancer \
    --name "${ALB_NAME}" \
    --subnets ${SUBNET_IDS} \
    --security-groups "${ALB_SG_ID}" \
    --scheme internet-facing \
    --type application \
    --query "LoadBalancers[0].LoadBalancerArn" --output text --region "${REGION}")
  echo "  ✔ Created ALB ${ALB_NAME}"

  # Wait for ALB to become active
  echo "  ⏳ Waiting for ALB to become active..."
  aws elbv2 wait load-balancer-available --load-balancer-arns "${ALB_ARN}" --region "${REGION}"
  echo "  ✔ ALB is active"
else
  echo "  ✔ ALB ${ALB_NAME} already exists"
fi

# Set idle timeout to 300s for long-running WebSocket crawls
aws elbv2 modify-load-balancer-attributes \
  --load-balancer-arn "${ALB_ARN}" \
  --attributes Key=idle_timeout.timeout_seconds,Value=300 \
  --region "${REGION}" > /dev/null

# Listener
LISTENER_ARN=$(aws elbv2 describe-listeners --load-balancer-arn "${ALB_ARN}" \
  --query "Listeners[?Port==\`80\`].ListenerArn" --output text --region "${REGION}" 2>/dev/null || true)
if [[ -z "${LISTENER_ARN}" || "${LISTENER_ARN}" == "None" ]]; then
  LISTENER_ARN=$(aws elbv2 create-listener \
    --load-balancer-arn "${ALB_ARN}" \
    --protocol HTTP --port 80 \
    --default-actions Type=forward,TargetGroupArn="${TG_ARN}" \
    --query "Listeners[0].ListenerArn" --output text --region "${REGION}")
  echo "  ✔ Created HTTP listener"
else
  echo "  ✔ HTTP listener already exists"
fi

# ── 8. ECS Cluster + Task Definition + Service ──────────────────────────────
echo ""
echo "▸ Step 8: ECS Cluster + Service"

# Cluster
if aws ecs describe-clusters --clusters "${CLUSTER_NAME}" --region "${REGION}" \
    --query "clusters[?status=='ACTIVE'].clusterName" --output text | grep -q "${CLUSTER_NAME}"; then
  echo "  ✔ Cluster ${CLUSTER_NAME} already exists"
else
  aws ecs create-cluster --cluster-name "${CLUSTER_NAME}" --region "${REGION}" --output text > /dev/null
  echo "  ✔ Created cluster ${CLUSTER_NAME}"
fi

# Task definition
TASK_DEF=$(cat <<TASKDEF
{
  "family": "${TASK_FAMILY}",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "4096",
  "memory": "8192",
  "executionRoleArn": "arn:aws:iam::${ACCOUNT_ID}:role/${EXEC_ROLE_NAME}",
  "taskRoleArn": "arn:aws:iam::${ACCOUNT_ID}:role/${TASK_ROLE_NAME}",
  "containerDefinitions": [{
    "name": "${PREFIX}",
    "image": "${ECR_URI}:${IMAGE_TAG}",
    "portMappings": [{
      "containerPort": ${CONTAINER_PORT},
      "protocol": "tcp"
    }],
    "environment": [
      {"name": "BASIC_AUTH_USER", "value": "${BASIC_AUTH_USER}"},
      {"name": "BASIC_AUTH_PASS", "value": "${BASIC_AUTH_PASS}"},
      {"name": "AWS_DEFAULT_REGION", "value": "${REGION}"}
    ],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "${LOG_GROUP}",
        "awslogs-region": "${REGION}",
        "awslogs-stream-prefix": "ecs"
      }
    },
    "essential": true
  }]
}
TASKDEF
)

TASK_DEF_ARN=$(aws ecs register-task-definition \
  --cli-input-json "${TASK_DEF}" \
  --query "taskDefinition.taskDefinitionArn" --output text --region "${REGION}")
echo "  ✔ Registered task definition: ${TASK_DEF_ARN}"

# Build subnet list for JSON
SUBNET_JSON=$(printf '"%s",' "${SUBNET_ARRAY[@]}" | sed 's/,$//')

# Service
EXISTING_SERVICE=$(aws ecs describe-services --cluster "${CLUSTER_NAME}" \
  --services "${SERVICE_NAME}" --region "${REGION}" \
  --query "services[?status=='ACTIVE'].serviceName" --output text 2>/dev/null || true)

if [[ -n "${EXISTING_SERVICE}" && "${EXISTING_SERVICE}" != "None" ]]; then
  echo "  ✔ Service ${SERVICE_NAME} already exists — updating..."
  aws ecs update-service \
    --cluster "${CLUSTER_NAME}" \
    --service "${SERVICE_NAME}" \
    --task-definition "${TASK_DEF_ARN}" \
    --desired-count "${DESIRED_COUNT}" \
    --force-new-deployment \
    --region "${REGION}" > /dev/null
  echo "  ✔ Service updated with new task definition"
else
  aws ecs create-service \
    --cluster "${CLUSTER_NAME}" \
    --service-name "${SERVICE_NAME}" \
    --task-definition "${TASK_DEF_ARN}" \
    --desired-count "${DESIRED_COUNT}" \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[${SUBNET_JSON}],securityGroups=[\"${ECS_SG_ID}\"],assignPublicIp=ENABLED}" \
    --load-balancers "targetGroupArn=${TG_ARN},containerName=${PREFIX},containerPort=${CONTAINER_PORT}" \
    --region "${REGION}" > /dev/null
  echo "  ✔ Created service ${SERVICE_NAME}"
fi

# ── 9. Summary ───────────────────────────────────────────────────────────────
ALB_DNS=$(aws elbv2 describe-load-balancers --names "${ALB_NAME}" \
  --query "LoadBalancers[0].DNSName" --output text --region "${REGION}")

echo ""
echo "============================================================"
echo " ✅ Deployment Complete!"
echo "============================================================"
echo ""
echo " URL:       http://${ALB_DNS}"
echo " Health:    http://${ALB_DNS}/health"
echo ""
echo " Username:  ${BASIC_AUTH_USER}"
echo " Password:  ${BASIC_AUTH_PASS}"
echo ""
echo " Note: It may take 1-2 minutes for the task to start and"
echo " pass health checks before the URL becomes accessible."
echo "============================================================"
