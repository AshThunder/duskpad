/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_NETWORK?: 'undeployed' | 'preprod';
  readonly VITE_API_URL?: string;
  readonly VITE_PREPROD_PROVER?: string;
}
