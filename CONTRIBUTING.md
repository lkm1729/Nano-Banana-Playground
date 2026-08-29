# 贡献指南

欢迎提交 Issue、改进建议和 Pull Request。

## 提交 Issue

提交前请说明：

- Windows 版本
- 客户端版本或 Git commit
- 使用的协议和模型类型（不要提供 API Key）
- 可复现步骤
- 错误信息或脱敏截图

## 开发要求

```powershell
cd source
npm install
npm run build
npm run test:protocol
npm run test:clipboard
```

请不要提交：

- API Key
- 个人图片和生成历史
- `node_modules`
- 构建输出
- 本地用户数据