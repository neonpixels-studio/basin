import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import pluginVue from "eslint-plugin-vue";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";

const nuxtGlobals = {
  defineNuxtConfig: "readonly",
  defineNuxtPlugin: "readonly",
  defineNuxtRouteMiddleware: "readonly",
  definePageMeta: "readonly",
  useHead: "readonly",
  useSeoMeta: "readonly",
  useNuxtApp: "readonly",
  useRuntimeConfig: "readonly",
  useRoute: "readonly",
  useRouter: "readonly",
  useFetch: "readonly",
  $fetch: "readonly",
  useAsyncData: "readonly",
  useState: "readonly",
  navigateTo: "readonly",
  ref: "readonly",
  computed: "readonly",
  watch: "readonly",
  onMounted: "readonly",
  // Clerk (@clerk/nuxt auto-imports)
  useAuth: "readonly",
  useUser: "readonly",
  useClerk: "readonly",
  // project stores (Pinia — @pinia/nuxt auto-imports from app/stores/)
  useAppearanceStore: "readonly",
  useFeedStore: "readonly",
  // project composables (Nuxt auto-imports)
  useSearch: "readonly",
  useToast: "readonly",
  useClientDb: "readonly",
  useSyncQueue: "readonly",
  useFeeds: "readonly",
  useAccountExport: "readonly",
  useAuthHeaders: "readonly",
  useConnections: "readonly",
  useUserSettings: "readonly",
  useBilling: "readonly",
  useAccount: "readonly",
  useUserProfile: "readonly",
  useInputValidation: "readonly",
  useInfiniteScroll: "readonly",
  usePodcastPlayer: "readonly",
};

// Nitro / H3 globals — server-only auto-imports
const nitroGlobals = {
  defineEventHandler: "readonly",
  createError: "readonly",
  isError: "readonly",
  readBody: "readonly",
  getHeader: "readonly",
  setHeader: "readonly",
  getRouterParam: "readonly",
  getCookie: "readonly",
  setCookie: "readonly",
  deleteCookie: "readonly",
  sendRedirect: "readonly",
  getQuery: "readonly",
  getRequestURL: "readonly",
  getRequestIP: "readonly",
  readRawBody: "readonly",
  // server/utils auto-imports
  useDb: "readonly",
  getOrCreateUser: "readonly",
  buildYouTubeAuthUrl: "readonly",
  exchangeCodeForTokens: "readonly",
  getYouTubeChannelHandle: "readonly",
  createBlueskySession: "readonly",
  deleteBlueskySession: "readonly",
  encryptToken: "readonly",
  decryptTokenTolerant: "readonly",
  decryptNullableTokenTolerant: "readonly",
  revokeGoogleToken: "readonly",
};

export default [
  {
    ignores: [
      ".nuxt/**",
      ".netlify/**",
      ".output/**",
      "dist/**",
      "node_modules/**",
      "design/**",
    ],
  },
  eslint.configs.recommended,
  ...pluginVue.configs["flat/recommended"],
  {
    files: ["**/*.js", "**/*.ts", "**/*.vue"],
    languageOptions: {
      parserOptions: {
        // Tells eslint-plugin-vue to use TS parser for <script> blocks
        parser: tsParser,
        extraFileExtensions: [".vue"],
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...nuxtGlobals,
      },
    },
    rules: {
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "vue/html-self-closing": "off",
    },
  },
  {
    // Standalone .ts files need the TS parser set directly.
    // .vue files must NOT be included here — they use eslint-plugin-vue's own parser.
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
    },
  },
  {
    // Nitro server files: add H3/Nitro auto-imports and allow module-augmentation
    // interface names that ESLint incorrectly flags as unused (e.g. H3EventContext).
    files: ["server/**/*.ts"],
    languageOptions: {
      globals: nitroGlobals,
    },
    rules: {
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_|^[A-Z][a-zA-Z0-9]+Context$",
        },
      ],
    },
  },
  {
    files: ["app/pages/**/*.vue", "app/layouts/**/*.vue"],
    rules: {
      "vue/multi-word-component-names": "off",
    },
  },
  eslintConfigPrettier,
];
