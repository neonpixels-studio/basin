<script setup lang="ts">
import { ref } from "vue";

definePageMeta({ layout: "marketing" });

useMarketingSeo(
  "Reader — contact",
  "Bug, feature idea, a source you wish we supported, or just hello — it all reaches the same small team.",
);

const CONTACT_EMAIL = "hello@reader.app";

const form = ref<HTMLFormElement | null>(null);
const sent = ref(false);
const submitting = ref(false);
const error = ref<string | null>(null);

// Submits to Netlify Forms. The form is registered at build time via the
// static definition in public/__forms.html; here we POST the encoded fields
// to the site root, which Netlify intercepts when `form-name` matches.
async function handleSubmit() {
  if (!form.value || submitting.value) {
    return;
  }
  if (!form.value.checkValidity()) {
    form.value.reportValidity();
    return;
  }

  submitting.value = true;
  error.value = null;
  try {
    const entries = [...new FormData(form.value).entries()].map(
      ([key, value]) => [key, String(value)],
    );
    const response = await fetch("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(entries).toString(),
    });
    if (!response.ok) {
      throw new Error(`Submission failed with status ${response.status}`);
    }
    sent.value = true;
  } catch {
    error.value = `Something went wrong sending your message. Please email ${CONTACT_EMAIL} instead.`;
  } finally {
    submitting.value = false;
  }
}

const socials = [
  {
    icon: "bluesky",
    name: "Bluesky",
    handle: "@reader.app",
    url: "https://bsky.app/profile/reader.app",
  },
  {
    icon: "youtube",
    name: "YouTube",
    handle: "/reader",
    url: "https://www.youtube.com/@reader",
  },
  {
    icon: "github",
    name: "GitHub",
    handle: "/reader-app",
    url: "https://github.com/reader-app",
  },
];
</script>

<template>
  <div class="wrap page-top">
    <span class="eyebrow dot" style="justify-content: center">Contact</span>
    <h1 class="page-h1">Say hello.</h1>
    <p class="page-sub">
      Bug, feature idea, a source you wish we supported, or just hello — it all
      reaches the same small team. We usually reply within a day.
    </p>
  </div>

  <section class="section" style="border-top: 0; padding-top: 48px">
    <div class="wrap">
      <div class="contact-grid">
        <div class="contact-card" :class="{ sent }">
          <form
            ref="form"
            class="contact-form"
            name="contact"
            method="POST"
            data-netlify="true"
            netlify-honeypot="bot-field"
            @submit.prevent="handleSubmit"
          >
            <input type="hidden" name="form-name" value="contact" />
            <p class="hidden">
              <label>Don't fill this out: <input name="bot-field" /></label>
            </p>
            <div class="fgroup">
              <label for="contact-name">Name <span class="req">*</span></label>
              <div class="field">
                <input
                  id="contact-name"
                  type="text"
                  name="name"
                  placeholder="Jane Reader"
                  required
                />
              </div>
            </div>
            <div class="fgroup">
              <label for="contact-email"
                >Email <span class="req">*</span></label
              >
              <div class="field">
                <input
                  id="contact-email"
                  type="email"
                  name="email"
                  placeholder="jane@example.com"
                  required
                />
              </div>
            </div>
            <div class="fgroup">
              <label for="contact-message">
                Message <span class="req">*</span>
              </label>
              <div class="field area">
                <textarea
                  id="contact-message"
                  name="message"
                  placeholder="What's on your mind?"
                  required
                />
              </div>
            </div>

            <div class="form-actions">
              <button
                type="submit"
                class="btn btn-primary"
                :disabled="submitting"
              >
                {{ submitting ? "Sending…" : "Send message" }}
                <RIcon name="arrowRight" :size="16" />
              </button>
              <span v-if="error" class="form-error" role="alert">{{
                error
              }}</span>
              <span v-else class="form-note">
                <RIcon name="check" :size="14" />
                We never share your email.
              </span>
            </div>
          </form>

          <div class="form-done">
            <span class="chk"><RIcon name="check" :size="26" /></span>
            <h3>Message sent</h3>
            <p>Thanks for reaching out — we'll get back to you within a day.</p>
          </div>
        </div>

        <div class="contact-aside">
          <div class="aside-block">
            <h4>Email us</h4>
            <a class="mail" :href="`mailto:${CONTACT_EMAIL}`">{{
              CONTACT_EMAIL
            }}</a>
            <p style="margin-top: 8px">
              For privacy questions,
              <a
                href="mailto:privacy@reader.app"
                style="color: var(--accent); text-decoration: none"
                >privacy@reader.app</a
              >.
            </p>
          </div>
          <div class="aside-block">
            <h4>Response time</h4>
            <p>
              Usually within one business day. We're a tiny team in a few time
              zones, so the occasional weekend reply slips a little.
            </p>
          </div>
          <div class="aside-block">
            <h4>Find us</h4>
            <div class="socials">
              <a
                v-for="social in socials"
                :key="social.name"
                class="social"
                :href="social.url"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span class="si"><RIcon :name="social.icon" :size="17" /></span>
                {{ social.name }}
                <span class="sh">{{ social.handle }}</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style>
.form-error {
  font-size: 11.5px;
  color: var(--danger);
  max-width: 280px;
  line-height: 1.5;
}
</style>
