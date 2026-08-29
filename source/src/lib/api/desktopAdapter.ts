import type {
  ConnectionSettings,
  GenerationRequest,
  GenerationResult,
} from "../../domain/generation";
import type { ImageGenerationAdapter } from "./adapter";
import { GenerationError } from "./errors";

const desktopApi = () => {
  if (!window.nanoBanana) {
    throw new GenerationError(
      "桌面网络桥接未加载。请从完整的 exe 应用目录启动，而不是直接打开 dist/index.html。",
      "CONFIGURATION",
    );
  }
  return window.nanoBanana;
};

export const desktopAdapter: ImageGenerationAdapter = {
  async testConnection(settings) {
    await desktopApi().testConnection(settings);
  },

  async generate(settings, request, signal): Promise<GenerationResult> {
    const stop = () => {
      void desktopApi().abort(request.requestId);
    };
    if (signal?.aborted) stop();
    else signal?.addEventListener("abort", stop, { once: true });
    try {
      return await desktopApi().generate(settings, request);
    } finally {
      signal?.removeEventListener("abort", stop);
    }
  },
};
