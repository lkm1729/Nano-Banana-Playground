# Nano-Banana Playground 使用指南

更新时间：2026-08-28

## 启动位置

双击：

```text
release-nano-banana-playground\Nano-Banana Playground-win32-x64\Nano-Banana Playground.exe
```

请保留整个 `Nano-Banana Playground-win32-x64` 目录，不要只复制 exe 文件。

## Google Gemini Native 推荐配置

```text
接口协议：Gemini Native（真实生成）
Base URL：https://generativelanguage.googleapis.com/v1beta
模型 ID：gemini-3.1-flash-image
API Key：你的 Gemini API Key
```

填写完成后先点击“测试连接”。连接可用后，关闭设置页，输入提示词、选择比例和图片尺寸，再点击“生成图片”。

Gemini Native 使用当前 Interactions API，并在旧代理不支持时兼容回退到 `generateContent`。参考图片、画面比例和图片尺寸都会随请求发送。

## OpenAI Compatible

Google 官方 OpenAI 兼容图片接口可以填写：

```text
接口协议：OpenAI Compatible（真实生成）
Base URL：https://generativelanguage.googleapis.com/v1beta/openai
模型 ID：gemini-2.5-flash-image
```

纯文生图会调用 `/images/generations`。自定义代理可以填写它自己的 Base URL 和图像模型 ID。

## OpenAI Compatible / A6API 示例

```text
接口协议：OpenAI Compatible（真实生成）
Base URL：https://api.openai.com/v1
模型 ID：gemini-3.1-flash-image
API Key：你的 OpenAI API Key
```

Base URL 只填写到 `/v1`，不需要填写 `/images/generations`。客户端会自动：

- 拼接 `/images/generations`。
- 添加 `Authorization: Bearer <API Key>`。
- 添加 `Content-Type: application/json`。
- 按 A6API 格式发送 `model`、`prompt` 和 `size`。
- 将 `1:1 + 1K` 映射为 `1024x1024`。
- 下载 A6API 返回的图片链接，并转换为本地历史可保存的图片数据。

## 隐私说明

- API Key 会使用 Windows 系统安全存储保存在本机，关闭应用后仍可自动恢复，不会写入普通网页存储。
- Base URL、协议、模型 ID 和 API Key 保存在本机；API Key 使用 Windows 系统安全存储。
- 生成历史使用本机 IndexedDB 保存。
- 应用不包含遥测、账号或云同步。
- 点击生成后，提示词和参考图片会发送到你配置的 Base URL。

## 常见错误

- `401` / `403`：API Key 无效、项目无权限或模型未开放。
- `404`：Base URL 或模型 ID 不正确，或者代理不支持对应接口。
- `429`：额度或请求频率达到上限。
- “没有找到图片数据”：当前模型不是图像模型，或代理返回格式不兼容。
- 安全策略拦截：调整提示词或参考图片后重试。

## 源码位置

```text
source\
```

常用验证命令：

```powershell
npm run build
npm run test:protocol
npm run test:desktop
```
