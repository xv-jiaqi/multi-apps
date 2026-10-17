export {};

declare global {
  interface Window {
    __CARDHUB_CONFIG__?: {
      TRPC_URL?: string;
      SENTRY_DSN?: string;
      SENTRY_ENVIRONMENT?: string;
      GIT_SHA?: string;
    };
  }
}
