"""Atomic deployment-wide counters; never store photos or food results."""

import hashlib
import time
from collections import defaultdict


class QuotaExceeded(Exception):
    pass


class QuotaUnavailable(Exception):
    pass


class MemoryQuota:
    def __init__(self):
        self.counts = defaultdict(int)

    def consume(self, user, date, limit):
        bucket = (user, date)
        if self.counts[bucket] >= limit:
            raise QuotaExceeded()
        for old in list(self.counts):
            if old[1] != date:
                del self.counts[old]
        self.counts[bucket] += 1


class DynamoQuota:
    def __init__(self, table):
        self.table = table

    def consume(self, user, date, limit):
        from boto3.dynamodb.conditions import Attr
        from botocore.exceptions import BotoCoreError, ClientError

        digest = hashlib.sha256(user.encode()).hexdigest()
        # Failed model calls also consume quota. Sequential conservative counters
        # prevent exceeding either cap even across concurrent cold starts.
        for key, cap in [(f"user:{digest}:{date}", limit), (f"global:{date}", 200)]:
            try:
                self.table.update_item(
                    Key={"pk": key},
                    UpdateExpression="SET expires_at = :ttl ADD #count :one",
                    ExpressionAttributeNames={"#count": "count"},
                    ExpressionAttributeValues={
                        ":ttl": int(time.time()) + 259200,
                        ":one": 1,
                    },
                    ConditionExpression=Attr("count").not_exists()
                    | Attr("count").lt(cap),
                )
            except (
                self.table.meta.client.exceptions.ConditionalCheckFailedException
            ) as error:
                raise QuotaExceeded() from error
            except (BotoCoreError, ClientError) as error:
                raise QuotaUnavailable() from error
