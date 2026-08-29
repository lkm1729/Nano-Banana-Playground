export type ApiProtocol = "mock" | "gemini-native" | "openai-compatible";

export type ConnectionSettings = {
  protocol: ApiProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type InputImage = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
};

export type GenerationRequest = {
  requestId: string;
  prompt: string;
  images: InputImage[];
  model: string;
  aspectRatio: string;
  imageSize: string;
};

export type GeneratedImage = {
  id: string;
  dataUrl: string;
  mimeType: string;
};

export type GenerationResult = {
  id: string;
  images: GeneratedImage[];
  text?: string;
  createdAt: string;
  durationMs: number;
};

export type GenerationHistoryItem = {
  id: string;
  prompt: string;
  model: string;
  result: GenerationResult;
};

export type ConnectionState = "idle" | "testing" | "success" | "error";
