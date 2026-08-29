const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const electronPath = require("electron");
const packagedExecutable = process.env.NANO_BANANA_PACKAGED_EXE;

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlK6Z8AAAAASUVORK5CYII=";
const projectRoot = path.resolve(__dirname, "..");
const userData = path.join(projectRoot, ".desktop-test-user-data");

function safeResetDirectory(directory) {
  const resolved = path.resolve(directory);
  if (!resolved.startsWith(projectRoot + path.sep)) {
    throw new Error(`Refusing to clean outside project: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(resolved, { recursive: true });
}

async function cleanupDirectory(directory) {
  const resolved = path.resolve(directory);
  if (!resolved.startsWith(projectRoot + path.sep)) {
    throw new Error(`Refusing to clean outside project: ${resolved}`);
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.rmSync(resolved, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  console.warn(`Unable to remove locked test directory: ${resolved}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForJson(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function evaluate(webSocketUrl, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("CDP evaluation timed out"));
    }, 15000);
    socket.onopen = () => {
      socket.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression, awaitPromise: true, returnByValue: true },
      }));
    };
    socket.onerror = () => reject(new Error("Unable to connect to Electron debug target"));
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      if (message.result?.exceptionDetails) reject(new Error(message.result.exceptionDetails.text));
      else resolve(message.result?.result?.value);
    };
  });
}

(async () => {
  safeResetDirectory(userData);
  const apiServer = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/v1beta/interactions") {
      assert.equal(body.response_format.aspect_ratio, "3:4");
      assert.equal(body.response_format.image_size, "1K");
      response.end(JSON.stringify({
        steps: [{
          type: "model_output",
          content: [{ type: "image", mime_type: "image/png", data: PNG_BASE64 }],
        }],
      }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { message: "route not found" } }));
  });

  await new Promise((resolve) => apiServer.listen(0, "127.0.0.1", resolve));
  const apiPort = apiServer.address().port;
  const debugPort = await freePort();
  const child = spawn(electronPath, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userData}`,
    projectRoot,
  ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

  try {
    const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
    const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
    assert.ok(target, "Electron page target not found");
    const expression = `
      (async () => {
        const result = await window.nanoBanana.generate(
          {
            protocol: "gemini-native",
            baseUrl: "http://127.0.0.1:${apiPort}/v1beta",
            apiKey: "integration-key",
            model: "gemini-3.1-flash-image"
          },
          {
            requestId: crypto.randomUUID(),
            prompt: "integration test image",
            images: [],
            model: "gemini-3.1-flash-image",
            aspectRatio: "3:4",
            imageSize: "1K"
          }
        );
        return {
          bridge: Boolean(window.nanoBanana),
          uiLoaded: document.body.innerText.includes("真实 API"),
          image: result.images[0].dataUrl.startsWith("data:image/png;base64,")
        };
      })()
    `;
    const result = await evaluate(target.webSocketDebuggerUrl, expression);
    assert.deepEqual(result, { bridge: true, uiLoaded: true, image: true });
    console.log("DESKTOP_INTEGRATION_TEST=PASS");
  } finally {
    child.kill();
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    await new Promise((resolve) => apiServer.close(resolve));
    await cleanupDirectory(userData);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
