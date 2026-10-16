export {};

declare global {
  interface Window {
    __CARDHUB_CONFIG__?: {
      TRPC_URL?: string;
    };
  }
}
