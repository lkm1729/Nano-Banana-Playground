import type { ApiProtocol } from "../../domain/generation";
import type { ImageGenerationAdapter } from "./adapter";
import { desktopAdapter } from "./desktopAdapter";
import { mockAdapter } from "./mockAdapter";

const adapters: Record<ApiProtocol, ImageGenerationAdapter> = {
  mock: mockAdapter,
  "gemini-native": desktopAdapter,
  "openai-compatible": desktopAdapter,
};

export const getGenerationAdapter = (protocol: ApiProtocol) => adapters[protocol];
