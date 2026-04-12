#!/usr/bin/env python3
"""Purge all 'peekaboo' CloudWatch log groups: set 5-day retention and delete all streams."""

import sys
import boto3
from concurrent.futures import ThreadPoolExecutor, as_completed

REGION = "us-east-1"
KEYWORD = "peekaboo"
RETENTION_DAYS = 5
MAX_WORKERS = 20


def delete_stream(client, lg_name, stream_name):
    client.delete_log_stream(logGroupName=lg_name, logStreamName=stream_name)


def main():
    client = boto3.client("logs", region_name=REGION)

    # 1. Find all log groups containing the keyword
    log_groups = []
    paginator = client.get_paginator("describe_log_groups")
    for page in paginator.paginate():
        for lg in page["logGroups"]:
            if KEYWORD in lg["logGroupName"]:
                log_groups.append(lg["logGroupName"])

    if not log_groups:
        print("No matching log groups found.")
        return

    print(f"Found {len(log_groups)} log groups\n", flush=True)

    for lg_name in log_groups:
        print(f"=== {lg_name} ===", flush=True)

        # 2. Set retention
        client.put_retention_policy(logGroupName=lg_name, retentionInDays=RETENTION_DAYS)
        print(f"  Retention set to {RETENTION_DAYS} days", flush=True)

        # 3. Delete streams in batches as we paginate (don't collect all first)
        deleted = 0
        errors = 0
        sp = client.get_paginator("describe_log_streams")
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            batch = []
            for page in sp.paginate(logGroupName=lg_name):
                for s in page["logStreams"]:
                    batch.append(s["logStreamName"])

                # Submit this page's batch immediately
                if batch:
                    futures = {
                        pool.submit(delete_stream, client, lg_name, s): s
                        for s in batch
                    }
                    for f in as_completed(futures):
                        try:
                            f.result()
                            deleted += 1
                            if deleted % 500 == 0:
                                print(f"    ...deleted {deleted}", flush=True)
                        except Exception as e:
                            errors += 1
                            if errors <= 3:
                                print(f"    Error: {e}", flush=True)
                    batch = []

        if deleted == 0 and errors == 0:
            print("  No streams to delete", flush=True)
        else:
            print(f"  Done: {deleted} deleted, {errors} errors\n", flush=True)

    print("All done.")


if __name__ == "__main__":
    main()
