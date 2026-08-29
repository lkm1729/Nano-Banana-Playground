const assert = require("node:assert/strict");
const { Blob } = require("node:buffer");
const {
  ApiError,
  copyImageToClipboard,
  decodeClipboardImageDataUrl,
} = require("../electron/main.cjs");

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlK6Z8AAAAASUVORK5CYII=";
const DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

class MockClipboardItem {
  constructor(items) {
    this.items = items;
    this.types = Object.keys(items);
  }

  async getType(type) {
    if (!(type in this.items)) throw new Error(`Missing clipboard type: ${type}`);
    return await this.items[type];
  }
}

(async () => {
  const decoded = decodeClipboardImageDataUrl(DATA_URL);
  assert.equal(decoded.mimeType, "image/png");
  assert.ok(Buffer.isBuffer(decoded.buffer));
  assert.ok(decoded.buffer.length > 0);

  let writtenItems = [];
  const clipboardWithoutLegacyMethods = {
    async write(items) {
      writtenItems = items;
    },
    async read() {
      return writtenItems;
    },
  };

  const result = await copyImageToClipboard(
    DATA_URL,
    clipboardWithoutLegacyMethods,
    MockClipboardItem,
  );

  assert.equal(result.mimeType, "image/png");
  assert.equal(result.bytes, decoded.buffer.length);
  assert.equal(writtenItems.length, 1);
  assert.deepEqual(writtenItems[0].types, ["image/png"]);
  const copiedBlob = await writtenItems[0].getType("image/png");
  assert.ok(copiedBlob instanceof Blob);
  assert.equal(copiedBlob.type, "image/png");
  assert.equal(copiedBlob.size, decoded.buffer.length);
  assert.equal("writeImage" in clipboardWithoutLegacyMethods, false);

  await assert.rejects(
    () => copyImageToClipboard(DATA_URL, {}, MockClipboardItem),
    (error) => error instanceof ApiError && error.code === "CLIPBOARD",
  );
  assert.throws(
    () => decodeClipboardImageDataUrl("data:text/plain;base64,SGVsbG8="),
    (error) => error instanceof ApiError && error.code === "CLIPBOARD",
  );

  console.log("CLIPBOARD_SMOKE_TEST=PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});