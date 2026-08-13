<script setup>
import { computed, ref, watch } from "vue";
import { durationLabel } from "~/utils/duration";
import { VIDEO_PLACEHOLDER_LABEL } from "~/utils/itemContent";

const feedStore = useFeedStore();
const player = usePodcastPlayer();

const item = computed(() => feedStore.state.activeItem);

const EMPTY_ARTICLE_TEXT =
  "No article text was included in this feed. Open the original to read the full piece.";
const EMPTY_PODCAST_TEXT = "No show notes were included for this episode.";
const EMPTY_VIDEO_TEXT = "No description was included for this video.";
const EMPTY_POST_TEXT = "This post has no text.";

const paragraphs = computed(() =>
  item.value ? feedStore.contentParagraphs(item.value) : [],
);
// Sanitized HTML for markup-bearing feed content; "" falls back to the plain
// text paragraphs above.
const contentHtml = computed(() =>
  item.value ? feedStore.contentHtml(item.value) : "",
);
// The post/tweet body is shown verbatim as text, so it uses the ungated
// plain-text paragraphs rather than the markup-aware contentParagraphs.
const postText = computed(() =>
  item.value ? feedStore.postParagraphs(item.value).join("\n\n") : "",
);

const podcastMediaUrl = computed(() => item.value?.mediaUrl || null);
const podcastCanPlay = computed(() => player.canPlay(podcastMediaUrl.value));
const podcastActive = computed(() => player.isActive(podcastMediaUrl.value));
const podcastPlaying = computed(() => player.isPlaying(podcastMediaUrl.value));

const podcastProgressPct = computed(() =>
  podcastActive.value ? Math.round(player.progress * 100) : 0,
);

const podcastCurrentLabel = computed(() =>
  player.formatTime(podcastActive.value ? player.state.currentTime : 0),
);

const podcastTotalLabel = computed(() => {
  if (podcastActive.value && player.state.duration > 0) {
    return player.formatTime(player.state.duration);
  }
  return durationLabel(item.value?.mediaDuration);
});

// Feed thumbnails are untrusted cross-origin URLs; on a load failure fall back
// to the striped placeholder instead of a broken-image glyph. This detail view
// is a single persistent instance reused as the reader navigates between items,
// so reset the failure flag whenever the thumbnail URL changes (keyed on the
// URL, not the id, so a re-synced item with a new image recovers too).
const videoImageFailed = ref(false);
watch(
  () => item.value?.imageUrl,
  () => {
    videoImageFailed.value = false;
  },
);

const videoThumbnailUrl = computed(() =>
  item.value?.imageUrl && !videoImageFailed.value ? item.value.imageUrl : null,
);

const videoDurationLabel = computed(() =>
  durationLabel(item.value?.mediaDuration),
);

function togglePodcast() {
  player.toggle(podcastMediaUrl.value);
}

const ALLOWED_URL_PROTOCOLS = ["https:", "http:"];

function isSafeUrl(url) {
  try {
    const parsed = new URL(url);
    return ALLOWED_URL_PROTOCOLS.includes(parsed.protocol);
  } catch {
    return false;
  }
}

function openUrl(url) {
  if (!url || !isSafeUrl(url)) {
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function safeHref(url) {
  return isSafeUrl(url) ? url : null;
}

function openOriginal() {
  openUrl(item.value?.url);
}
</script>

<template>
  <div v-if="item" class="detail-scrim" @click.self="feedStore.closeDetail">
    <div class="detail-sheet">
      <div class="detail-head">
        <SourceTag :item="item" />
        <div class="ml-auto flex items-center gap-0.5">
          <button
            class="icon-btn"
            title="Previous (←)"
            @click="feedStore.detailNav(-1)"
          >
            <RIcon
              name="chevRight"
              :size="16"
              style="transform: rotate(180deg)"
            />
          </button>
          <button
            class="icon-btn"
            title="Next (→)"
            @click="feedStore.detailNav(1)"
          >
            <RIcon name="chevRight" :size="16" />
          </button>
          <span class="bg-border mx-1 h-5 w-px"></span>
          <button
            class="icon-btn"
            :class="{ on: item.saved }"
            :title="item.saved ? 'Saved' : 'Save for later'"
            @click="feedStore.toggleSave(item)"
          >
            <RIcon
              :name="item.saved ? 'bookmarkFill' : 'bookmark'"
              :size="16"
            />
          </button>
          <button class="icon-btn" title="Open original" @click="openOriginal">
            <RIcon name="external" :size="16" />
          </button>
          <button
            class="icon-btn"
            title="Close (esc)"
            @click="feedStore.closeDetail"
          >
            <RIcon name="x" :size="18" />
          </button>
        </div>
      </div>

      <div class="detail-body">
        <!-- loading shimmer -->
        <div v-if="feedStore.state.detailLoading" class="p-7 sm:p-9">
          <div class="sk mb-6 h-3.5 w-1/3"></div>
          <div class="sk mb-3 h-7 w-5/6"></div>
          <div class="sk mb-8 h-7 w-2/3"></div>
          <div class="sk mb-3 h-3.5 w-full"></div>
          <div class="sk mb-3 h-3.5 w-full"></div>
          <div class="sk h-3.5 w-4/5"></div>
        </div>

        <template v-else>
          <!-- ARTICLE -->
          <article v-if="item.type === 'article'" class="p-7 sm:p-9">
            <div
              v-if="item.tags"
              class="mb-4 flex flex-wrap items-center gap-2"
            >
              <span v-for="t in item.tags" :key="t" class="chip">#{{ t }}</span>
            </div>
            <h1 class="detail-title mb-4">{{ item.title }}</h1>
            <div
              class="text-muted mb-7 pb-7 text-[12.5px]"
              style="border-bottom: 1px solid var(--border)"
            >
              {{ item.source }} · {{ item.time }} ago
            </div>
            <DetailProse
              :paragraphs="paragraphs"
              :sanitized-html="contentHtml"
              :empty-text="EMPTY_ARTICLE_TEXT"
            />
            <a
              v-if="safeHref(item.url)"
              :href="safeHref(item.url)"
              target="_blank"
              rel="noopener noreferrer"
              class="btn mt-8"
            >
              <RIcon name="external" :size="15" /> Open original
            </a>
          </article>

          <!-- VIDEO -->
          <div v-else-if="item.type === 'video'">
            <div
              class="thumb ratio-16x9"
              :class="{ ph: !videoThumbnailUrl }"
              :data-label="
                videoThumbnailUrl ? undefined : VIDEO_PLACEHOLDER_LABEL
              "
              style="border-radius: 0"
            >
              <img
                v-if="videoThumbnailUrl"
                class="thumb-img"
                :src="videoThumbnailUrl"
                alt=""
                loading="lazy"
                referrerpolicy="no-referrer"
                @error="videoImageFailed = true"
              />
              <span class="thumb-play" style="width: 64px; height: 64px"
                ><RIcon name="play" :size="28"
              /></span>
              <span v-if="videoDurationLabel" class="thumb-dur">{{
                videoDurationLabel
              }}</span>
            </div>
            <div class="p-7 sm:p-8">
              <h2 class="detail-title mb-3" style="font-size: 22px">
                {{ item.title }}
              </h2>
              <div
                class="text-muted mb-6 flex flex-wrap items-center gap-2.5 pb-6 text-[12.5px]"
                style="border-bottom: 1px solid var(--border)"
              >
                <span class="src-ic src-video" style="--c: var(--src-video)"
                  ><RIcon name="video" :size="13"
                /></span>
                <b class="text-ink-2 font-medium">{{ item.source }}</b
                ><template v-if="videoDurationLabel"
                  ><span>·</span><span>{{ videoDurationLabel }}</span></template
                >
              </div>
              <DetailProse
                :paragraphs="paragraphs"
                :sanitized-html="contentHtml"
                :empty-text="EMPTY_VIDEO_TEXT"
              />
              <a
                v-if="safeHref(item.url)"
                :href="safeHref(item.url)"
                target="_blank"
                rel="noopener noreferrer"
                class="btn btn-primary mt-7"
              >
                <RIcon name="play" :size="15" /> Watch on YouTube
              </a>
            </div>
          </div>

          <!-- PODCAST -->
          <div v-else-if="item.type === 'podcast'" class="p-7 sm:p-8">
            <div class="mb-6 flex gap-4">
              <div
                class="ph ratio-1x1"
                data-label="cover"
                style="
                  width: 96px;
                  height: 96px;
                  flex: none;
                  color: var(--src-podcast);
                "
              >
                <RIcon name="mic" :size="24" />
              </div>
              <div class="min-w-0 self-center">
                <div class="text-muted mb-1.5 text-[12px]">
                  {{ item.source }}
                </div>
                <h2 class="detail-title" style="font-size: 20px">
                  {{ item.title }}
                </h2>
              </div>
            </div>
            <div
              class="mb-7 rounded-sm p-4"
              style="background: var(--surface-2)"
            >
              <div class="mb-3 flex items-center gap-3">
                <button
                  class="pod-play"
                  style="width: 44px; height: 44px"
                  :title="podcastPlaying ? 'Pause episode' : 'Play episode'"
                  :disabled="!podcastCanPlay"
                  @click="togglePodcast"
                >
                  <RIcon :name="podcastPlaying ? 'pause' : 'play'" :size="18" />
                </button>
                <div class="flex-1">
                  <div
                    class="scrubber"
                    :class="{ 'scrubber-seekable': podcastActive }"
                    @click="player.scrubTo(podcastMediaUrl, $event)"
                  >
                    <i :style="{ width: podcastProgressPct + '%' }"></i>
                  </div>
                </div>
              </div>
              <div
                class="text-muted flex items-center justify-between text-[11px]"
              >
                <span>{{ podcastCurrentLabel }}</span>
                <div class="flex gap-1.5">
                  <span class="kbd">1.0×</span
                  ><button
                    type="button"
                    class="kbd"
                    :disabled="!podcastActive"
                    @click="player.seekBy(player.seekStep)"
                  >
                    +{{ player.seekStep }}s
                  </button>
                </div>
                <span>{{ podcastTotalLabel }}</span>
              </div>
            </div>
            <div class="text-faint mb-3 text-[10px] tracking-[.14em] uppercase">
              Show notes
            </div>
            <DetailProse
              :paragraphs="paragraphs"
              :sanitized-html="contentHtml"
              :empty-text="EMPTY_PODCAST_TEXT"
            />
          </div>

          <!-- TWEET -->
          <div v-else-if="item.type === 'tweet'" class="p-7 sm:p-8">
            <div class="mb-5 flex items-center gap-3">
              <span
                class="avatar src-tweet"
                style="width: 48px; height: 48px; font-size: 16px"
                >{{
                  item.source
                    .split(" ")
                    .map((s) => s[0])
                    .slice(0, 2)
                    .join("")
                }}</span
              >
              <div class="min-w-0">
                <b class="text-ink block text-[15px] font-semibold">{{
                  item.source
                }}</b>
                <span class="text-muted text-[13px]">{{ item.handle }}</span>
              </div>
              <span class="src-tweet ml-auto"
                ><RIcon name="chat" :size="20"
              /></span>
            </div>
            <p v-if="postText" class="detail-tweet mb-5">{{ postText }}</p>
            <p v-else class="detail-tweet text-muted mb-5">
              {{ EMPTY_POST_TEXT }}
            </p>
            <div class="text-muted text-[12px]">{{ item.time }} ago</div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style>
.detail-scrim {
  position: fixed;
  inset: 0;
  z-index: 110;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  background: color-mix(in oklab, var(--bg) 36%, #00000066);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.detail-sheet {
  width: min(760px, calc(100vw - 28px));
  margin: 7vh 0 5vh;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  animation: popSafe 0.22s var(--ease);
}
.detail-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px 14px;
  border-bottom: 1px solid var(--border);
  flex: none;
}
.detail-body {
  overflow-y: auto;
}
.detail-prose p,
.detail-prose div {
  margin: 0 0 17px;
  font-size: 16px;
  line-height: 1.7;
  color: var(--ink-2);
  text-wrap: pretty;
}
.detail-prose > :last-child {
  margin-bottom: 0;
}
/* Sanitized feed markup (links, lists, emphasis) rendered via contentHtml. */
.detail-prose a {
  color: var(--accent);
  text-decoration: underline;
}
.detail-prose ul,
.detail-prose ol {
  margin: 0 0 17px;
  padding-left: 1.4em;
  font-size: 16px;
  line-height: 1.7;
  color: var(--ink-2);
}
.detail-prose ul {
  list-style: disc;
}
.detail-prose ol {
  list-style: decimal;
}
.detail-prose li {
  margin-bottom: 6px;
}
.detail-prose blockquote {
  margin: 0 0 17px;
  padding-left: 14px;
  border-left: 3px solid var(--border-strong);
  color: var(--ink-2);
}
/* Preflight resets heading sizing, so give sanitized feed headings visible
   hierarchy rather than letting them read as body text. */
.detail-prose h1,
.detail-prose h2,
.detail-prose h3,
.detail-prose h4,
.detail-prose h5,
.detail-prose h6 {
  margin: 0 0 12px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--ink);
}
.detail-prose h1 {
  font-size: 22px;
}
.detail-prose h2 {
  font-size: 20px;
}
.detail-prose h3 {
  font-size: 18px;
}
.detail-prose h4,
.detail-prose h5,
.detail-prose h6 {
  font-size: 16px;
}
.detail-prose code {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.9em;
  background: var(--surface-2);
  padding: 0.1em 0.35em;
  border-radius: 4px;
}
.detail-prose pre {
  margin: 0 0 17px;
  padding: 12px 14px;
  background: var(--surface-2);
  border-radius: 6px;
  overflow-x: auto;
}
.detail-prose pre code {
  background: none;
  padding: 0;
}
.detail-prose hr {
  margin: 20px 0;
  border: 0;
  border-top: 1px solid var(--border);
}
.detail-prose table {
  margin: 0 0 17px;
  border-collapse: collapse;
  font-size: 14px;
  color: var(--ink-2);
}
.detail-prose th,
.detail-prose td {
  padding: 6px 10px;
  border: 1px solid var(--border);
  text-align: left;
}
.detail-title {
  font-size: 27px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.2;
  color: var(--ink);
  text-wrap: pretty;
  margin: 0;
}
.detail-tweet {
  font-size: 21px;
  line-height: 1.5;
  color: var(--ink);
  text-wrap: pretty;
  white-space: pre-line;
  margin: 0;
}
.scrubber {
  height: 6px;
  border-radius: 999px;
  background: var(--surface-2);
  overflow: hidden;
}
.scrubber-seekable {
  cursor: pointer;
}
.pod-play:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
button.kbd:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.scrubber > i {
  display: block;
  height: 100%;
  background: var(--src-podcast);
  border-radius: 999px;
  position: relative;
}
.scrubber > i::after {
  content: "";
  position: absolute;
  right: -5px;
  top: 50%;
  transform: translateY(-50%);
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--src-podcast);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
}
</style>
