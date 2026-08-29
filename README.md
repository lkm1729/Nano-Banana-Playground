# Nano-Banana Playground

一个本地优先的桌面图像生成客户端，支持 Gemini Native 和 OpenAI Compatible 接口，并兼容 自带API 等 OpenAI 风格代理。
**声明：此项目由GPT-5.6 Sol支持开发**

## 功能

- 通过自定义 Base URL 调用图像生成 API
- 支持 Gemini Native 与 OpenAI Compatible 协议
- 支持 1K、2K、4K 图片尺寸和常用画面比例
- 支持最多 4 张参考图片
- 生成结果自适应预览，不会撑破窗口
- 支持复制图片到系统剪贴板和下载图片
- 支持创作历史单选、多选、全选和批量删除
- API Key 使用 Windows 系统安全存储保存
- Base URL、协议和模型 ID 会在本机持久化
- 不包含账号系统、云同步或遥测

## 文档

- [使用指南](USAGE_GUIDE.md)
- [GitHub 上传指南](GITHUB_UPLOAD_GUIDE.md)

## 快速开始

### 直接使用 Windows 便携版

从项目发布目录启动：

```text
release-nano-banana-playground/Nano-Banana Playground-win32-x64/Nano-Banana Playground.exe
```

首次打开后，在“连接设置”中填写：

- 接口协议
- Base URL
- API Key
- 模型 ID

配置会自动保存到本机，下一次启动客户端时会自动恢复。

### 从源码运行

要求：Node.js 22 或更高版本。

```powershell
cd source
npm install
npm run dev
```

### 构建 Windows 便携版

```powershell
cd source
npm install
npm run desktop:package
```

构建结果会生成在 `source/release/`。如果需要发布目录名称，可将生成结果移动为：

```text
release-nano-banana-playground/
```

## API 配置示例

### OpenAI Compatible

```text
Base URL: https://api.example.com/v1
模型 ID: 你的图像模型 ID
```

客户端会自动拼接 `/images/generations`，并发送 Bearer 鉴权。

### Gemini Native

```text
Base URL: 你的 Gemini API 根地址
模型 ID: 你的图像模型 ID
```

客户端会优先使用 Interactions API，并在接口不支持时兼容回退到 `generateContent`。

## 本地数据与安全

- API Key 不会写入普通网页 `localStorage`。
- Windows 桌面版通过 Electron `safeStorage` 加密保存 API Key。
- Base URL、协议和模型 ID 保存于 Electron 应用用户数据目录。
- 生成历史保存在本机 IndexedDB。
- 提示词、参考图片和 API Key 只会在用户点击生成后发送到用户配置的 Base URL。
- 请不要把包含 API Key 的截图、日志或配置文件上传到 GitHub。

## 开发与测试

```powershell
cd source
npm run build
npm run test:protocol
npm run test:clipboard
```

说明：桌面集成测试需要本机 Electron 图形运行环境；如果系统缺少 GPU 运行依赖，可能无法启动测试窗口，但不影响协议测试和源码构建。

## GitHub 发布建议

GitHub 仓库建议上传源码和文档，不要把 `node_modules`、构建缓存或本地用户数据提交进去。

Windows 便携版包含约数百 MB 的 Electron 运行时，建议：

1. 将源码提交到 GitHub 仓库。
2. 使用 GitHub Releases 发布 Windows 便携版压缩包。
3. 不要把 API Key、`settings.json`、用户数据目录或个人生成历史提交到仓库。

详细上传步骤见 [`GITHUB_UPLOAD_GUIDE.md`](GITHUB_UPLOAD_GUIDE.md)。

## 许可证

本项目使用 MIT License，详见 [`LICENSE`](LICENSE)。
