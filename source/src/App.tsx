import {
  Banana,
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  ImagePlus,
  LoaderCircle,
  Play,
  Settings,
  ShieldCheck,
  Square,
  Trash2,
  Wifi,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ConnectionSettings,
  GenerationHistoryItem,
  GenerationResult,
  InputImage,
} from "./domain/generation";
import { getGenerationAdapter } from "./lib/api";
import { loadHistory, saveHistory } from "./lib/storage/historyStore";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./lib/storage/settingsStore";

const readImage = (file: File) =>
  new Promise<InputImage>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        id: crypto.randomUUID(),
        name: file.name,
        mimeType: file.type || "image/png",
        dataUrl: String(reader.result),
      });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const downloadImage = (dataUrl: string, mimeType: string) => {
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = `nano-banana-${Date.now()}.${extension}`;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
};

const convertImageToPngBlob = (dataUrl: string) =>
  new Promise<Blob>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, image.naturalWidth);
      canvas.height = Math.max(1, image.naturalHeight);
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("无法创建图片剪贴板内容。"));
        return;
      }
      context.drawImage(image, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("无法转换要复制的图片。"));
      }, "image/png");
    };
    image.onerror = () => reject(new Error("无法读取要复制的图片。"));
    image.src = dataUrl;
  });

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("无法准备要复制的图片。"));
    reader.readAsDataURL(blob);
  });

const copyImage = async (dataUrl: string) => {
  const pngBlob = await convertImageToPngBlob(dataUrl);
  if (window.nanoBanana?.copyImage) {
    await window.nanoBanana.copyImage(await blobToDataUrl(pngBlob));
    return;
  }
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("当前环境不支持复制图片到剪贴板。请使用下载按钮保存图片。");
  }
  await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
};

const formatResultSummary = (text: string | undefined, isMock: boolean) => {
  const fallback = isMock ? "离线模拟结果" : "来自当前 API 的图片结果";
  const normalized = text?.replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;

  if (/https?:\/\//i.test(normalized)) {
    const withoutUrls = normalized
      .replace(/https?:\/\/\S+/gi, "")
      .replace(/[()[\]（）【】!！]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const label = withoutUrls && withoutUrls.length <= 80 ? withoutUrls : "图片已由 API 返回";
    return `${label} · 临时原图链接已隐藏`;
  }

  return normalized.length > 180 ? `${normalized.slice(0, 177)}…` : normalized;
};

const getErrorCode = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: string }).code || "")
    : "";

export default function App() {
  const [settings, setSettings] = useState<ConnectionSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState<InputImage[]>([]);
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [imageSize, setImageSize] = useState("1K");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<GenerationResult>();
  const [history, setHistory] = useState<GenerationHistoryItem[]>([]);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(() => new Set());
  const [connectionMessage, setConnectionMessage] = useState("尚未测试连接");
  const [settingsStorageMessage, setSettingsStorageMessage] = useState("配置会保存在本机");
  const [testingConnection, setTestingConnection] = useState(false);
  const [notice, setNotice] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copying" | "success" | "error">("idle");
  const [resultActionMessage, setResultActionMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const selectAllInput = useRef<HTMLInputElement>(null);
  const copyFeedbackTimer = useRef<number | null>(null);
  const settingsSaveTimer = useRef<number | null>(null);
  const abortController = useRef<AbortController | null>(null);
  const outputImage = result?.images[0];
  const isMock = settings.protocol === "mock";
  const resultSummary = result ? formatResultSummary(result.text, isMock) : "";
  const allHistorySelected = history.length > 0 && selectedHistoryIds.size === history.length;

  useEffect(() => {
    let active = true;
    void Promise.all([loadHistory(), loadSettings()]).then(([items, savedSettings]) => {
      if (!active) return;
      setHistory(items);
      setSettings(savedSettings);
      setSettingsLoaded(true);
    }).catch(() => {
      if (active) setSettingsLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    if (settingsSaveTimer.current !== null) window.clearTimeout(settingsSaveTimer.current);
    settingsSaveTimer.current = window.setTimeout(() => {
      void saveSettings(settings).then(() => {
        setSettingsStorageMessage("配置已保存到本机");
      }).catch((saveError) => {
        setSettingsStorageMessage(saveError instanceof Error ? saveError.message : "配置保存失败");
      });
      settingsSaveTimer.current = null;
    }, 350);
    return () => {
      if (settingsSaveTimer.current !== null) {
        window.clearTimeout(settingsSaveTimer.current);
        settingsSaveTimer.current = null;
      }
    };
  }, [settings, settingsLoaded]);

  useEffect(() => {
    setSelectedHistoryIds((current) => {
      const validIds = new Set(history.map((item) => item.id));
      const next = new Set([...current].filter((id) => validIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [history]);

  useEffect(() => {
    if (selectAllInput.current) {
      selectAllInput.current.indeterminate = selectedHistoryIds.size > 0 && !allHistorySelected;
    }
  }, [allHistorySelected, selectedHistoryIds.size]);

  useEffect(() => () => {
    if (copyFeedbackTimer.current !== null) window.clearTimeout(copyFeedbackTimer.current);
  }, []);

  useEffect(() => {
    if (copyFeedbackTimer.current !== null) window.clearTimeout(copyFeedbackTimer.current);
    copyFeedbackTimer.current = null;
    setCopyState("idle");
    setResultActionMessage("");
  }, [outputImage?.id]);

  const endpointLabel = useMemo(() => {
    if (settings.protocol === "mock") return "离线模拟";
    try {
      return new URL(settings.baseUrl).host;
    } catch {
      return "Base URL 无效";
    }
  }, [settings.baseUrl, settings.protocol]);

  const updateSettings = (nextSettings: ConnectionSettings) => {
    setSettings(nextSettings);
    setSettingsStorageMessage("正在保存配置……");
    setConnectionMessage("配置已变更，尚未测试");
  };

  const importFiles = async (files: FileList | File[]) => {
    const selected = Array.from(files)
      .filter((file) => file.type.startsWith("image/"))
      .slice(0, 4 - images.length);
    if (!selected.length) return;
    const imported = await Promise.all(selected.map(readImage));
    setImages((current) => [...current, ...imported].slice(0, 4));
  };

  const testConnection = async () => {
    if (settings.protocol === "mock") {
      setConnectionMessage("模拟模式不会访问网络");
      return;
    }
    setTestingConnection(true);
    setConnectionMessage("正在测试当前配置");
    try {
      await getGenerationAdapter(settings.protocol).testConnection(settings);
      setConnectionMessage("连接可用");
    } catch (connectionError) {
      setConnectionMessage(
        connectionError instanceof Error ? connectionError.message : "连接测试失败",
      );
    } finally {
      setTestingConnection(false);
    }
  };

  const generate = async () => {
    const requestId = crypto.randomUUID();
    const controller = new AbortController();
    abortController.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const nextResult = await getGenerationAdapter(settings.protocol).generate(
        settings,
        {
          requestId,
          prompt: prompt.trim(),
          images,
          model: settings.model,
          aspectRatio,
          imageSize,
        },
        controller.signal,
      );
      setResult(nextResult);
      setHistory((currentHistory) => {
        const nextHistory = [
          {
            id: nextResult.id,
            prompt: prompt.trim(),
            model: settings.model,
            result: nextResult,
          },
          ...currentHistory.filter((item) => item.id !== nextResult.id),
        ].slice(0, 20);
        void saveHistory(nextHistory);
        return nextHistory;
      });
      if (settings.protocol === "mock") setNotice("当前结果来自离线模拟。切换到 Gemini Native 后才会调用 API。 ");
    } catch (generationError) {
      if (getErrorCode(generationError) === "ABORTED" || (generationError instanceof DOMException && generationError.name === "AbortError")) {
        setError("请求已停止或超时。");
      } else {
        setError(generationError instanceof Error ? generationError.message : "生成失败");
      }
    } finally {
      abortController.current = null;
      setBusy(false);
    }
  };

  const selectHistory = (item: GenerationHistoryItem) => {
    setPrompt(item.prompt);
    setResult(item.result);
    setError("");
    setNotice("");
  };

  const toggleHistorySelection = (id: string) => {
    setSelectedHistoryIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllHistory = () => {
    setSelectedHistoryIds(
      allHistorySelected ? new Set() : new Set(history.map((item) => item.id)),
    );
  };

  const deleteSelectedHistory = () => {
    if (!selectedHistoryIds.size) return;
    const nextHistory = history.filter((item) => !selectedHistoryIds.has(item.id));
    if (result && selectedHistoryIds.has(result.id)) setResult(undefined);
    setHistory(nextHistory);
    setSelectedHistoryIds(new Set());
    void saveHistory(nextHistory);
  };

  const handleCopyImage = async () => {
    if (!outputImage || copyState === "copying") return;
    if (copyFeedbackTimer.current !== null) window.clearTimeout(copyFeedbackTimer.current);
    setCopyState("copying");
    setResultActionMessage("正在复制图片……");
    try {
      await copyImage(outputImage.dataUrl);
      setCopyState("success");
      setResultActionMessage("图片已复制到剪贴板");
      copyFeedbackTimer.current = window.setTimeout(() => {
        setCopyState("idle");
        setResultActionMessage("");
        copyFeedbackTimer.current = null;
      }, 2600);
    } catch (copyError) {
      setCopyState("error");
      setResultActionMessage(
        copyError instanceof Error ? copyError.message : "复制图片失败，请改用下载按钮。",
      );
    }
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark"><Banana size={20} /></span>
          <strong>Nano Banana</strong>
          <small>Playground</small>
        </div>
        <div className="header-status">
          <span className="status-chip privacy"><ShieldCheck size={15} /> 本地优先</span>
          <span className={`status-chip ${isMock ? "mock" : "online"}`}>
            {isMock ? <Wifi size={15} /> : <Wifi size={15} />}
            {endpointLabel}
          </span>
          <button className="icon-button" onClick={() => setSettingsOpen(true)} title="连接设置">
            <Settings size={19} />
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="history-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">仅本机</span><h2>创作历史</h2></div>
            <button
              className="icon-button"
              disabled={!selectedHistoryIds.size}
              onClick={deleteSelectedHistory}
              title={selectedHistoryIds.size ? `删除选中的 ${selectedHistoryIds.size} 条历史` : "请先勾选要删除的历史"}
              aria-label="删除选中的历史"
            >
              <Trash2 size={16} />
            </button>
          </div>
          {history.length > 0 && (
            <div className="history-selection-bar">
              <label>
                <input
                  ref={selectAllInput}
                  type="checkbox"
                  checked={allHistorySelected}
                  onChange={toggleAllHistory}
                />
                <span>全选</span>
              </label>
              <span>{selectedHistoryIds.size ? `已选 ${selectedHistoryIds.size} 项` : "勾选后删除"}</span>
            </div>
          )}
          <div className="history-list">
            {history.length === 0 ? (
              <p className="empty-copy">生成结果会保存在这里。</p>
            ) : history.map((item) => {
              const selected = selectedHistoryIds.has(item.id);
              return (
                <div
                  className={`history-item ${item.id === result?.id ? "active" : ""} ${selected ? "selected" : ""}`}
                  key={item.id}
                >
                  <label className="history-checkbox" title="选择此历史记录">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleHistorySelection(item.id)}
                      aria-label={`选择历史记录：${item.prompt}`}
                    />
                  </label>
                  <button className="history-open" onClick={() => selectHistory(item)}>
                    <img src={item.result.images[0]?.dataUrl} alt="历史结果" />
                    <span><strong>{item.prompt}</strong><small>{new Date(item.result.createdAt).toLocaleString()}</small></span>
                  </button>
                </div>
              );
            })}
          </div>
        </aside>

        <section className="composer-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">创作输入</span><h2>描述你想要的画面</h2></div>
            <span className={`local-badge ${isMock ? "mock-badge" : "remote-badge"}`}>
              {isMock ? "离线模拟" : "真实 API"}
            </span>
          </div>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="例如：一只橘猫坐在窗台上，清晨的柔和阳光，电影感摄影，保留细腻毛发……"
            rows={8}
          />

          <div
            className="dropzone"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void importFiles(event.dataTransfer.files);
            }}
          >
            <input
              ref={fileInput}
              hidden
              multiple
              type="file"
              accept="image/*"
              onChange={(event) => event.target.files && void importFiles(event.target.files)}
            />
            {images.length === 0 ? (
              <button className="dropzone-empty" onClick={() => fileInput.current?.click()}>
                <ImagePlus size={22} /><span>添加参考图</span><small>点击选择或拖入图片，最多 4 张</small>
              </button>
            ) : (
              <div className="input-images">
                {images.map((image) => (
                  <div className="input-image" key={image.id}>
                    <img src={image.dataUrl} alt={image.name} />
                    <button onClick={() => setImages(images.filter((item) => item.id !== image.id))} title="移除参考图">
                      <X size={14} />
                    </button>
                  </div>
                ))}
                {images.length < 4 && (
                  <button className="add-image" onClick={() => fileInput.current?.click()} title="继续添加参考图">
                    <ImagePlus size={20} />
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="generation-controls">
            <label><span>画面比例</span><select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}><option>1:1</option><option>16:9</option><option>9:16</option><option>4:3</option><option>3:4</option></select></label>
            <label><span>图片尺寸</span><select value={imageSize} onChange={(event) => setImageSize(event.target.value)}><option>1K</option><option>2K</option><option>4K</option></select></label>
          </div>

          {busy ? (
            <button className="primary-button" onClick={() => abortController.current?.abort()}><Square size={15} fill="currentColor" />停止生成</button>
          ) : (
            <button className="primary-button" disabled={!prompt.trim()} onClick={() => void generate()}><Play size={16} fill="currentColor" />{isMock ? "模拟生成" : "生成图片"}</button>
          )}
          {notice && <p className="composer-notice">{notice}</p>}
        </section>

        <section className="result-panel">
          <div className="result-toolbar">
            <div className="result-toolbar-title"><span className="eyebrow">输出预览</span><h2>{busy ? "生成中" : outputImage ? "生成结果" : "等待创作"}</h2></div>
            {outputImage && (
              <div className="toolbar-actions" role="group" aria-label="图片操作">
                <button
                  className={`image-action-button ${copyState === "success" ? "success" : ""}`}
                  disabled={copyState === "copying"}
                  onClick={() => void handleCopyImage()}
                  title={copyState === "success" ? "已复制图片" : "复制图片到剪贴板"}
                >
                  {copyState === "success" ? <Check size={17} /> : <Copy size={16} />}
                  <span>{copyState === "copying" ? "复制中" : copyState === "success" ? "已复制" : "复制"}</span>
                </button>
                <button className="image-action-button" onClick={() => downloadImage(outputImage.dataUrl, outputImage.mimeType)} title="下载图片">
                  <Download size={17} /><span>下载</span>
                </button>
              </div>
            )}
          </div>
          <div className="canvas-stage">
            {busy ? (
              <div className="canvas-empty"><LoaderCircle className="spinner" size={28} /><strong>正在请求图像模型</strong><span>{isMock ? "正在生成本地测试预览。" : "请求将发送到你配置的 Base URL。"}</span></div>
            ) : error ? (
              <div className="canvas-empty error-state"><strong>生成未完成</strong><span>{error}</span></div>
            ) : outputImage ? (
              <div className="result-image-frame">
                <img className="result-image" src={outputImage.dataUrl} alt="生成结果" />
              </div>
            ) : (
              <div className="canvas-empty"><Banana size={30} /><strong>结果将在这里出现</strong><span>先输入提示词，也可以加入参考图片。</span></div>
            )}
          </div>
          {result && (
            <footer className="result-meta">
              <span>{result.durationMs} ms</span>
              <span aria-live="polite" className={copyState === "error" ? "action-error" : copyState === "success" ? "action-success" : ""} title={resultSummary}>
                {resultActionMessage || resultSummary}
              </span>
            </footer>
          )}
        </section>
      </div>

      {settingsOpen && (
        <div className="settings-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <section className="settings-panel" aria-label="连接设置" onMouseDown={(event) => event.stopPropagation()}>
            <div className="panel-heading">
              <div><span className="eyebrow">本地配置</span><h2>连接设置</h2></div>
              <button className="icon-button" onClick={() => setSettingsOpen(false)} title="关闭设置"><X size={18} /></button>
            </div>
            <label className="field"><span>接口协议</span><select value={settings.protocol} onChange={(event) => updateSettings({ ...settings, protocol: event.target.value as ConnectionSettings["protocol"] })}><option value="gemini-native">Gemini Native（真实生成）</option><option value="openai-compatible">OpenAI Compatible（真实生成）</option><option value="mock">本地模拟（离线测试）</option></select></label>
            <label className="field">
              <span>Base URL</span>
              <input
                value={settings.baseUrl}
                spellCheck={false}
                placeholder={settings.protocol === "openai-compatible" ? "https://api.example.com/v1" : "请输入你的 Base URL"}
                onChange={(event) => updateSettings({ ...settings, baseUrl: event.target.value })}
              />
              <small>
                {settings.protocol === "openai-compatible"
                  ? "示例：https://api.example.com/v1；客户端会自动拼接 /images/generations，并添加 Bearer 鉴权与 JSON 请求头。"
                  : settings.protocol === "gemini-native"
                    ? "填写 Gemini API 根地址；客户端自动选择 Interactions 或 generateContent 端点，并自动添加 x-goog-api-key。"
                    : "模拟模式不会访问 Base URL。"}
              </small>
            </label>
            <label className="field"><span>API Key</span><div className="input-with-action"><input type={showKey ? "text" : "password"} value={settings.apiKey} autoComplete="off" placeholder="API Key 会加密保存在本机" onChange={(event) => updateSettings({ ...settings, apiKey: event.target.value })} /><button onClick={() => setShowKey((value) => !value)} title={showKey ? "隐藏 API Key" : "显示 API Key"}>{showKey ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
            <label className="field"><span>模型 ID</span><input value={settings.model} spellCheck={false} onChange={(event) => updateSettings({ ...settings, model: event.target.value })} /><small>例如 `gemini-3.1-flash-image` 或你的代理支持的图像模型 ID。</small></label>
            <small className="settings-storage-note">{settingsStorageMessage}。API Key 使用系统安全存储，不会写入普通网页存储。</small>
            <div className={`connection-message ${connectionMessage === "连接可用" ? "success" : ""}`}><span />{connectionMessage}</div>
            <button className="secondary-button" disabled={testingConnection} onClick={() => void testConnection()}>{testingConnection ? "正在测试" : settings.protocol === "mock" ? "检查离线模式" : "测试连接"}</button>
          </section>
        </div>
      )}
    </main>
  );
}
