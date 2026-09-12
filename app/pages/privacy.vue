<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";

definePageMeta({ layout: "marketing" });

useMarketingSeo(
  "Reader — privacy",
  "How Reader handles your data — written to be read, not skimmed past.",
);

const sections = [
  { id: "overview", label: "Overview" },
  { id: "collect", label: "What we collect" },
  { id: "use", label: "How we use it" },
  { id: "sources", label: "Connected sources" },
  { id: "sharing", label: "Sharing" },
  { id: "retention", label: "Retention" },
  { id: "rights", label: "Your rights" },
  { id: "contact", label: "Contact" },
];

const activeId = ref(sections[0].id);
let observer: IntersectionObserver | null = null;

onMounted(() => {
  const targets = sections
    .map((section) => document.getElementById(section.id))
    .filter((element): element is HTMLElement => element !== null);

  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          activeId.value = entry.target.id;
        }
      });
    },
    { rootMargin: "-20% 0px -70% 0px", threshold: 0 },
  );

  targets.forEach((target) => observer?.observe(target));
});

onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div class="wrap page-top">
    <span class="eyebrow dot" style="justify-content: center">Legal</span>
    <h1 class="page-h1">Privacy policy.</h1>
    <p class="page-sub">
      How Reader handles your data — written to be read, not skimmed past. This
      is placeholder copy for now and not legal advice.
    </p>
    <p class="legal-updated" style="margin-top: 18px">
      Last updated · 22 June 2026
    </p>
  </div>

  <section class="section" style="border-top: 0; padding-top: 52px">
    <div class="wrap">
      <div class="legal">
        <aside class="toc">
          <span class="toc-lbl">Contents</span>
          <a
            v-for="section in sections"
            :key="section.id"
            :href="`#${section.id}`"
            :class="{ active: activeId === section.id }"
            >{{ section.label }}</a
          >
        </aside>

        <div class="legal-body">
          <div class="legal-summary">
            <span class="eyebrow dot">In short</span>
            <p>
              We collect the minimum needed to show your feeds, we never sell
              your data, and you can export or delete everything at any time.
              The full version below replaces this placeholder.
            </p>
          </div>

          <h2 id="overview"><span class="hnum">01</span>Overview</h2>
          <p>
            Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do
            eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim
            ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut
            aliquip ex ea commodo consequat.
          </p>
          <p>
            Duis aute irure dolor in reprehenderit in voluptate velit esse
            cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat
            cupidatat non proident, sunt in culpa qui officia deserunt mollit
            anim id est laborum.
          </p>

          <h2 id="collect"><span class="hnum">02</span>What we collect</h2>
          <p>
            Sed ut perspiciatis unde omnis iste natus error sit voluptatem
            accusantium doloremque laudantium, totam rem aperiam. We keep this
            list short on purpose:
          </p>
          <ul>
            <li>
              Account basics — your email address and authentication tokens.
            </li>
            <li>The sources you add and the read/unread state of items.</li>
            <li>Minimal diagnostics needed to keep feeds fetching reliably.</li>
          </ul>
          <p>
            At vero eos et accusamus et iusto odio dignissimos ducimus qui
            blanditiis praesentium voluptatum deleniti atque corrupti quos
            dolores et quas molestias.
          </p>

          <h2 id="use"><span class="hnum">03</span>How we use it</h2>
          <p>
            Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut
            fugit, sed quia consequuntur magni dolores eos qui ratione
            voluptatem sequi nesciunt. Neque porro quisquam est, qui dolorem
            ipsum quia dolor sit amet.
          </p>
          <p>
            Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse
            quam nihil molestiae consequatur, vel illum qui dolorem eum fugiat
            quo voluptas nulla pariatur.
          </p>

          <h2 id="sources"><span class="hnum">04</span>Connected sources</h2>
          <p>
            Temporibus autem quibusdam et aut officiis debitis aut rerum
            necessitatibus saepe eveniet ut et voluptates repudiandae sint et
            molestiae non recusandae. When you connect an account such as
            YouTube or Bluesky, we request only the read scopes required to
            fetch your feed.
          </p>
          <p>
            Itaque earum rerum hic tenetur a sapiente delectus, ut aut
            reiciendis voluptatibus maiores alias consequatur aut perferendis
            doloribus asperiores repellat.
          </p>

          <h2 id="sharing">
            <span class="hnum">05</span>Sharing &amp; selling
          </h2>
          <p>
            We do not sell your data. Et harum quidem rerum facilis est et
            expedita distinctio. Nam libero tempore, cum soluta nobis est
            eligendi optio cumque nihil impedit quo minus id quod maxime placeat
            facere possimus.
          </p>

          <h2 id="retention"><span class="hnum">06</span>Retention</h2>
          <p>
            Omnis voluptas assumenda est, omnis dolor repellendus. Temporibus
            autem quibusdam et aut officiis debitis aut rerum necessitatibus
            saepe eveniet. We retain your data only as long as your account is
            active, plus a short grace period.
          </p>

          <h2 id="rights"><span class="hnum">07</span>Your rights</h2>
          <p>
            You can export everything you've stored in Reader at any time, and
            deleting your account removes your data on our standard schedule. Ut
            enim ad minima veniam, quis nostrum exercitationem ullam corporis
            suscipit laboriosam.
          </p>
          <ul>
            <li>Access — request a copy of your data.</li>
            <li>Export — download your sources and saved items.</li>
            <li>Deletion — remove your account and associated data.</li>
          </ul>

          <h2 id="contact"><span class="hnum">08</span>Contact</h2>
          <p>
            Questions about this policy? Quia consequuntur magni dolores eos —
            reach us any time at
            <NuxtLink to="/contact" class="legal-link"
              >our contact page</NuxtLink
            >
            or email
            <a href="mailto:privacy@reader.app" class="legal-link"
              >privacy@reader.app</a
            >.
          </p>
        </div>
      </div>
    </div>
  </section>
</template>

<style>
.legal-link {
  color: var(--accent);
  text-decoration: none;
}
</style>
