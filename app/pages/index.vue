<script setup lang="ts">
definePageMeta({ layout: "marketing" });

// The auth middleware redirects signed-in users away from "/" during route
// navigation, but Clerk hydrates asynchronously after the initial render.
// This watcher catches the case where Clerk's isSignedIn flips to true after
// the middleware has already let the request through.
const { isSignedIn } = useAuth();
watch(
  isSignedIn,
  (signedIn) => {
    if (signedIn) {
      navigateTo("/dashboard");
    }
  },
  { immediate: true },
);

useMarketingSeo(
  "Reader — all your feeds, one quiet page",
  "Stop checking multiple apps. Reader folds RSS, podcasts, YouTube and Bluesky into one timeline — no ranking, no ads, no doomscroll.",
);
</script>

<template>
  <!-- ============ HERO ============ -->
  <section class="hero">
    <div class="hero-glow" style="left: 88%; top: -300px" />
    <div class="wrap hero-b-in">
      <div>
        <span class="eyebrow dot w-full!">One feed · every source</span>
        <h1 class="hero-h1">
          Your whole internet,<br />in
          <span class="lav">chronological</span> order.
        </h1>
        <p class="hero-sub">
          Stop checking five apps. Reader folds RSS, podcasts, YouTube and
          Bluesky into one timeline — no ranking, no ads, no doomscroll. Just
          the things you chose to follow.
        </p>
        <div class="hero-ctas">
          <NuxtLink to="/login" class="btn btn-primary btn-lg">
            Start reading free
            <RIcon name="arrowRight" :size="17" />
          </NuxtLink>
          <NuxtLink to="/pricing" class="btn btn-lg">See pricing</NuxtLink>
        </div>
        <p class="hero-note">
          <RIcon name="check" :size="15" />
          Free for up to 10 sources · No credit card needed
        </p>
      </div>
      <div class="mock" aria-hidden="true">
        <div class="mock-bar">
          <span class="mock-dot" />
          <span class="mock-dot" />
          <span class="mock-dot" />
          <span class="mock-url">
            <RIcon name="lock" :size="13" />
            reader.app/dashboard
          </span>
        </div>
        <div class="mock-body">
          <div class="card unread">
            <div class="card-head tight">
              <SourceTag
                :item="{ type: 'article', source: 'Stratechery', time: '2h' }"
              />
            </div>
            <h3 class="card-title">
              The quiet web: why chronological feeds are coming back
            </h3>
            <p class="card-excerpt sm">
              For a decade the timeline was something to be optimised. A small
              countertrend says the best feed is simply the one that ends.
            </p>
            <div class="card-foot">
              <div class="chips">
                <span class="chip">#media</span>
                <span class="chip">#rss</span>
              </div>
              <span class="card-meta">6 min read</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- ============ SOURCES STRIP ============ -->
  <div class="wrap">
    <div class="logos">
      <span class="lbl">Pulls from</span>
      <b>RSS / Atom</b>
      <b>Apple Podcasts</b>
      <b>YouTube</b>
      <b>Bluesky</b>
      <b>JSON Feed</b>
    </div>
  </div>

  <!-- ============ FEATURES ============ -->
  <section id="features" class="section">
    <div class="wrap">
      <div class="sec-head">
        <div>
          <span class="eyebrow">What makes it quiet</span>
          <h2 class="sec-title">Built for reading,<br />not for engagement.</h2>
        </div>
        <p class="sec-lede">
          Every decision in Reader points the same way: fewer interruptions,
          more of the things you actually chose to follow.
        </p>
      </div>
      <div class="feat-grid">
        <div class="feature">
          <span class="fnum">01</span>
          <span class="feat-ic">
            <RIcon name="inbox" :size="20" />
          </span>
          <h3>One unified feed</h3>
          <p>
            Articles, episodes, videos and posts land in a single stream you can
            read top to bottom.
          </p>
        </div>
        <div class="feature">
          <span class="fnum">02</span>
          <span class="feat-ic">
            <RIcon name="list" :size="20" />
          </span>
          <h3>Strictly chronological</h3>
          <p>
            Newest first, always. No ranking model decides what you see or hides
            what you don't.
          </p>
        </div>
        <div class="feature">
          <span class="fnum">03</span>
          <span class="feat-ic">
            <RIcon name="link" :size="20" />
          </span>
          <h3>Connect anything</h3>
          <p>
            Paste any feed URL or link an account. Reader auto-detects the type
            and starts pulling.
          </p>
        </div>
        <div class="feature">
          <span class="fnum">04</span>
          <span class="feat-ic">
            <RIcon name="search" :size="20" />
          </span>
          <h3>Search everything</h3>
          <p>
            One <span class="kbd">⌘K</span> palette across every source, tag and
            saved item you've ever followed.
          </p>
        </div>
        <div class="feature">
          <span class="fnum">05</span>
          <span class="feat-ic">
            <RIcon name="sun" :size="20" />
          </span>
          <h3>Read it your way</h3>
          <p>
            Timeline, grid or per-source columns. Mono or serif. Light or dark.
            Tune the density to taste.
          </p>
        </div>
        <div class="feature">
          <span class="fnum">06</span>
          <span class="feat-ic">
            <RIcon name="shield" :size="20" />
          </span>
          <h3>Private by default</h3>
          <p>
            No tracking, no resale, no engagement metrics. Your reading is yours
            — export it anytime.
          </p>
        </div>
      </div>
    </div>
  </section>

  <!-- ============ HOW IT WORKS ============ -->
  <section id="how" class="section">
    <div class="wrap">
      <div class="sec-head">
        <div>
          <span class="eyebrow">How it works</span>
          <h2 class="sec-title">Three steps to a calmer feed.</h2>
        </div>
      </div>
      <div class="steps">
        <div class="step">
          <span class="k">STEP 01</span>
          <h3>Add your sources</h3>
          <p>
            Paste feed URLs or connect YouTube and Bluesky in a couple of
            clicks.
          </p>
        </div>
        <div class="step">
          <span class="k">STEP 02</span>
          <h3>Reader fetches</h3>
          <p>
            We pull new items in the background and merge them into one
            chronological timeline.
          </p>
        </div>
        <div class="step">
          <span class="k">STEP 03</span>
          <h3>Read in peace</h3>
          <p>
            Skim, save, or open the original. Mark all read and close the tab
            guilt-free.
          </p>
        </div>
      </div>
    </div>
  </section>

  <!-- ============ QUOTE ============ -->
  <section class="section">
    <div class="wrap quote-wrap">
      <span class="eyebrow">Why people switch</span>
      <p class="quote" style="margin-top: 18px">
        "I replaced four apps and a dozen open tabs with one page. It's the
        first feed in years that <span class="lav">ends</span> — and that's the
        whole point."
      </p>
      <div class="quote-by">
        <span class="av">DK</span>
        <div>
          <b style="color: var(--ink); font-weight: 600">Dana Kessler</b>
          · independent writer<br />
          <span style="color: var(--faint)">reads ~40 sources daily</span>
        </div>
      </div>
    </div>
  </section>

  <!-- ============ CTA BAND ============ -->
  <section class="section">
    <div class="wrap">
      <div class="cta-band">
        <span class="eyebrow dot w-full!" style="justify-content: center">
          Start in under a minute
        </span>
        <h2>Bring your feeds home.</h2>
        <p>
          Free forever for up to 10 sources. Upgrade only when you outgrow it.
        </p>
        <div class="hero-ctas">
          <NuxtLink to="/login" class="btn btn-primary btn-lg">
            Start free
            <RIcon name="arrowRight" :size="17" />
          </NuxtLink>
          <NuxtLink to="/pricing" class="btn btn-lg">Compare plans</NuxtLink>
        </div>
      </div>
    </div>
  </section>
</template>
