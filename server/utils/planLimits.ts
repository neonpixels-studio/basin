// The Free plan's advertised source cap — the server-side source of truth for
// enforcement. Must stay in sync with the "Up to 10 sources" copy on the
// pricing page (app/pages/pricing.vue), which states the number in prose.
//
// Kept in this dependency-free leaf module so both the add-time gate
// (server/utils/feedLimit.ts) and the downgrade-time pause
// (server/utils/feedPause.ts) can share one cap without creating an import
// cycle through server/utils/subscriptions.ts (which feedLimit imports).
export const FREE_PLAN_FEED_LIMIT = 10;
