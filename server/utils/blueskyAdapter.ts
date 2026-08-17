import { Agent, CredentialSession } from "@atproto/api";
import type {
  AppBskyFeedDefs,
  AppBskyEmbedImages,
  AppBskyEmbedExternal,
  AtpPersistSessionHandler,
  AtpSessionData,
  AtpSessionEvent,
} from "@atproto/api";
import type { NewFeedItem } from "./rssAdapter";
import { normalizeTags } from "./tagNormalizer";

export const BLUESKY_SOURCE = "bluesky" as const;

// Facet feature type carrying a hashtag (see @atproto AppBskyRichtextFacet.Tag).
const FACET_TAG_TYPE = "app.bsky.richtext.facet#tag";

// Posts longer than this many characters get truncated for the title derivation.
const TITLE_MAX_CHARS = 100;

// Bluesky limits timeline pages to 100 posts; use a safe default.
const PAGE_LIMIT = 50;

// Safety cap for serverless environments: stop paginating after this many pages
// to avoid timeout or memory exhaustion on first sync or very old watermarks.
const MAX_PAGES = 100;

export interface BlueskyCredentials {
  identifier: string;
  appPassword: string;
  accessJwt: string;
  refreshJwt: string;
  did: string;
}

// The current session JWTs after a resume/login, mirrored back to the DB so the
// next sync can resume instead of falling back to a full app-password login.
export interface BlueskySessionTokens {
  accessJwt: string;
  refreshJwt: string;
}

// createAgentSession returns both the ready-to-use agent and the fresh session
// tokens the underlying CredentialSession settled on (which may differ from the
// stored ones after a refresh or a fallback login).
export interface BlueskyAgentSession {
  agent: Agent;
  tokens: BlueskySessionTokens | null;
}

export interface BlueskyAdapterDeps {
  createSession: (
    _credentials: BlueskyCredentials,
    _persistSession?: PersistBlueskySession,
  ) => Promise<BlueskyAgentSession>;
  getTimeline: (
    _agent: Agent,
    _cursor?: string,
  ) => Promise<{ feed: AppBskyFeedDefs.FeedViewPost[]; cursor?: string }>;
}

// Sink for the fresh session JWTs. Kept out of BlueskyAdapterDeps (which only
// carries the Bluesky I/O seam, injected all-or-nothing) because persistence is
// storage, not an external service — and so a partial I/O stub can never
// silently fall back to the real network.
export type PersistBlueskySession = (
  _tokens: BlueskySessionTokens,
) => Promise<void>;

export interface PostFilterPolicy {
  includeReposts: boolean;
  includeReplies: boolean;
}

// Default policy: top-level original posts only.
// Reposts and replies are excluded to keep the feed signal-dense.
// Override per-feed by passing a custom policy.
export const DEFAULT_POST_FILTER_POLICY: PostFilterPolicy = {
  includeReposts: false,
  includeReplies: false,
};

// Exported for unit testing.
export function buildPermalinkFromUri(handle: string, uri: string): string {
  // AT URI format: at://did:plc:<id>/app.bsky.feed.post/<rkey>
  const rkey = uri.split("/").at(-1) ?? "";
  return `https://bsky.app/profile/${handle}/post/${rkey}`;
}

// Exported for unit testing.
export function deriveTitleFromText(text: string): string {
  if (!text) {
    return "(untitled)";
  }

  const firstLine = text.split("\n")[0] ?? "";
  const candidate = firstLine.length > 0 ? firstLine : text;

  if (candidate.length <= TITLE_MAX_CHARS) {
    return candidate;
  }

  return candidate.slice(0, TITLE_MAX_CHARS) + "…";
}

// Exported for unit testing.
export function resolvePostImageUrl(
  post: AppBskyFeedDefs.FeedViewPost["post"],
): string | null {
  const embed = post.embed;
  if (!embed) {
    return null;
  }

  if (embed.$type === "app.bsky.embed.images#view") {
    const imagesEmbed = embed as AppBskyEmbedImages.View;
    const firstImage = imagesEmbed.images?.[0];
    return firstImage?.thumb ?? null;
  }

  if (embed.$type === "app.bsky.embed.external#view") {
    const externalEmbed = embed as AppBskyEmbedExternal.View;
    return externalEmbed.external?.thumb ?? null;
  }

  return null;
}

function isRepost(feedPost: AppBskyFeedDefs.FeedViewPost): boolean {
  return feedPost.reason?.$type === "app.bsky.feed.defs#reasonRepost";
}

function isReply(feedPost: AppBskyFeedDefs.FeedViewPost): boolean {
  const record = feedPost.post.record as Record<string, unknown> | null;
  return record?.reply != null;
}

// Exported for unit testing.
export function shouldIncludePost(
  feedPost: AppBskyFeedDefs.FeedViewPost,
  policy: PostFilterPolicy,
): boolean {
  if (!policy.includeReposts && isRepost(feedPost)) {
    return false;
  }

  if (!policy.includeReplies && isReply(feedPost)) {
    return false;
  }

  return true;
}

// Pulls hashtags out of a single facet's feature list. A facet annotates a
// text range and can carry mentions, links, or tags; we keep only tag features.
function tagsFromFacetFeatures(features: unknown): string[] {
  if (!Array.isArray(features)) {
    return [];
  }

  return features
    .filter(
      (feature): feature is { tag: string } =>
        (feature as { $type?: string })?.$type === FACET_TAG_TYPE &&
        typeof (feature as { tag?: unknown }).tag === "string",
    )
    .map((feature) => feature.tag);
}

// Exported for unit testing. Collects hashtags from both the post's richtext
// facets (inline #hashtags) and record.tags (hashtags added out of band), then
// normalizes them. Returns null when the post carries no tags.
export function extractPostTags(record: {
  tags?: unknown;
  facets?: unknown;
}): string[] | null {
  const recordTags = Array.isArray(record.tags) ? record.tags : [];
  const facets = Array.isArray(record.facets) ? record.facets : [];
  const facetTags = facets.flatMap((facet) =>
    tagsFromFacetFeatures((facet as { features?: unknown })?.features),
  );

  return normalizeTags([...recordTags, ...facetTags]);
}

function mapPostToFeedItem(
  feedPost: AppBskyFeedDefs.FeedViewPost,
  feedId: number,
): NewFeedItem {
  const post = feedPost.post;
  const record = post.record as {
    text?: string;
    createdAt?: string;
    reply?: unknown;
    tags?: unknown;
    facets?: unknown;
  };

  const author = post.author;
  const handle = author.handle;
  const displayName = author.displayName ?? handle;
  const uri = post.uri;
  const text = record.text ?? "";
  const createdAt = record.createdAt;
  const publishedAt = createdAt ? new Date(createdAt) : null;

  return {
    feedId,
    guid: uri,
    title: deriveTitleFromText(text),
    url: buildPermalinkFromUri(handle, uri),
    author: displayName,
    content: text || null,
    imageUrl: resolvePostImageUrl(post),
    publishedAt,
    savedAt: null,
    readAt: null,
    starred: false,
    tags: extractPostTags(record),
    searchVector: null,
  };
}

function isPostAfterWatermark(
  feedPost: AppBskyFeedDefs.FeedViewPost,
  watermark: Date,
): boolean {
  // Prefer indexedAt (server-assigned) over record.createdAt (client-authored)
  // to avoid skewing caused by future-dated or manipulated client timestamps.
  const record = feedPost.post.record as { createdAt?: string };
  const candidate = feedPost.post.indexedAt ?? record.createdAt;

  if (!candidate) {
    return false;
  }

  const postDate = new Date(candidate);

  if (Number.isNaN(postDate.getTime())) {
    return false;
  }

  // Use >= so posts created at exactly the watermark boundary are included
  // rather than silently dropped on the boundary edge.
  return postDate >= watermark;
}

// Reads the JWTs the CredentialSession settled on after resume/login. Returns
// null when the session was never populated (resume and login both failed to
// establish one), so callers skip persistence rather than writing empty tokens.
function extractSessionTokens(
  session: CredentialSession,
): BlueskySessionTokens | null {
  const sessionData = session.session;

  if (!sessionData) {
    return null;
  }

  return {
    accessJwt: sessionData.accessJwt,
    refreshJwt: sessionData.refreshJwt,
  };
}

// Bridges atproto's session-change events to our storage sink. atproto fires
// this handler every time it rotates JWTs — including refreshes that happen
// mid-request during timeline pagination, not just the initial resume/login —
// so wiring it into the CredentialSession is what keeps a mid-sync rotation
// from being silently dropped. `isArmed` gates it to post-open rotations only:
// the open-time settle is already mirrored by openSession's snapshot, so leaving
// the handler disarmed until the session opens avoids a redundant double write.
function createRotationHandler(
  persistSession: PersistBlueskySession,
  isArmed: () => boolean,
): AtpPersistSessionHandler {
  // Serialize rotation writes through a promise chain: refresh JWTs are
  // single-use, so two overlapping rotation writes landing out of order would
  // store an already consumed token and break the next sync.
  let mirrorQueue: Promise<void> = Promise.resolve();

  return (event: AtpSessionEvent, sessionData: AtpSessionData | undefined) => {
    if (!isArmed()) {
      return;
    }

    // Only a genuine login ('create') or refresh/rotation ('update') carries
    // fresh JWTs worth storing. 'expired'/'create-failed' arrive with no
    // session; 'network-error' carries the *unchanged* session, so persisting it
    // would be a redundant write of tokens we already hold.
    if (event !== "create" && event !== "update") {
      return;
    }

    if (!sessionData) {
      return;
    }

    const tokens: BlueskySessionTokens = {
      accessJwt: sessionData.accessJwt,
      refreshJwt: sessionData.refreshJwt,
    };

    // Return the (error-swallowing) tail of the queue. atproto does not await
    // this handler, so it stays fire-and-forget in production; returning it lets
    // a test await the persistence deterministically.
    mirrorQueue = mirrorQueue.then(() =>
      mirrorSessionTokens(persistSession, tokens),
    );
    return mirrorQueue;
  };
}

export async function createAgentSession(
  credentials: BlueskyCredentials,
  persistSession?: PersistBlueskySession,
): Promise<BlueskyAgentSession> {
  let sessionOpen = false;
  const rotationHandler = persistSession
    ? createRotationHandler(persistSession, () => sessionOpen)
    : undefined;
  const session = new CredentialSession(
    new URL("https://bsky.social"),
    undefined,
    rotationHandler,
  );

  try {
    await session.resumeSession({
      did: credentials.did,
      handle: credentials.identifier,
      accessJwt: credentials.accessJwt,
      refreshJwt: credentials.refreshJwt,
      active: true,
    });
  } catch {
    // Tokens expired or invalid — fall back to full re-auth with app password.
    await session.login({
      identifier: credentials.identifier,
      password: credentials.appPassword,
    });
  }

  // Arm the handler only now: every rotation from here on (i.e. during
  // pagination) is mirrored; the open-time settle above is left to the snapshot.
  sessionOpen = true;

  return { agent: new Agent(session), tokens: extractSessionTokens(session) };
}

export async function fetchTimelinePage(
  agent: Agent,
  cursor?: string,
): Promise<{ feed: AppBskyFeedDefs.FeedViewPost[]; cursor?: string }> {
  const response = await agent.getTimeline({
    limit: PAGE_LIMIT,
    cursor,
  });

  return {
    feed: response.data.feed,
    cursor: response.data.cursor,
  };
}

// Best-effort mirror of the fresh JWTs to storage: a failed write (transient DB
// blip, missing encryption key) must not fail an otherwise-successful sync — the
// next run just re-authenticates with the app password. try/catch (not .catch)
// so a sink that throws synchronously is swallowed too, since the seam is public.
async function mirrorSessionTokens(
  persistSession: PersistBlueskySession,
  tokens: BlueskySessionTokens,
): Promise<void> {
  try {
    await persistSession(tokens);
  } catch (error) {
    console.error("Failed to persist refreshed Bluesky session:", error);
  }
}

// Opens the session and mirrors the fresh tokens back to storage right away, so
// a later timeline failure still leaves the DB with resumable JWTs for the next
// sync. Kept separate from fetchNewBlueskyPosts so each stays small and focused.
async function openSession(
  deps: BlueskyAdapterDeps,
  credentials: BlueskyCredentials,
  persistSession?: PersistBlueskySession,
): Promise<Agent> {
  // Pass the sink through so the underlying CredentialSession can mirror JWTs
  // rotated later during pagination, not just this post-open snapshot.
  const { agent, tokens } = await deps.createSession(
    credentials,
    persistSession,
  );

  if (persistSession && tokens) {
    await mirrorSessionTokens(persistSession, tokens);
  }

  return agent;
}

export async function fetchNewBlueskyPosts(
  credentials: BlueskyCredentials,
  feedId: number,
  lastSyncedAt: Date | null,
  policy: PostFilterPolicy = DEFAULT_POST_FILTER_POLICY,
  deps: BlueskyAdapterDeps = {
    createSession: createAgentSession,
    getTimeline: fetchTimelinePage,
  },
  persistSession?: PersistBlueskySession,
): Promise<NewFeedItem[]> {
  const agent = await openSession(deps, credentials, persistSession);
  const items: NewFeedItem[] = [];
  let cursor: string | undefined;
  let pagesFetched = 0;

  // If no watermark, use the epoch so everything is included (first sync).
  const watermark = lastSyncedAt ?? new Date(0);

  while (pagesFetched < MAX_PAGES) {
    const page = await deps.getTimeline(agent, cursor);
    pagesFetched += 1;

    if (page.feed.length === 0) {
      break;
    }

    let reachedWatermark = false;

    for (const feedPost of page.feed) {
      if (!isPostAfterWatermark(feedPost, watermark)) {
        reachedWatermark = true;
        break;
      }

      if (!shouldIncludePost(feedPost, policy)) {
        continue;
      }

      items.push(mapPostToFeedItem(feedPost, feedId));
    }

    if (reachedWatermark || !page.cursor) {
      break;
    }

    cursor = page.cursor;
  }

  return items;
}
