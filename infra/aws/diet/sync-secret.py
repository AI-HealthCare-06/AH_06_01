"""Upload the user-provided key in memory. Never retrieve or print secret values."""

import json
from pathlib import Path

import boto3
from dotenv import dotenv_values


def main():
    root = Path(__file__).resolve().parents[3]
    values = dotenv_values(root / "services/diet-f6/.env")
    key = values.get("VISION_API_KEY") or ""
    if not key or values.get("VISION_BASE_URL"):
        raise RuntimeError("A configured official OpenAI key is required")
    session = boto3.Session(profile_name="rexrun", region_name="ap-southeast-2")
    if session.client("sts").get_caller_identity()["Account"] != "862330372849":
        raise RuntimeError("Unexpected AWS account")
    client = session.client("secretsmanager")
    name = "rexrun/test/diet-openai"
    payload = json.dumps({"VISION_API_KEY": key})
    try:
        arn = client.describe_secret(SecretId=name)["ARN"]
    except client.exceptions.ResourceNotFoundException:
        arn = client.create_secret(
            Name=name,
            SecretString=payload,
            Tags=[{"Key": "Project", "Value": "REXRUN"}],
        )["ARN"]
    else:
        client.put_secret_value(SecretId=arn, SecretString=payload)
    print(
        json.dumps({"secretArn": arn, "configured": True, "secretValueRecorded": False})
    )


if __name__ == "__main__":
    main()
