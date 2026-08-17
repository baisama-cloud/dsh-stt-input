**中文** · [English](README.en.md)

# dsh-stt-input 

DeepSeek Harness (DSH) Web GUI 的语音输入插件。

点击输入框旁的 🎤 麦克风按钮开始说话，再点一次停止，识别文字自动填入输入框。
识别引擎与模型可在 **设置 → 语音输入** 中选择。

## 功能

- **两种识别引擎**
  - **浏览器本地识别** — 使用浏览器自带的 Web Speech API（`SpeechRecognition`，
    Chrome/Edge）。零配置、无需 API Key，边说边把中间结果写进输入框。
  - **API 识别** — 用 `MediaRecorder` 录音，通过任意 **OpenAI 兼容**
    `/v1/audio/transcriptions` 接口（OpenAI、Groq、自定义）转写。
- **模型可选** — `whisper-1`（OpenAI）、`whisper-large-v3`、
  `whisper-large-v3-turbo`、`distil-whisper-large-v3-en`（Groq），或自定义模型名。
- **可配置** — 服务预设（OpenAI / Groq / 自定义）、API Base URL、API Key、
  识别语言、写入方式（追加到输入框 / 替换输入框内容）。
- **实时状态条** — 输入框下方显示录音计时、识别中状态与错误信息。
- **隐私** — API Key 仅保存在页面内存中，不落盘、不打日志；非密钥配置通过
  `localStorage` 在刷新后保留。

## 安装

打包 tarball 后安装到你的 DSH web profile（与其他 `dsh-*` 插件一致）：

```bash
pnpm pack
# 把 dsh-stt-input-*.tgz 复制到 web profile 并添加依赖，
# 例如在 ~/.dsh/profiles/web 下：pnpm add ../path/to/dsh-stt-input-0.1.0.tgz
# 然后重启 `dsh web`。
```

插件注册了三个界面位：

- 输入框工具行的麦克风按钮（`conversation.input.left`）
- 输入框下方的状态条（`conversation.composer.dock`）
- 设置页（`settings.section` → 语音输入）

## 使用

1. 打开 **设置 → 语音输入** 选择引擎。
   - 浏览器本地识别：无需其他配置（Chrome/Edge）。
   - API 识别：选择预设（OpenAI 或 Groq）、模型，并粘贴 API Key。
     Groq 的 `whisper-large-v3` 目前免费。
2. 点击输入框旁的 🎤 开始录音，说话，再点一次停止。识别文字进入输入框，回车发送。

> 浏览器本地引擎依赖 Chrome/Edge 的 Web Speech API；Firefox 请使用 API 引擎。

## 工作原理

```
┌──────────┐  点击🎤        ┌───────────────┐
│  客户端  │ ─────────────▶ │ MediaRecorder │  (api 引擎)
│ (浏览器) │                │ SpeechRecog.  │  (browser 引擎)
└──────────┘                └──────┬────────┘
      ▲                           ▼
      │ setDraft(text)      base64 音频 (JSON)
      │              POST /stt-input/transcribe
      │                           │
┌─────┴──────┐           ┌───────▼────────┐
│  输入框    │ ◀──────────│  Host (Node)   │
└────────────┘  {ok,text} │  fetch → /v1/  │
                          │  audio/transcr.│
                          └────────────────┘
```

客户端（`lib/client.js`）录音后把 base64 JSON POST 到宿主路由
`/stt-input/transcribe`；宿主（`lib/index.js`）解码音频并以
`multipart/form-data` 上传到 `${baseUrl}/v1/audio/transcriptions`
（使用 Node ≥ 18 的全局 `fetch` / `FormData` / `Blob`）。

## License

MIT
