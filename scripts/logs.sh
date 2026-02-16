#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# Peekaboo — Tail CloudWatch logs
###############################################################################

PREFIX="peekaboo"
REGION="${AWS_REGION:-us-east-1}"
LOG_GROUP="/ecs/${PREFIX}"

SINCE="${1:-5m}"

echo "Tailing ${LOG_GROUP} (since ${SINCE})..."
echo "Press Ctrl+C to stop."
echo ""

aws logs tail "${LOG_GROUP}" --follow --since "${SINCE}" --region "${REGION}"
