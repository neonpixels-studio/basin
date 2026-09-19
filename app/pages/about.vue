<script setup lang="ts">
definePageMeta({ layout: "marketing" });

useMarketingSeo(
  "Reader — about",
  "Reader is a small, independent team building one calm page for the feeds you already care about — no ranking, no ads, no infinite scroll.",
);

const values = [
  {
    icon: "list",
    title: "Time, not engagement",
    body: "Newest first, always. We will never reorder your feed to make you stay longer.",
  },
  {
    icon: "shield",
    title: "Your reading is yours",
    body: "No tracking, no resale, no profile. Export everything, anytime, and walk away clean.",
  },
  {
    icon: "check",
    title: "A feed that ends",
    body: "Catching up should be a finite task. Reach the bottom, close the tab, get on with your day.",
  },
  {
    icon: "link",
    title: "Open by default",
    body: "Standards over lock-in. If it has a feed, Reader should read it — no walled gardens.",
  },
  {
    icon: "sun",
    title: "Calm is a feature",
    body: "Every pixel earns its place. If it adds noise, it doesn't ship — restraint is the design.",
  },
  {
    icon: "pulse",
    title: "Small on purpose",
    body: "A tiny team, funded by people who pay for the product — not by selling the people using it.",
  },
];

const story = [
  {
    year: "2024",
    title: "A weekend hack",
    body: "Built to merge our own RSS and podcast feeds into one list — mostly to stop opening the same six tabs every morning.",
  },
  {
    year: "2025",
    title: "Friends wanted in",
    body: "YouTube and Bluesky landed, the timeline got search, and a handful of fellow knowledge-workers started living in it daily.",
  },
  {
    year: "2026",
    title: "Open to everyone",
    body: "Reader is public, free for up to ten sources, and still run by the same tiny team — quietly, deliberately, on purpose.",
  },
];

const team = [
  { name: "Mara Velez", role: "Co-founder · product" },
  { name: "Theo Ansel", role: "Co-founder · engineering" },
  { name: "Priya Raman", role: "Design" },
  { name: "Jonas Beck", role: "Feeds & infrastructure" },
];
</script>

<template>
  <div class="wrap page-top">
    <span class="eyebrow dot" style="justify-content: center">About</span>
    <h1 class="page-h1">A quieter place<br />for everything you follow.</h1>
    <p class="page-sub">
      Reader is a small, independent team building one calm page for the feeds
      you already care about — no ranking, no ads, no infinite scroll.
    </p>
  </div>

  <section class="section" style="border-top: 0; padding-top: 56px">
    <div class="wrap">
      <div class="about-b-in">
        <div class="lead">
          <p>
            Keeping up had quietly become a second job — five apps, a dozen
            tabs, each one tuned to keep you scrolling rather than to let you
            <span class="lav">finish</span>.
          </p>
          <p class="dim">
            Reader is our answer: one chronological stream for RSS, podcasts,
            YouTube and Bluesky, with no algorithm deciding what you missed and
            no metrics counting how long you stayed.
          </p>
        </div>
        <div class="mock">
          <div class="mock-bar">
            <span class="mock-dot" />
            <span class="mock-dot" />
            <span class="mock-dot" />
            <span class="mock-url">
              <RIcon name="lock" :size="13" />
              reader.app/dashboard
            </span>
          </div>
          <div
            class="ph"
            data-label="one quiet timeline"
            style="aspect-ratio: 16/10; border-radius: 0"
          />
        </div>
      </div>

      <div class="story" style="margin-top: 60px">
        <div v-for="entry in story" :key="entry.year" class="story-item">
          <span class="yr">{{ entry.year }}</span>
          <div>
            <h3>{{ entry.title }}</h3>
            <p>{{ entry.body }}</p>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="wrap">
      <div class="sec-head">
        <div>
          <span class="eyebrow">What we believe</span>
          <h2 class="sec-title">A few principles<br />we don't bend on.</h2>
        </div>
        <p class="sec-lede">
          They sound obvious written down. Most feeds are built on the exact
          opposite — which is rather the point.
        </p>
      </div>
      <div class="feat-grid">
        <div
          v-for="(value, index) in values"
          :key="value.title"
          class="feature"
        >
          <span class="fnum">{{ String(index + 1).padStart(2, "0") }}</span>
          <span class="feat-ic">
            <RIcon :name="value.icon" :size="20" />
          </span>
          <h3>{{ value.title }}</h3>
          <p>{{ value.body }}</p>
        </div>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="wrap">
      <div class="sec-head">
        <div>
          <span class="eyebrow">Who's building it</span>
          <h2 class="sec-title">Four people<br />and a lot of feeds.</h2>
        </div>
        <p class="sec-lede">
          We're readers first. Every one of us uses Reader to keep up with our
          own corners of the internet.
        </p>
      </div>
      <div class="team">
        <div v-for="member in team" :key="member.name" class="member">
          <div class="ph pfp" data-label="photo" />
          <div class="nm">{{ member.name }}</div>
          <div class="rl">{{ member.role }}</div>
        </div>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="wrap">
      <div class="cta-band">
        <span class="eyebrow dot" style="justify-content: center">
          Read with us
        </span>
        <h2>Bring your feeds home.</h2>
        <p>
          Free forever for up to 10 sources. Questions first? We're easy to
          reach.
        </p>
        <div class="hero-ctas">
          <NuxtLink to="/login" class="btn btn-primary btn-lg">
            Start free
            <RIcon name="arrowRight" :size="17" />
          </NuxtLink>
          <NuxtLink to="/contact" class="btn btn-lg">Talk to us</NuxtLink>
        </div>
      </div>
    </div>
  </section>
</template>
