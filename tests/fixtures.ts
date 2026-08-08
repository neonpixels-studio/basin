// Test data factories — mirror the shape of app/data/mock.js without importing it.
// When mock.js is removed, these fixtures remain the contract for test data.

export const makeArticle = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  type: "article",
  source: "Test Source",
  handle: "test.example.com",
  title: "Test Article Title",
  excerpt: "A brief excerpt of the article content.",
  time: "2h",
  meta: "5 min read",
  tags: ["design", "web"],
  unread: true,
  saved: false,
  url: "https://test.example.com/article-1",
  content: "First paragraph.\n\nSecond paragraph.",
  ...overrides,
});

export const makeVideo = (overrides: Record<string, unknown> = {}) => ({
  id: 2,
  type: "video",
  source: "Test Channel",
  handle: "@testchannel",
  title: "Test Video Title",
  excerpt: "Video description.",
  time: "1d",
  meta: "12:34",
  unread: false,
  saved: false,
  views: "10K views",
  thumb: "https://example.com/thumb.jpg",
  content: "Full video description here.",
  url: "https://www.youtube.com/watch?v=test123",
  ...overrides,
});

export const makeTweet = (overrides: Record<string, unknown> = {}) => ({
  id: 3,
  type: "tweet",
  source: "Test User",
  handle: "@testuser",
  // `text` is the legacy card-only field; `content` is the real synced post
  // body (@todo migrate TweetCard off `text` onto `content`).
  text: "This is a test tweet body text.",
  content: "This is a test tweet body text.",
  time: "3h",
  meta: "42 · 12",
  unread: true,
  saved: false,
  ...overrides,
});

export const makePodcast = (overrides: Record<string, unknown> = {}) => ({
  id: 4,
  type: "podcast",
  source: "Test Podcast",
  handle: "podcast.example.com",
  title: "Test Episode Title",
  excerpt: "Episode excerpt.",
  time: "1d",
  meta: "45:00",
  unread: false,
  saved: false,
  thumb: "https://example.com/cover.jpg",
  progress: 0.3,
  url: "https://podcast.example.com/episode-1",
  mediaUrl: "https://podcast.example.com/episode-1.mp3",
  content: "Show note one.\n\nShow note two.",
  mediaDuration: 2700,
  ...overrides,
});

export const makeFeed = (overrides: Record<string, unknown> = {}) => ({
  id: "f1",
  type: "rss",
  name: "Test Feed",
  url: "test.example.com/feed.xml",
  count: 5,
  color: "var(--src-rss)",
  status: "ok",
  ...overrides,
});

export const makeConnection = (overrides: Record<string, unknown> = {}) => ({
  id: "youtube",
  name: "YouTube",
  desc: "Subscribe to channels",
  connected: false,
  account: "",
  color: "var(--src-video)",
  since: "",
  needsReconnect: false,
  syncError: null,
  ...overrides,
});
