import type {
  ConnectionSettings,
  GenerationRequest,
  GenerationResult,
} from "../../domain/generation";
import type { ImageGenerationAdapter } from "./adapter";

const wait = (milliseconds: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new DOMException("Request aborted", "AbortError"));
      },
      { once: true },
    );
  });

const escapeXml = (value: string) =>
  value.replace(/[<>&'\"]/g, (character) => {
    const entities: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      "'": "&apos;",
      '"': "&quot;",
    };
    return entities[character];
  });

const createPreview = (prompt: string) => {
  const safePrompt = escapeXml(prompt.slice(0, 100));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900"><rect width="1200" height="900" fill="#111512"/><rect x="56" y="56" width="1088" height="788" rx="24" fill="#1d241f" stroke="#53645a" stroke-width="2"/><circle cx="1018" cy="172" r="88" fill="#f6cf4b"/><path d="M0 720 C250 560 410 690 620 520 C820 360 930 620 1200 420 V900 H0Z" fill="#275b42"/><path d="M0 790 C260 650 470 810 710 630 C900 490 1030 690 1200 570 V900 H0Z" fill="#4f936d"/><text x="92" y="132" font-family="Arial" font-size="24" fill="#b7c4bc">LOCAL MOCK PREVIEW</text><foreignObject x="92" y="204" width="700" height="300"><div xmlns="http://www.w3.org/1999/xhtml" style="font:600 44px Arial;color:#f5f7f5;line-height:1.18;overflow-wrap:anywhere">${safePrompt}</div></foreignObject></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

export const mockAdapter: ImageGenerationAdapter = {
  async testConnection(_settings, signal) {
    await wait(400, signal);
  },

  async generate(_settings: ConnectionSettings, request: GenerationRequest, signal) {
    const startedAt = performance.now();
    await wait(900, signal);
    return {
      id: crypto.randomUUID(),
      images: [
        {
          id: crypto.randomUUID(),
          dataUrl: createPreview(request.prompt),
          mimeType: "image/svg+xml",
        },
      ],
      text: "本地模拟结果。切换到正式协议后，结果会来自你配置的 API。",
      createdAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - startedAt),
    } satisfies GenerationResult;
  },
};
