# GitHub 上传指南

本文面向第一次使用 GitHub 上传项目的用户，说明如何把 Nano-Banana Playground 发布到 GitHub。

## 一、准备 GitHub 仓库

1. 登录 GitHub。
2. 点击右上角 **New repository**。
3. Repository name 建议填写：`Nano-Banana-Playground`。
4. 选择 Public 或 Private。
5. 创建时不要勾选自动生成 README、`.gitignore` 或 License，因为本项目已经准备好了这些文件。

创建完成后，复制 GitHub 提供的仓库地址，例如：

```text
https://github.com/你的用户名/Nano-Banana-Playground.git
```

## 二、在项目目录初始化 Git

在 PowerShell 中执行：

```powershell
cd "D:\Codex\Projects\Nano Banana Playground Clean"
git init
git branch -M main
git add README.md GITHUB_UPLOAD_GUIDE.md LICENSE .gitignore .gitattributes CONTRIBUTING.md SECURITY.md .github source README_REAL_API.md
```

提交前检查暂存区：

```powershell
git status
```

确认没有 API Key、个人图片、`settings.json` 或 `node_modules` 后再提交：

```powershell
git commit -m "Initial release of Nano-Banana Playground"
```

## 三、关联远程仓库并上传

把下面的地址替换为你的 GitHub 仓库地址：

```powershell
git remote add origin https://github.com/你的用户名/Nano-Banana-Playground.git
git push -u origin main
```

如果 GitHub 要求登录，可以使用浏览器登录或 Personal Access Token。不要把 Token 写入文件、README 或命令历史后分享给别人。

## 四、发布 Windows 版本

Windows 便携版包含 Electron 运行时，文件较大，不建议直接提交到 Git 仓库。推荐创建 GitHub Release：

1. 在项目中重新构建：

   ```powershell
   cd source
   npm run desktop:package
   ```

2. 将 `source/release/Nano-Banana Playground-win32-x64` 压缩为 ZIP。
3. 在 GitHub 仓库页面点击 **Releases → Draft a new release**。
4. 创建标签，例如 `v0.2.0`。
5. 上传 ZIP 作为 Release asset。
6. 在 Release 描述中说明启动文件：

   ```text
   Nano-Banana Playground-win32-x64/Nano-Banana Playground.exe
   ```

## 五、不要上传的内容

以下内容已经被 `.gitignore` 排除：

- `node_modules/`
- `source/dist/`
- `source/release/`
- `release-nano-banana-playground/`
- 用户数据目录
- `settings.json`
- `.env` 文件
- 测试缓存

API Key 只应在本机客户端设置面板中输入，不应写进源码、README、Issue、截图或 Git 提交记录。

## 六、日常更新

修改代码后：

```powershell
cd source
npm run build
npm run test:protocol
npm run test:clipboard
cd ..
git add .
git status
git commit -m "Describe your change"
git push
```

如果只是发布新 Windows 版本，则重新构建 ZIP，并在 GitHub Release 中上传新版本，不需要把大体积便携版提交进 Git 历史。