import { createHash } from "node:crypto";

export interface TestEvent {
  schemaVersion: 1;
  eventId: string;
  sentAt: string;
  source: "web" | "android";
  eventType: "connection_probe";
  synthetic: true;
  payload: { sample: 1 };
}
export interface RecordItem {
  owner: string;
  eventId: string;
  fingerprint: string;
  event: TestEvent;
  receivedAt: string;
  expiresAt: number;
}
export interface Repository {
  putIfAbsent(item: RecordItem): Promise<boolean>;
  get(owner: string, eventId: string): Promise<RecordItem | undefined>;
}
export interface RequestEvent {
  rawPath: string;
  body?: string | null;
  isBase64Encoded?: boolean;
  requestContext: {
    http: { method: string };
    authorizer?: { iam?: { userArn?: string } };
  };
}
function valid(value: unknown): value is TestEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).sort().join(",") !==
    "eventId,eventType,payload,schemaVersion,sentAt,source,synthetic"
  )
    return false;
  return (
    v.schemaVersion === 1 &&
    v.synthetic === true &&
    v.eventType === "connection_probe" &&
    typeof v.eventId === "string" &&
    /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v.eventId) &&
    typeof v.sentAt === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v.sentAt) &&
    Number.isFinite(Date.parse(v.sentAt)) &&
    new Date(v.sentAt).toISOString() === v.sentAt &&
    ["web", "android"].includes(String(v.source)) &&
    !!v.payload &&
    typeof v.payload === "object" &&
    !Array.isArray(v.payload) &&
    Object.keys(v.payload).join(",") === "sample" &&
    (v.payload as { sample: unknown }).sample === 1
  );
}
export function createHandler(repo: Repository, now = () => new Date()) {
  return async (req: RequestEvent) => {
    const respond = (statusCode: number, body: object) => ({
      statusCode,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
      body: JSON.stringify(body),
    });
    if (req.rawPath === "/health" && req.requestContext.http.method === "GET")
      return respond(200, {
        status: "ok",
        mode: "synthetic-collection-test",
        model: "not_connected",
        ranker: "not_connected",
      });
    const owner = req.requestContext.authorizer?.iam?.userArn;
    if (!owner) return respond(401, { code: "authentication_required" });
    try {
      if (
        req.rawPath === "/v1/test-events" &&
        req.requestContext.http.method === "POST"
      ) {
        if (
          req.isBase64Encoded ||
          !req.body ||
          Buffer.byteLength(req.body) > 4096
        )
          return respond(400, { code: "invalid_body" });
        let event: unknown;
        try {
          event = JSON.parse(req.body);
        } catch {
          return respond(400, { code: "invalid_json" });
        }
        if (!valid(event))
          return respond(422, { code: "synthetic_event_required" });
        const timestamp = now();
        if (Math.abs(timestamp.getTime() - Date.parse(event.sentAt)) > 86400000)
          return respond(422, { code: "stale_timestamp" });
        const canonical = {
          schemaVersion: event.schemaVersion,
          eventId: event.eventId,
          sentAt: event.sentAt,
          source: event.source,
          eventType: event.eventType,
          synthetic: event.synthetic,
          payload: event.payload,
        };
        const fingerprint = createHash("sha256")
          .update(JSON.stringify(canonical))
          .digest("hex");
        const item: RecordItem = {
          owner,
          eventId: event.eventId,
          fingerprint,
          event: canonical,
          receivedAt: timestamp.toISOString(),
          expiresAt: Math.floor(timestamp.getTime() / 1000) + 7 * 86400,
        };
        if (await repo.putIfAbsent(item))
          return respond(201, {
            eventId: event.eventId,
            receivedAt: item.receivedAt,
            duplicate: false,
          });
        const previous = await repo.get(owner, event.eventId);
        if (!previous || previous.expiresAt <= timestamp.getTime() / 1000)
          return respond(409, { code: "event_id_expired" });
        if (previous.fingerprint !== fingerprint)
          return respond(409, { code: "event_id_conflict" });
        return respond(200, {
          eventId: event.eventId,
          receivedAt: previous.receivedAt,
          duplicate: true,
        });
      }
      const eventId = req.rawPath.split("/")[3];
      if (
        req.rawPath.startsWith("/v1/test-events/") &&
        req.requestContext.http.method === "GET"
      ) {
        if (
          !eventId ||
          req.rawPath !== `/v1/test-events/${eventId}` ||
          !/^[0-9a-f-]{36}$/i.test(eventId)
        )
          return respond(400, { code: "invalid_event_id" });
        const item = await repo.get(owner, eventId);
        return item && item.expiresAt > now().getTime() / 1000
          ? respond(200, { event: item.event, receivedAt: item.receivedAt })
          : respond(404, { code: "not_found" });
      }
      return respond(404, { code: "not_found" });
    } catch {
      // Do not log request bodies, IAM identities or SDK exceptions.
      return respond(503, { code: "storage_unavailable", retryable: true });
    }
  };
}
