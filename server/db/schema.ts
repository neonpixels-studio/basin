import {
  boolean,
  customType,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Drizzle does not ship a first-class tsvector type yet, so we define a
// passthrough custom type. The column is populated and maintained by a
// database trigger (see migration 0002_add_feed_items_search_vector.sql) —
// Drizzle never writes to it directly.
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});
import { relations, sql } from "drizzle-orm";
import { SYNC_STATUS } from "../utils/syncStatus";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  providerId: text("provider_id").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Records the provider id (Clerk user id) of a deleted account. server/utils/
// tombstone.ts owns the full rationale (why a still-valid session can otherwise
// resurrect an empty row). The provider id is the primary key so the deletion
// write can safely `onConflictDoNothing` if the account is deleted twice.
//
// Rows are retained and not pruned here: Clerk never reuses a user id, and a
// row only ever needs to outlive the deleted account's longest valid session,
// so pruning risks reopening the resurrection gap if the window undercut a
// still-valid token's TTL. The stored value is Clerk's opaque provider id (a
// pseudonymous identifier, not profile data); hashing it or bounding retention
// past the max session lifetime are reasonable hardening follow-ups.
export const deletionTombstones = pgTable("deletion_tombstones", {
  providerId: text("provider_id").primaryKey(),
  deletedAt: timestamp("deleted_at").notNull().defaultNow(),
});

export const feeds = pgTable(
  "feeds",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    title: text("title"),
    description: text("description"),
    lastFetched: timestamp("last_fetched"),
    source: text("source").notNull(),
    sourceOverride: text("source_override"),
    // Sync health — set by netlify/functions/sync-feed.ts. "error" means the
    // most recent sync hit a permanent (non-retryable) failure; syncError
    // holds the message and syncFailedAt when it happened. Both are cleared
    // back to "ok" / null on the next successful sync.
    syncStatus: text("sync_status").notNull().default(SYNC_STATUS.OK),
    syncError: text("sync_error"),
    syncFailedAt: timestamp("sync_failed_at"),
    // Backoff for permanently-failing syncs. consecutiveFailures counts how
    // many permanent failures in a row the feed has hit; nextRetryAt is the
    // earliest time the scheduler is allowed to re-sync it. Both grow with
    // each failure (exponential, capped — see server/utils/feedSyncBackoff.ts)
    // and reset to 0 / null on the next successful sync, so a healthy feed is
    // never gated.
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    nextRetryAt: timestamp("next_retry_at"),
    // Paused sources are kept (not removed) but excluded from scheduled sync,
    // so they stop pulling new content while their existing items stay intact.
    // Set when a Pro→Free downgrade pushes an account over the Free source cap
    // (server/utils/feedPause.ts), honoring the pricing page's promise
    // (app/pages/pricing.vue). Cleared again when the account upgrades back.
    paused: boolean("paused").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [uniqueIndex("feeds_user_id_url_idx").on(table.userId, table.url)],
);

export const feedItems = pgTable(
  "feed_items",
  {
    id: serial("id").primaryKey(),
    feedId: integer("feed_id")
      .notNull()
      .references(() => feeds.id, { onDelete: "cascade" }),
    guid: text("guid").notNull(),
    title: text("title").notNull(),
    url: text("url"),
    author: text("author"),
    imageUrl: text("image_url"),
    content: text("content"),
    tags: text("tags").array(),
    publishedAt: timestamp("published_at"),
    readAt: timestamp("read_at"),
    starred: boolean("starred").default(false),
    savedAt: timestamp("saved_at"),
    // Podcast-specific fields — null for non-podcast feed items.
    mediaUrl: text("media_url"),
    mediaDuration: integer("media_duration"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
    searchVector: tsvector("search_vector"),
  },
  (table) => [
    uniqueIndex("feed_items_feed_id_guid_idx").on(table.feedId, table.guid),
    index("feed_items_tags_gin_idx").using("gin", table.tags),
    index("feed_items_search_vector_gin_idx").using("gin", table.searchVector),
    // Supports the retention prune in
    // netlify/functions/scheduled-feed-items-cleanup.ts. Partial to match the
    // prune predicate exactly: the job only ever scans rows old enough to drop
    // and never a starred or saved item, so indexing those preserved rows would
    // only bloat the index without ever being read by the range query.
    index("feed_items_retention_created_at_idx")
      .on(table.createdAt)
      .where(sql`${table.starred} = false and ${table.savedAt} is null`),
  ],
);

export const integrations = pgTable(
  "integrations",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    tokenSecret: text("token_secret"),
    expiresAt: timestamp("expires_at"),
    scopes: text("scopes").array(),
    providerAccountId: text("provider_account_id"),
    providerUsername: text("provider_username"),
    // Sync health for this connection — set by netlify/functions/sync-feed.ts
    // when a feed sync fails for a reason attributable to the integration
    // itself (expired token with no refresh token, missing credentials).
    // Cleared back to "ok" / null the next time a feed using this
    // integration syncs successfully.
    syncStatus: text("sync_status").notNull().default(SYNC_STATUS.OK),
    syncError: text("sync_error"),
    syncFailedAt: timestamp("sync_failed_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("integrations_user_id_provider_idx").on(
      table.userId,
      table.provider,
    ),
  ],
);

export const subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id").notNull().unique(),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  stripePriceId: text("stripe_price_id"),
  // "free" until a Pro subscription is active/trialing; "pro" otherwise.
  plan: text("plan").notNull().default("free"),
  // Mirrors the Stripe subscription status ("trialing", "active", "past_due",
  // "canceled", etc.), or "none" before a subscription has ever been created.
  status: text("status").notNull().default("none"),
  currentPeriodEnd: timestamp("current_period_end"),
  trialEnd: timestamp("trial_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  // The Stripe event `created` timestamp of the last event applied to this
  // row. Stripe does not guarantee webhook delivery order, so a redelivered
  // older event must be detected and dropped rather than overwriting state
  // written by a newer one — see isStaleEvent in server/utils/subscriptions.ts.
  lastStripeEventAt: timestamp("last_stripe_event_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Dedup log for Stripe webhook events: Stripe explicitly documents that
// webhooks may be delivered more than once for the same event. Recording the
// event id here lets the webhook handler treat a redelivery as a no-op
// instead of reapplying it. Rows are pruned by the scheduled cleanup in
// netlify/functions/scheduled-stripe-events-cleanup.ts, which deletes rows
// whose processed_at is older than Stripe's retry window;
// processed_stripe_events_processed_at_idx below supports that range query.
export const processedStripeEvents = pgTable(
  "processed_stripe_events",
  {
    id: serial("id").primaryKey(),
    stripeEventId: text("stripe_event_id").notNull().unique(),
    eventType: text("event_type").notNull(),
    processedAt: timestamp("processed_at").notNull().defaultNow(),
  },
  (table) => [
    index("processed_stripe_events_processed_at_idx").on(table.processedAt),
  ],
);

export const userSettings = pgTable("user_settings", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  showUnreadOnly: boolean("show_unread_only").notNull().default(false),
  autoplayMediaPreviews: boolean("autoplay_media_previews")
    .notNull()
    .default(false),
  compactNotifications: boolean("compact_notifications")
    .notNull()
    .default(false),
  theme: text("theme").notNull().default("system"),
  accentColor: text("accent_color").notNull().default("violet"),
  readingFont: text("reading_font").notNull().default("serif"),
  spacing: text("spacing").notNull().default("cozy"),
  radius: text("radius").notNull().default("sharp"),
  layout: text("layout").notNull().default("timeline"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const usersRelations = relations(users, ({ many, one }) => ({
  feeds: many(feeds),
  integrations: many(integrations),
  settings: one(userSettings, {
    fields: [users.id],
    references: [userSettings.userId],
  }),
  subscription: one(subscriptions, {
    fields: [users.id],
    references: [subscriptions.userId],
  }),
}));

export const feedsRelations = relations(feeds, ({ one, many }) => ({
  user: one(users, { fields: [feeds.userId], references: [users.id] }),
  items: many(feedItems),
}));

export const feedItemsRelations = relations(feedItems, ({ one }) => ({
  feed: one(feeds, { fields: [feedItems.feedId], references: [feeds.id] }),
}));

export const integrationsRelations = relations(integrations, ({ one }) => ({
  user: one(users, { fields: [integrations.userId], references: [users.id] }),
}));

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(users, { fields: [userSettings.userId], references: [users.id] }),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  user: one(users, { fields: [subscriptions.userId], references: [users.id] }),
}));
