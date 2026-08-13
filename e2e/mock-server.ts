import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

export const MOCK_PORT = Number(process.env.E2E_MOCK_SERVER_PORT ?? 3099);
export const MOCK_BASE_URL = `http://127.0.0.1:${MOCK_PORT}`;

const MINIMAL_RSS_FEED =
  '<?xml version="1.0"?><rss version="2.0"><channel><title>Mock Feed</title></channel></rss>';

let server: Server | null = null;

type RouteKey = `${"GET" | "POST"} ${string}`;
type RouteHandler = (_req: IncomingMessage, _res: ServerResponse) => void;

function parseQueryParams(url: string): URLSearchParams {
  return new URLSearchParams((url ?? "").split("?")[1] ?? "");
}

function jsonResponse(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// ── OAuth 2.0 token exchange (shared by all providers) ───────────────────
function handleTokenExchange(_req: IncomingMessage, res: ServerResponse): void {
  jsonResponse(res, {
    access_token: "mock_access_token",
    refresh_token: "mock_refresh_token",
    expires_in: 3600,
    scope: "https://www.googleapis.com/auth/youtube.readonly",
    token_type: "Bearer",
  });
}

// ── YouTube: channel info ────────────────────────────────────────────────
function handleYouTubeChannels(
  _req: IncomingMessage,
  res: ServerResponse,
): void {
  jsonResponse(res, {
    items: [
      {
        snippet: {
          customUrl: "@e2etestchannel",
          title: "E2E Test Channel",
        },
      },
    ],
  });
}

// ── Feed proxy: returns a minimal valid RSS feed for any URL ─────────────
// Used by the feed validator (FEED_FETCH_PROXY_URL) so e2e tests never
// make real outbound HTTP requests when adding a feed.
function handleFeedProxy(req: IncomingMessage, res: ServerResponse): void {
  const feedUrl = parseQueryParams(req.url ?? "").get("url");

  if (!feedUrl) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing required query parameter: url" }));
    return;
  }

  res.writeHead(200, { "Content-Type": "application/rss+xml" });
  res.end(MINIMAL_RSS_FEED);
}

// ── RSS feed stub for feed-discovery e2e tests ───────────────────────────
function handleFeedXml(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "application/rss+xml; charset=utf-8",
  });
  res.end(
    `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>E2E Mock Feed</title>
    <link>${MOCK_BASE_URL}/feed.xml</link>
    <description>Mock RSS feed for e2e tests</description>
  </channel>
</rss>`,
  );
}

// ── Grant revocation on disconnect ───────────────────────────────────────
// Google token revocation and Bluesky session teardown both answer 2xx on
// success; the handlers only assert the response is ok, so an empty body is
// enough. Keeps disconnect e2e tests from hitting the real providers.
function handleRevokeOk(_req: IncomingMessage, res: ServerResponse): void {
  jsonResponse(res, {});
}

const routes: Record<RouteKey, RouteHandler> = {
  "POST /token": handleTokenExchange,
  "GET /youtube/v3/channels": handleYouTubeChannels,
  "GET /feed-proxy": handleFeedProxy,
  "GET /feed.xml": handleFeedXml,
  "POST /revoke": handleRevokeOk,
  "POST /xrpc/com.atproto.server.deleteSession": handleRevokeOk,
};

function handleNotFound(
  method: string,
  path: string,
  res: ServerResponse,
): void {
  // Loud 404 so missing mocks are immediately obvious in the test output
  console.error(`[mock-server] No handler for ${method} ${path}`);
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: `No mock handler for ${method} ${path}` }));
}

function handle(req: IncomingMessage, res: ServerResponse): void {
  const method = (req.method ?? "GET") as "GET" | "POST";
  const path = (req.url ?? "/").split("?")[0] as string;
  const routeKey: RouteKey = `${method} ${path}`;
  const routeHandler = routes[routeKey];

  if (routeHandler) {
    routeHandler(req, res);
    return;
  }

  handleNotFound(method, path, res);
}

export function startMockServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    server = createServer(handle);
    server.listen(MOCK_PORT, "127.0.0.1", () => {
      console.log(`\n[mock-server] Listening on ${MOCK_BASE_URL}`);
      resolve();
    });
    server.on("error", reject);
  });
}

export function stopMockServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server) return resolve();
    server.close((err) => {
      server = null;
      err ? reject(err) : resolve();
    });
  });
}
