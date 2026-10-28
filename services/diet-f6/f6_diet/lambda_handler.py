"""Lambda Function URL adapter. Production never enables local authentication."""

import os

import boto3
from botocore.config import Config
from mangum import Mangum

from .api import Settings, create_app
from .quota import DynamoQuota

settings = Settings.environment()
if settings.local or not os.environ.get("F6_QUOTA_TABLE"):
    raise RuntimeError("Production authentication and shared quota are required")
settings.timeout = 55
table = boto3.resource(
    "dynamodb",
    config=Config(
        connect_timeout=3,
        read_timeout=5,
        retries={"max_attempts": 2, "mode": "standard"},
    ),
).Table(os.environ["F6_QUOTA_TABLE"])
handler = Mangum(create_app(settings, quota=DynamoQuota(table)), lifespan="off")
