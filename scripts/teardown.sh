#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# Peekaboo — Teardown all AWS resources
#
# Deletes resources in reverse order. Leaves ECR repo (prints manual command).
###############################################################################

PREFIX="peekaboo"
REGION="${AWS_REGION:-us-east-1}"

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
ECR_REPO="${PREFIX}-repo"
BEDROCK_POLICY_NAME="${PREFIX}-bedrock-policy"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
# Find VPC with internet gateway (same logic as deploy.sh)
if [[ -z "${VPC_ID:-}" ]]; then
  VPC_ID=$(aws ec2 describe-internet-gateways \
    --query "InternetGateways[0].Attachments[0].VpcId" --output text --region "${REGION}" 2>/dev/null)
  VPC_ID="${VPC_ID:-None}"
fi

echo "============================================================"
echo " Peekaboo — Teardown"
echo "============================================================"
echo " Region:  ${REGION}"
echo " Account: ${ACCOUNT_ID}"
echo "============================================================"
echo ""

# ── 1. ECS Service ──────────────────────────────────────────────────────────
echo "▸ ECS Service"
EXISTING_SERVICE=$(aws ecs describe-services --cluster "${CLUSTER_NAME}" \
  --services "${SERVICE_NAME}" --region "${REGION}" \
  --query "services[?status=='ACTIVE'].serviceName" --output text 2>/dev/null || true)
if [[ -n "${EXISTING_SERVICE}" && "${EXISTING_SERVICE}" != "None" ]]; then
  aws ecs update-service --cluster "${CLUSTER_NAME}" --service "${SERVICE_NAME}" \
    --desired-count 0 --region "${REGION}" > /dev/null
  aws ecs delete-service --cluster "${CLUSTER_NAME}" --service "${SERVICE_NAME}" \
    --force --region "${REGION}" > /dev/null
  echo "  ✔ Deleted service ${SERVICE_NAME}"
else
  echo "  – Service not found, skipping"
fi

# ── 2. ECS Cluster ──────────────────────────────────────────────────────────
echo "▸ ECS Cluster"
if aws ecs describe-clusters --clusters "${CLUSTER_NAME}" --region "${REGION}" \
    --query "clusters[?status=='ACTIVE'].clusterName" --output text 2>/dev/null | grep -q "${CLUSTER_NAME}"; then
  aws ecs delete-cluster --cluster "${CLUSTER_NAME}" --region "${REGION}" > /dev/null
  echo "  ✔ Deleted cluster ${CLUSTER_NAME}"
else
  echo "  – Cluster not found, skipping"
fi

# ── 3. Task Definitions (deregister all revisions) ──────────────────────────
echo "▸ Task Definitions"
TASK_DEFS=$(aws ecs list-task-definitions --family-prefix "${TASK_FAMILY}" \
  --query "taskDefinitionArns" --output text --region "${REGION}" 2>/dev/null || true)
if [[ -n "${TASK_DEFS}" && "${TASK_DEFS}" != "None" ]]; then
  for td in ${TASK_DEFS}; do
    aws ecs deregister-task-definition --task-definition "${td}" --region "${REGION}" > /dev/null
  done
  echo "  ✔ Deregistered task definitions"
else
  echo "  – No task definitions found, skipping"
fi

# ── 4. ALB Listener ─────────────────────────────────────────────────────────
echo "▸ ALB"
ALB_ARN=$(aws elbv2 describe-load-balancers --names "${ALB_NAME}" \
  --query "LoadBalancers[0].LoadBalancerArn" --output text --region "${REGION}" 2>/dev/null || true)
if [[ -n "${ALB_ARN}" && "${ALB_ARN}" != "None" ]]; then
  # Delete listeners first
  LISTENERS=$(aws elbv2 describe-listeners --load-balancer-arn "${ALB_ARN}" \
    --query "Listeners[*].ListenerArn" --output text --region "${REGION}" 2>/dev/null || true)
  for lis in ${LISTENERS}; do
    aws elbv2 delete-listener --listener-arn "${lis}" --region "${REGION}" > /dev/null 2>&1 || true
  done
  aws elbv2 delete-load-balancer --load-balancer-arn "${ALB_ARN}" --region "${REGION}" > /dev/null
  echo "  ✔ Deleted ALB ${ALB_NAME}"

  # Wait for ALB to be fully deleted before removing SGs
  echo "  ⏳ Waiting for ALB to finish deleting..."
  for i in $(seq 1 30); do
    STATUS=$(aws elbv2 describe-load-balancers --names "${ALB_NAME}" \
      --query "LoadBalancers[0].State.Code" --output text --region "${REGION}" 2>/dev/null || echo "gone")
    if [[ "${STATUS}" == "gone" ]]; then break; fi
    sleep 5
  done
  echo "  ✔ ALB deleted"
else
  echo "  – ALB not found, skipping"
fi

# ── 5. Target Group ─────────────────────────────────────────────────────────
echo "▸ Target Group"
TG_ARN=$(aws elbv2 describe-target-groups --names "${TG_NAME}" \
  --query "TargetGroups[0].TargetGroupArn" --output text --region "${REGION}" 2>/dev/null || true)
if [[ -n "${TG_ARN}" && "${TG_ARN}" != "None" ]]; then
  aws elbv2 delete-target-group --target-group-arn "${TG_ARN}" --region "${REGION}" > /dev/null
  echo "  ✔ Deleted target group ${TG_NAME}"
else
  echo "  – Target group not found, skipping"
fi

# ── 6. Security Groups ──────────────────────────────────────────────────────
echo "▸ Security Groups"
for SG_NAME in "${ECS_SG_NAME}" "${ALB_SG_NAME}"; do
  SG_ID=$(aws ec2 describe-security-groups \
    --filters "Name=group-name,Values=${SG_NAME}" "Name=vpc-id,Values=${VPC_ID}" \
    --query "SecurityGroups[0].GroupId" --output text --region "${REGION}" 2>/dev/null || true)
  if [[ -n "${SG_ID}" && "${SG_ID}" != "None" ]]; then
    aws ec2 delete-security-group --group-id "${SG_ID}" --region "${REGION}" > /dev/null 2>&1 || \
      echo "  ⚠ Could not delete SG ${SG_NAME} (${SG_ID}) — may still be in use, retry later"
    echo "  ✔ Deleted SG ${SG_NAME}"
  else
    echo "  – SG ${SG_NAME} not found, skipping"
  fi
done

# ── 7. IAM ───────────────────────────────────────────────────────────────────
echo "▸ IAM Roles & Policies"

# Detach and delete Bedrock policy
BEDROCK_POLICY_ARN="arn:aws:iam::${ACCOUNT_ID}:policy/${BEDROCK_POLICY_NAME}"
aws iam detach-role-policy --role-name "${TASK_ROLE_NAME}" \
  --policy-arn "${BEDROCK_POLICY_ARN}" 2>/dev/null || true
aws iam delete-policy --policy-arn "${BEDROCK_POLICY_ARN}" 2>/dev/null || true

# Delete inline policies
aws iam delete-role-policy --role-name "${TASK_ROLE_NAME}" \
  --policy-name "${PREFIX}-secrets-policy" 2>/dev/null || true

# Delete task role
aws iam detach-role-policy --role-name "${TASK_ROLE_NAME}" \
  --policy-arn "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy" 2>/dev/null || true
aws iam delete-role --role-name "${TASK_ROLE_NAME}" 2>/dev/null || true
echo "  ✔ Deleted role ${TASK_ROLE_NAME}"

# Delete execution role
aws iam detach-role-policy --role-name "${EXEC_ROLE_NAME}" \
  --policy-arn "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy" 2>/dev/null || true
aws iam delete-role --role-name "${EXEC_ROLE_NAME}" 2>/dev/null || true
echo "  ✔ Deleted role ${EXEC_ROLE_NAME}"

# ── 8. CloudWatch Logs ──────────────────────────────────────────────────────
echo "▸ CloudWatch Logs"
aws logs delete-log-group --log-group-name "${LOG_GROUP}" --region "${REGION}" 2>/dev/null || true
echo "  ✔ Deleted log group ${LOG_GROUP}"

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo " ✅ Teardown Complete"
echo "============================================================"
echo ""
echo " ECR repository was NOT deleted. To remove it manually:"
echo "   aws ecr delete-repository --repository-name ${ECR_REPO} --force --region ${REGION}"
echo ""
