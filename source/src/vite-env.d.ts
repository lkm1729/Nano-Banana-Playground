/// <reference types="vite/client" />

import type {
  ConnectionSettings,
  GenerationRequest,
  GenerationResult,
} from "./domain/generation";

declare global {
  interface Window {
    nanoBanana?: {
      testConnection(settings: ConnectionSettings): Promise<{ ok: boolean }>;
      generate(settings: ConnectionSettings, request: GenerationRequest): Promise<GenerationResult>;
      abort(requestId: string): Promise<boolean>;
      copyImage(dataUrl: string): Promise<{ mimeType: string; bytes: number }>;
      loadSettings(): Promise<Partial<ConnectionSettings> | null>;
      saveSettings(settings: ConnectionSettings): Promise<{ ok: boolean }>;
    };
  }
}

export {};
