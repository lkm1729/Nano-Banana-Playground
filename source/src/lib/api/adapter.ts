import type {
  ConnectionSettings,
  GenerationRequest,
  GenerationResult,
} from "../../domain/generation";

export interface ImageGenerationAdapter {
  testConnection(settings: ConnectionSettings, signal?: AbortSignal): Promise<void>;
  generate(
    settings: ConnectionSettings,
    request: GenerationRequest,
    signal?: AbortSignal,
  ): Promise<GenerationResult>;
}
