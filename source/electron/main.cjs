const { app, BrowserWindow, ClipboardItem, clipboard, ipcMain, safeStorage } = require("electron");
const { Blob } = require("node:buffer");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const pendingRequests = new Map();
const REQUEST_TIMEOUT_MS = 180000;
const MAX_RESPONSE_BYTES = 80 * 1024 * 1024;
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_CLIPBOARD_DATA_URL_LENGTH = Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 1024;
const SETTINGS_FILE_NAME = "settings.json";

function getSettingsFilePath() {
  return path.join(app.getPath("userData"), SETTINGS_FILE_NAME);
}

function readPersistedSettings() {
  try {
    const serialized = fs.readFileSync(getSettingsFilePath(), "utf8");
    const stored = JSON.parse(serialized);
    let apiKey = "";
    if (stored?.encryptedApiKey && safeStorage?.isEncryptionAvailable?.()) {
      apiKey = safeStorage.decryptString(Buffer.from(stored.encryptedApiKey, "base64"));
    }
    return {
      protocol: stored?.protocol,
      baseUrl: stored?.baseUrl,
      model: stored?.model,
      apiKey,
    };
  } catch {
    return null;
  }
}

function writePersistedSettings(settings) {
  const baseUrl = String(settings?.baseUrl || "").trim();
  const apiKey = String(settings?.apiKey || "");
  const payload = {
    protocol: settings?.protocol,
    baseUrl,
    model: String(settings?.model || "").trim(),
    encryptedApiKey: "",
  };

  if (apiKey) {
    if (!safeStorage?.isEncryptionAvailable?.()) {
      throw new ApiError("当前系统无法安全保存 API Key，请关闭记忆功能或更新系统。", "SECURE_STORAGE");
    }
    payload.encryptedApiKey = safeStorage.encryptString(apiKey).toString("base64");
  }

  const filePath = getSettingsFilePath();
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(payload, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

class ApiError extends Error {
  constructor(message, code = "UNKNOWN", status) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new ApiError("请先填写 Base URL。", "CONFIGURATION");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ApiError("Base URL 不是有效的网址。", "CONFIGURATION");
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ApiError("Base URL 只能使用 http 或 https。", "CONFIGURATION");
  }
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/+$/, "");
}

function requireApiKey(settings) {
  const key = String(settings?.apiKey || "").trim();
  if (!key) throw new ApiError("请先填写 API Key。", "AUTHENTICATION");
  return key;
}

function requireModel(settings) {
  const model = String(settings?.model || "").trim();
  if (!model) throw new ApiError("请先填写模型 ID。", "CONFIGURATION");
  return model;
}

function buildGeminiGenerateUrl(settings) {
  const base = normalizeBaseUrl(settings.baseUrl);
  const model = encodeURIComponent(requireModel(settings));
  if (/\/generateContent$/i.test(base)) return base;
  if (/\/models\/[^/]+$/i.test(base)) return `${base}:generateContent`;
  return `${base}/models/${model}:generateContent`;
}

function buildGeminiInteractionsUrl(settings) {
  const base = normalizeBaseUrl(settings.baseUrl);
  if (/\/interactions$/i.test(base)) return base;
  return `${base}/interactions`;
}

function buildGeminiModelUrl(settings) {
  const base = normalizeBaseUrl(settings.baseUrl);
  const model = encodeURIComponent(requireModel(settings));
  if (/\/models\/[^/]+$/i.test(base)) return base;
  const root = base
    .replace(/\/interactions$/i, "")
    .replace(/\/models\/[^/:]+:generateContent$/i, "")
    .replace(/\/generateContent$/i, "");
  return `${root}/models/${model}`;
}

function buildOpenAiChatUrl(settings) {
  const base = normalizeBaseUrl(settings.baseUrl);
  if (/\/chat\/completions$/i.test(base)) return base;
  return `${base}/chat/completions`;
}

function buildOpenAiImagesUrl(settings) {
  const base = normalizeBaseUrl(settings.baseUrl);
  if (/\/images\/generations$/i.test(base)) return base;
  return `${base}/images/generations`;
}

function buildOpenAiModelsUrl(settings) {
  const base = normalizeBaseUrl(settings.baseUrl);
  return base
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/images\/generations$/i, "") + "/models";
}

function isA6Api(settings) {
  try {
    const hostname = new URL(normalizeBaseUrl(settings.baseUrl)).hostname.toLowerCase();
    return hostname === "api.a6api.com" || hostname === "a6api.com";
  } catch {
    return false;
  }
}

function isGoogleOpenAiApi(settings) {
  try {
    return new URL(normalizeBaseUrl(settings.baseUrl)).hostname.toLowerCase() ===
      "generativelanguage.googleapis.com";
  } catch {
    return false;
  }
}

function mapOpenAiImageSize(aspectRatio, imageSize) {
  const edge = { "1K": 1024, "2K": 2048, "4K": 4096 }[imageSize] || 1024;
  const ratios = {
    "1:1": [1, 1],
    "16:9": [16, 9],
    "9:16": [9, 16],
    "4:3": [4, 3],
    "3:4": [3, 4],
  };
  const [widthRatio, heightRatio] = ratios[aspectRatio] || ratios["1:1"];
  const width = widthRatio >= heightRatio ? edge : Math.round(edge * widthRatio / heightRatio);
  const height = heightRatio >= widthRatio ? edge : Math.round(edge * heightRatio / widthRatio);
  return `${width}x${height}`;
}

function buildOpenAiGenerationBody(settings, request) {
  const basic = { model: requireModel(settings), prompt: request.prompt };
  if (isGoogleOpenAiApi(settings)) {
    return { ...basic, response_format: "b64_json", n: 1 };
  }
  const withSize = {
    ...basic,
    size: mapOpenAiImageSize(request.aspectRatio, request.imageSize),
  };
  if (isA6Api(settings)) return withSize;
  return { ...withSize, response_format: "b64_json", n: 1 };
}

function dataUrlToInlinePart(image) {
  const dataUrl = String(image?.dataUrl || "");
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/s);
  if (!match) {
    throw new ApiError(`参考图“${image?.name || "未命名图片"}”格式无效。`, "CONFIGURATION");
  }
  return {
    inline_data: {
      mime_type: image.mimeType || match[1],
      data: match[2],
    },
  };
}

function dataUrlToInteractionInput(image) {
  const dataUrl = String(image?.dataUrl || "");
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/s);
  if (!match) {
    throw new ApiError(`参考图“${image?.name || "未命名图片"}”格式无效。`, "CONFIGURATION");
  }
  return {
    type: "image",
    mime_type: image.mimeType || match[1],
    data: match[2],
  };
}

function makeGenerationResult(images, text, startedAt) {
  return {
    id: randomUUID(),
    images,
    text: text || undefined,
    createdAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - startedAt),
  };
}

function imageFromBase64(data, mimeType = "image/png") {
  if (!data || typeof data !== "string") return null;
  if (data.startsWith("data:")) {
    const match = data.match(/^data:([^;,]+);base64,(.+)$/s);
    if (!match) return null;
    return { id: randomUUID(), dataUrl: data, mimeType: match[1] };
  }
  return {
    id: randomUUID(),
    dataUrl: `data:${mimeType};base64,${data}`,
    mimeType,
  };
}

function extractGeminiResult(body, startedAt) {
  const images = [];
  const textParts = [];
  const candidates = Array.isArray(body?.candidates) ? body.candidates : [];

  for (const candidate of candidates) {
    const parts = candidate?.content?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      const inline = part?.inlineData || part?.inline_data;
      if (inline?.data) {
        const image = imageFromBase64(
          inline.data,
          inline.mimeType || inline.mime_type || "image/png",
        );
        if (image) images.push(image);
      }
      if (typeof part?.text === "string" && part.text.trim()) textParts.push(part.text.trim());
    }
  }

  if (!images.length) {
    const blocked = body?.promptFeedback?.blockReason;
    if (blocked) {
      throw new ApiError(`请求被模型安全策略拦截：${blocked}`, "CONTENT_BLOCKED");
    }
    const finishReason = candidates[0]?.finishReason;
    if (finishReason === "SAFETY" || finishReason === "PROHIBITED_CONTENT") {
      throw new ApiError("请求被模型安全策略拦截，请调整提示词或参考图。", "CONTENT_BLOCKED");
    }
    throw new ApiError(
      textParts.join(" ") || "API 返回成功，但没有找到图片数据。请检查模型 ID 是否支持图像输出。",
      "UNSUPPORTED_RESPONSE",
    );
  }

  return makeGenerationResult(images, textParts.join("\n"), startedAt);
}

function extractInteractionResult(body, startedAt) {
  const images = [];
  const textParts = [];

  const addImage = (value, fallbackMimeType = "image/png") => {
    if (!value) return;
    const image = imageFromBase64(
      value.data || value.b64_json || value.base64,
      value.mime_type || value.mimeType || fallbackMimeType,
    );
    if (image) images.push(image);
  };

  addImage(body?.output_image);
  if (typeof body?.output_text === "string" && body.output_text.trim()) {
    textParts.push(body.output_text.trim());
  }

  const steps = Array.isArray(body?.steps) ? body.steps : [];
  for (const step of steps) {
    if (step?.type !== "model_output") continue;
    const content = Array.isArray(step?.content) ? step.content : [];
    for (const block of content) {
      if (block?.type === "image") addImage(block);
      if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
        textParts.push(block.text.trim());
      }
    }
  }

  const output = Array.isArray(body?.output) ? body.output : [];
  for (const block of output) {
    if (block?.type === "image") addImage(block);
    if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
      textParts.push(block.text.trim());
    }
  }

  const uniqueImages = images.filter((image, index, list) =>
    list.findIndex((candidate) => candidate.dataUrl === image.dataUrl) === index,
  );
  if (!uniqueImages.length) {
    const message = body?.error?.message || textParts.join(" ");
    if (/safety|blocked|policy|prohibited/i.test(message || "")) {
      throw new ApiError(message || "请求被模型安全策略拦截。", "CONTENT_BLOCKED");
    }
    throw new ApiError(
      message || "Interactions API 返回成功，但没有找到图片数据。请检查模型 ID 是否支持图像生成。",
      "UNSUPPORTED_RESPONSE",
    );
  }
  return makeGenerationResult(uniqueImages, textParts.join("\n"), startedAt);
}

function isDataUrl(value) {
  return typeof value === "string" && /^data:image\//i.test(value);
}

function collectOpenAiImages(node, output, remoteUrls, depth = 0) {
  if (!node || depth > 5) return;
  if (Array.isArray(node)) {
    for (const item of node) collectOpenAiImages(item, output, remoteUrls, depth + 1);
    return;
  }
  if (typeof node !== "object") return;

  if (typeof node.b64_json === "string") {
    const image = imageFromBase64(node.b64_json, node.mime_type || node.mimeType || "image/png");
    if (image) output.push(image);
  }
  if (typeof node.url === "string" && isDataUrl(node.url)) {
    const image = imageFromBase64(node.url);
    if (image) output.push(image);
  } else if (typeof node.url === "string" && /^https?:\/\//i.test(node.url)) {
    remoteUrls.push(node.url);
  }
  if (typeof node.data === "string" && (node.mime_type || node.mimeType || node.type === "image")) {
    const image = imageFromBase64(node.data, node.mime_type || node.mimeType || "image/png");
    if (image) output.push(image);
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === "b64_json" || key === "url") continue;
    if (key === "data" && typeof value === "string") continue;
    collectOpenAiImages(value, output, remoteUrls, depth + 1);
  }
}

function collectOpenAiText(node, output, depth = 0) {
  if (!node || depth > 5) return;
  if (typeof node === "string") {
    if (node.trim() && !isDataUrl(node)) output.push(node.trim());
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectOpenAiText(item, output, depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    if (["b64_json", "data", "url", "image_url", "image", "images"].includes(key)) continue;
    if (key === "text" || key === "content") collectOpenAiText(value, output, depth + 1);
  }
}

async function downloadRemoteImage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new ApiError(`生成图片下载失败：HTTP ${response.status}`, "NETWORK", response.status);
    }
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_IMAGE_BYTES) {
      throw new ApiError("生成图片文件过大，已停止下载。", "NETWORK");
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new ApiError("生成图片文件过大，已停止下载。", "NETWORK");
    }
    const mimeType = (response.headers.get("content-type") || "image/png").split(";")[0];
    if (!mimeType.startsWith("image/")) {
      throw new ApiError("生成结果链接没有返回图片内容。", "UNSUPPORTED_RESPONSE");
    }
    return imageFromBase64(buffer.toString("base64"), mimeType);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error?.name === "AbortError") throw new ApiError("生成图片下载超时。", "NETWORK");
    throw new ApiError(`生成图片下载失败：${error?.message || "网络错误"}`, "NETWORK");
  } finally {
    clearTimeout(timeout);
  }
}

async function extractOpenAiResult(body, startedAt) {
  const images = [];
  const remoteUrls = [];
  const textParts = [];
  collectOpenAiImages(body, images, remoteUrls);
  for (const url of [...new Set(remoteUrls)]) {
    const image = await downloadRemoteImage(url);
    if (image) images.push(image);
  }
  collectOpenAiText(body?.choices?.[0]?.message?.content, textParts);
  collectOpenAiText(body?.output_text, textParts);

  const uniqueImages = images.filter((image, index, list) =>
    list.findIndex((candidate) => candidate.dataUrl === image.dataUrl) === index,
  );
  if (!uniqueImages.length) {
    throw new ApiError(
      textParts.join(" ") || "兼容接口返回成功，但没有找到图片数据。请确认该服务支持图像输出。",
      "UNSUPPORTED_RESPONSE",
    );
  }
  return makeGenerationResult(uniqueImages, textParts.join("\n"), startedAt);
}

function apiErrorFromResponse(status, body) {
  const message =
    body?.error?.message ||
    body?.message ||
    (typeof body === "string" ? body.slice(0, 500) : "API 请求失败。");
  if (status === 401 || status === 403) return new ApiError(message, "AUTHENTICATION", status);
  if (status === 429) return new ApiError(message, "RATE_LIMITED", status);
  if (/safety|blocked|policy|prohibited/i.test(message)) {
    return new ApiError(message, "CONTENT_BLOCKED", status);
  }
  return new ApiError(message, status >= 500 ? "NETWORK" : "CONFIGURATION", status);
}

async function requestJson(url, options, requestId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  pendingRequests.set(requestId, controller);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new ApiError("API 响应过大，已停止读取。", "NETWORK", response.status);
    }
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!response.ok) throw apiErrorFromResponse(response.status, body);
    return body;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new ApiError("请求已停止或超时。", "ABORTED");
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError(`无法连接到 API：${error?.message || "网络错误"}`, "NETWORK");
  } finally {
    clearTimeout(timeout);
    pendingRequests.delete(requestId);
  }
}

function validateRequest(settings, request) {
  const prompt = String(request?.prompt || "").trim();
  if (!prompt) throw new ApiError("请输入提示词。", "CONFIGURATION");
  const images = Array.isArray(request?.images) ? request.images : [];
  if (images.length > 4) throw new ApiError("最多只能添加 4 张参考图。", "CONFIGURATION");
  return { ...request, prompt, images };
}

async function generateGemini(settings, request) {
  const startedAt = performance.now();
  const normalized = validateRequest(settings, request);
  const input = [
    { type: "text", text: normalized.prompt },
    ...normalized.images.map(dataUrlToInteractionInput),
  ];
  const responseFormat = {
    type: "image",
    aspect_ratio: normalized.aspectRatio,
  };
  if (normalized.imageSize && !/2\.5.*image/i.test(String(normalized.model))) {
    responseFormat.image_size = normalized.imageSize;
  }
  const body = {
    model: requireModel(settings),
    input,
    response_format: responseFormat,
  };
  try {
    const response = await requestJson(
      buildGeminiInteractionsUrl(settings),
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": requireApiKey(settings) },
        body: JSON.stringify(body),
      },
      normalized.requestId,
    );
    return extractInteractionResult(response, startedAt);
  } catch (error) {
    const shouldFallback =
      error instanceof ApiError &&
      (error.status === 404 ||
        error.status === 405 ||
        (error.status === 400 && /interaction|response_format|not supported|unknown field|unknown route/i.test(error.message)) ||
        /interaction.*not found|unknown route/i.test(error.message));
    if (!shouldFallback) throw error;
  }

  const parts = [{ text: normalized.prompt }, ...normalized.images.map(dataUrlToInlinePart)];
  const imageConfig = { aspectRatio: normalized.aspectRatio };
  if (normalized.imageSize && !/2\.5.*image/i.test(String(normalized.model))) {
    imageConfig.imageSize = normalized.imageSize;
  }
  const legacyResponse = await requestJson(
    buildGeminiGenerateUrl(settings),
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": requireApiKey(settings) },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig,
        },
      }),
    },
    normalized.requestId,
  );
  return extractGeminiResult(legacyResponse, startedAt);
}

async function generateOpenAiCompatible(settings, request) {
  const startedAt = performance.now();
  const normalized = validateRequest(settings, request);

  if (!normalized.images.length) {
    const response = await requestJson(
      buildOpenAiImagesUrl(settings),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${requireApiKey(settings)}`,
        },
        body: JSON.stringify(buildOpenAiGenerationBody(settings, normalized)),
      },
      normalized.requestId,
    );
    return await extractOpenAiResult(response, startedAt);
  }

  const content = [
    { type: "text", text: normalized.prompt },
    ...normalized.images.map((image) => ({
      type: "image_url",
      image_url: { url: image.dataUrl },
    })),
  ];
  const body = {
    model: requireModel(settings),
    messages: [{ role: "user", content }],
    modalities: ["text", "image"],
    extra_body: {
      image_config: {
        aspect_ratio: normalized.aspectRatio,
        image_size: normalized.imageSize,
      },
    },
  };
  const response = await requestJson(
    buildOpenAiChatUrl(settings),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${requireApiKey(settings)}`,
      },
      body: JSON.stringify(body),
    },
    normalized.requestId,
  );
  return await extractOpenAiResult(response, startedAt);
}

async function testGeminiConnection(settings) {
  const requestId = randomUUID();
  await requestJson(
    buildGeminiModelUrl(settings),
    { method: "GET", headers: { "x-goog-api-key": requireApiKey(settings) } },
    requestId,
  );
}

async function testOpenAiConnection(settings) {
  const requestId = randomUUID();
  await requestJson(
    buildOpenAiModelsUrl(settings),
    { method: "GET", headers: { Authorization: `Bearer ${requireApiKey(settings)}` } },
    requestId,
  );
}

function decodeClipboardImageDataUrl(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    throw new ApiError("没有可复制的有效图片。", "CLIPBOARD");
  }
  if (dataUrl.length > MAX_CLIPBOARD_DATA_URL_LENGTH) {
    throw new ApiError("图片过大，无法复制到剪贴板，请改用下载按钮。", "CLIPBOARD");
  }

  const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) {
    throw new ApiError("图片数据格式无效，无法复制到剪贴板。", "CLIPBOARD");
  }

  const mimeType = match[1].toLowerCase();
  const base64 = match[2].replace(/\s+/g, "");
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) {
    throw new ApiError("图片数据为空，无法复制到剪贴板。", "CLIPBOARD");
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new ApiError("图片过大，无法复制到剪贴板，请改用下载按钮。", "CLIPBOARD");
  }

  return { mimeType, buffer };
}

async function copyImageToClipboard(
  dataUrl,
  clipboardApi = clipboard,
  ClipboardItemClass = ClipboardItem,
) {
  if (typeof clipboardApi?.write !== "function" || typeof ClipboardItemClass !== "function") {
    throw new ApiError("当前 Electron 运行环境不支持图片剪贴板。", "CLIPBOARD");
  }

  const { mimeType, buffer } = decodeClipboardImageDataUrl(dataUrl);
  const blob = new Blob([buffer], { type: mimeType });
  const item = new ClipboardItemClass({ [mimeType]: blob });
  await clipboardApi.write([item]);

  if (typeof clipboardApi.read === "function") {
    const copiedItems = await clipboardApi.read();
    const copiedImage = copiedItems.find((copiedItem) =>
      copiedItem.types?.some((type) => type.startsWith("image/")),
    );
    const copiedType = copiedImage?.types?.find((type) => type.startsWith("image/"));
    if (!copiedImage || !copiedType || typeof copiedImage.getType !== "function") {
      throw new ApiError("系统剪贴板未能接收图片，请重试或改用下载按钮。", "CLIPBOARD");
    }
    const copiedBlob = await copiedImage.getType(copiedType);
    if (!copiedBlob || typeof copiedBlob.size !== "number" || copiedBlob.size === 0) {
      throw new ApiError("系统剪贴板中的图片内容为空，请重试或改用下载按钮。", "CLIPBOARD");
    }
  } else if (typeof clipboardApi.has === "function" && !(await clipboardApi.has(mimeType))) {
    throw new ApiError("系统剪贴板未能接收图片，请重试或改用下载按钮。", "CLIPBOARD");
  }

  return { mimeType, bytes: buffer.length };
}

function serializeError(error) {
  if (error instanceof ApiError) {
    return { message: error.message, code: error.code, status: error.status };
  }
  return { message: error?.message || "生成失败。", code: "UNKNOWN" };
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 920,
    minHeight: 620,
    title: "Nano-Banana Playground",
    backgroundColor: "#101311",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

if (app && ipcMain) {
ipcMain.handle("settings:load", async () => {
  try {
    return { ok: true, value: readPersistedSettings() };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});

ipcMain.handle("settings:save", async (_event, settings) => {
  try {
    writePersistedSettings(settings);
    return { ok: true, value: { ok: true } };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("generation:test-connection", async (_event, settings) => {
  try {
    if (settings?.protocol === "gemini-native") await testGeminiConnection(settings);
    else if (settings?.protocol === "openai-compatible") await testOpenAiConnection(settings);
    else throw new ApiError("本地模拟模式不需要测试远程连接。", "CONFIGURATION");
    return { ok: true, value: { ok: true } };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});

ipcMain.handle("generation:generate", async (_event, payload) => {
  try {
    const settings = payload?.settings;
    const request = payload?.request;
    if (settings?.protocol === "gemini-native") return { ok: true, value: await generateGemini(settings, request) };
    if (settings?.protocol === "openai-compatible") return { ok: true, value: await generateOpenAiCompatible(settings, request) };
    throw new ApiError("当前选择的是本地模拟模式。请切换到 Gemini Native 或 OpenAI Compatible。", "CONFIGURATION");
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});

ipcMain.handle("generation:abort", async (_event, requestId) => {
  const controller = pendingRequests.get(requestId);
  if (controller) {
    controller.abort();
    return true;
  }
  return false;
});

ipcMain.handle("clipboard:write-image", async (_event, dataUrl) => {
  try {
    return { ok: true, value: await copyImageToClipboard(dataUrl) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
}

module.exports = {
  ApiError,
  readPersistedSettings,
  writePersistedSettings,
  decodeClipboardImageDataUrl,
  copyImageToClipboard,
  buildGeminiInteractionsUrl,
  buildGeminiGenerateUrl,
  buildOpenAiImagesUrl,
  buildOpenAiChatUrl,
  buildOpenAiGenerationBody,
  mapOpenAiImageSize,
  extractInteractionResult,
  extractGeminiResult,
  extractOpenAiResult,
  generateGemini,
  generateOpenAiCompatible,
  testGeminiConnection,
  testOpenAiConnection,
};
