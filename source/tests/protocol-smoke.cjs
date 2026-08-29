const assert = require("node:assert/strict");
const http = require("node:http");
const { randomUUID } = require("node:crypto");
const {
  buildOpenAiGenerationBody,
  mapOpenAiImageSize,
  generateGemini,
  generateOpenAiCompatible,
  testGeminiConnection,
  testOpenAiConnection,
} = require("../electron/main.cjs");

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlK6Z8AAAAASUVORK5CYII=";
const requests = [];
let origin = "";

const server = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const bodyText = Buffer.concat(chunks).toString("utf8");
  const body = bodyText ? JSON.parse(bodyText) : null;
  requests.push({
    method: request.method,
    url: request.url,
    headers: request.headers,
    body,
  });

  response.setHeader("Content-Type", "application/json");
  if (request.url === "/generated.png") {
    response.setHeader("Content-Type", "image/png");
    response.end(Buffer.from(PNG_BASE64, "base64"));
    return;
  }
  if (request.method === "GET" && request.url.includes("/models")) {
    response.end(JSON.stringify({ models: [{ name: "test-image-model" }] }));
    return;
  }
  if (request.url === "/v1beta/interactions") {
    response.end(JSON.stringify({
      steps: [{
        type: "model_output",
        content: [
          { type: "image", mime_type: "image/png", data: PNG_BASE64 },
          { type: "text", text: "local Gemini response" },
        ],
      }],
    }));
    return;
  }
  if (request.url === "/v1/images/generations") {
    response.end(JSON.stringify({ data: [{ url: `${origin}/generated.png` }] }));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: { message: "route not found" } }));
});

server.listen(0, "127.0.0.1", async () => {
  try {
    const address = server.address();
    origin = `http://127.0.0.1:${address.port}`;
    const geminiSettings = {
      protocol: "gemini-native",
      baseUrl: `${origin}/v1beta`,
      apiKey: "gemini-test-key",
      model: "gemini-3.1-flash-image",
    };
    await testGeminiConnection(geminiSettings);
    const geminiResult = await generateGemini(geminiSettings, {
      requestId: randomUUID(),
      prompt: "A cat at a window",
      images: [{
        id: randomUUID(),
        name: "cat.png",
        mimeType: "image/png",
        dataUrl: `data:image/png;base64,${PNG_BASE64}`,
      }],
      model: geminiSettings.model,
      aspectRatio: "16:9",
      imageSize: "2K",
    });
    assert.equal(geminiResult.images.length, 1);
    assert.match(geminiResult.images[0].dataUrl, /^data:image\/png;base64,/);
    const geminiRequest = requests.find((item) => item.url === "/v1beta/interactions");
    assert.equal(geminiRequest.headers["x-goog-api-key"], "gemini-test-key");
    assert.equal(geminiRequest.body.model, "gemini-3.1-flash-image");
    assert.equal(geminiRequest.body.input[0].text, "A cat at a window");
    assert.equal(geminiRequest.body.input[1].type, "image");
    assert.equal(geminiRequest.body.response_format.aspect_ratio, "16:9");
    assert.equal(geminiRequest.body.response_format.image_size, "2K");

    const openAiSettings = {
      protocol: "openai-compatible",
      baseUrl: `${origin}/v1`,
      apiKey: "openai-test-key",
      model: "test-image-model",
    };
    await testOpenAiConnection(openAiSettings);
    const openAiResult = await generateOpenAiCompatible(openAiSettings, {
      requestId: randomUUID(),
      prompt: "A yellow flower",
      images: [],
      model: openAiSettings.model,
      aspectRatio: "1:1",
      imageSize: "1K",
    });
    assert.equal(openAiResult.images.length, 1);
    assert.match(openAiResult.images[0].dataUrl, /^data:image\/png;base64,/);
    const openAiRequest = requests.find((item) => item.url === "/v1/images/generations");
    assert.equal(openAiRequest.headers.authorization, "Bearer openai-test-key");
    assert.equal(openAiRequest.body.prompt, "A yellow flower");
    assert.equal(openAiRequest.body.size, "1024x1024");
    assert.equal(openAiRequest.body.response_format, "b64_json");
    assert.equal(openAiRequest.body.n, 1);

    const a6Body = buildOpenAiGenerationBody({
      protocol: "openai-compatible",
      baseUrl: "https://api.a6api.com/v1",
      apiKey: "masked",
      model: "gemini-3.1-flash-image",
    }, {
      prompt: "A cat in sunlight",
      aspectRatio: "1:1",
      imageSize: "1K",
    });
    assert.deepEqual(a6Body, {
      model: "gemini-3.1-flash-image",
      prompt: "A cat in sunlight",
      size: "1024x1024",
    });
    assert.equal(mapOpenAiImageSize("16:9", "2K"), "2048x1152");

    console.log("PROTOCOL_SMOKE_TEST=PASS");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
