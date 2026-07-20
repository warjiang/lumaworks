# LumaWorks

LumaWorks 是 macOS 优先的本地 AI 短剧工作台。它把故事梗概变成结构化剧本、角色和场景参考、竖屏分镜、Seedream 关键帧、Seedance 视频、多角色配音、中英文成片及平台投稿草稿。

## 当前能力

- Electron + React 桌面客户端，SQLite 本地数据库和本地媒体目录
- 可恢复、可取消、支持退避重试和幂等键的持久任务队列
- 火山方舟 Doubao Seed、Seedream 5.x、Seedance 2.x Fast 适配
- 火山语音中英文 TTS
- FFmpeg 竖屏拼接、配音、字幕烧录、母版和封面输出
- 小红书持久浏览器会话与辅助投稿
- TikTok Content Posting API 和 YouTube Data API 投稿
- macOS `safeStorage` 加密 API Key 与 OAuth Token

## 开发环境

需要 Node.js 22、pnpm 10+、Xcode Command Line Tools。

```bash
pnpm install
pnpm dev
```

`pnpm dev` 会先把 SQLite 原生模块重编译为当前 Electron ABI。若刚运行过 Node 环境的原生模块测试，也可以手动执行 `pnpm native:electron`。

类型检查、测试与生产构建：

```bash
pnpm verify
```

生成 macOS 安装包：

```bash
pnpm package:mac
```

首次启动后进入“设置”，配置火山方舟 API Key、火山语音凭据及所需平台的开发者应用凭据。

### 豆包语音合成 2.0 配置

语音使用官方 `POST /api/v3/tts/unidirectional`，不再调用历史 `/api/v1/tts`。语音凭据与方舟 API Key 不能互换：

1. 推荐打开[新版豆包语音 API Key 管理](https://console.volcengine.com/speech/new/setting/apikeys?projectName=default)，开通语音合成并创建 API Key，只填写设置页的“API Key”。
2. 旧版控制台用户可继续填写 App ID + Access Token，应用会使用官方 `X-Api-App-Id` 与 `X-Api-Access-Key` 双头鉴权。
3. 标准 2.0 音色的资源 ID 为 `seed-tts-2.0`；声音复刻 2.0 为 `seed-icl-2.0`。
4. 默认中文音色为官方示例 `zh_female_vv_uranus_bigtts`，默认英文音色为 `en_female_dacey_uranus_bigtts`。可在[音色列表](https://docs.volcengine.com/docs/6561/1257544?lang=zh)替换为账户有权使用的音色。
5. “测试并试听”会真实调用 TTS 2.0，验证鉴权、资源 ID、音色、`context_texts` 语音指令和 MP3 流式分片；成功后直接显示播放器。

诊断日志会记录客户端 Request ID、服务端 LogID、HTTP 状态、错误码、资源 ID、音色、分片数和输出字节数，但不会记录 API Key、Access Token、音频 Base64 或完整文本。接口参考：[单向流式语音合成 HTTP](https://docs.volcengine.com/docs/6561/2528925?lang=zh)、[语音指令与标签](https://docs.volcengine.com/docs/6561/1871062?lang=zh)。

### 模型测试

设置页为四类模型提供真实测试：

- 文本：要求 Doubao 返回结构化 JSON。
- 图片：使用 Seedream 生成一张临时竖屏测试图。
- 视频：先生成一张临时 Seedream 首帧，再用 Seedance 生成 4 秒视频。
- 语音：使用当前 Voice ID 合成中文测试音频。

测试素材保存在本地媒体目录，不进入正式项目。图片、视频和语音测试会调用正式计费接口；尤其视频测试会同时产生 Seedream 与 Seedance 调用费用。

文本模型默认使用火山方舟 `/api/v3/responses`，支持流式 SSE 和非流式 JSON。设置页可以切换到旧版 `/api/v3/chat/completions` 兼容模式。基础连接测试不会携带 `web_search`，避免联网工具的权限或计费影响模型本身的测试结果。

每次模型测试会生成请求 ID 和结构化诊断日志。设置页可以展开日志、复制内容或在 Finder 中打开完整 JSON。日志包含请求阶段、模型 ID、HTTP 状态、服务端 Request ID、轮询状态和耗时；Authorization、API Key、Token、Secret、Base64 媒体与完整提示词不会写入日志。

### Seedream / Seedance API 对齐

- 图片使用官方 `POST /api/v3/images/generations`。默认模型为 `doubao-seedream-5-0-pro-260628`；5.0 Pro 不发送组图和流式字段，竖屏使用官方 2K 尺寸 `1584x2816`。5.0 Lite、4.5、4.0 会显式使用 `sequential_image_generation: disabled` 生成单图。
- 视频使用官方 `POST /api/v3/contents/generations/tasks` 创建任务、`GET /api/v3/contents/generations/tasks/{id}` 查询任务。默认使用 Seedance 2.0 Fast、720p、9:16、关闭原生音频。
- 视频查询只接受官方状态 `queued`、`running`、`cancelled`、`succeeded`、`failed`、`expired`，默认每 30 秒查询一次；临时限流或服务端错误会继续重试。
- 取消本地视频任务时，应用会调用官方 `DELETE /api/v3/contents/generations/tasks/{id}` 尝试取消仍在排队的远端任务。

参考：[图片生成 API](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1541523?lang=zh)、[视频生成 API](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1520758?lang=zh)。修改主进程 Provider、模型 ID 或环境变量后，需要完整退出并重新运行 `pnpm dev`；仅修改 React 页面通常会热更新。已经保存在设置中的自定义模型 ID 不会被新默认值覆盖。

## 使用流程

1. 新建项目并填写至少 20 个字的故事梗概。
2. 依次生成故事圣经和分镜剧本。
3. 审核镜头提示词，批量生成关键帧和视频；失败镜头可以单独重做。
4. 生成中文配音；海外版本先做英文改写，再生成英文配音。
5. 所有镜头视频完成后渲染中文或英文成片。
6. 在投稿中心选择成片和平台，审核文案后入队发布。

小红书投稿依赖创作中心页面结构。检测到验证码、登录失效或选择器变化时，程序会暂停并保留浏览器窗口供人工处理。TikTok 和 YouTube 的官方接口需要开发者应用权限，未审核的 TikTok 应用可能只能发布私密内容。

## 本地数据

数据库、凭据密文和媒体位于 Electron 的 `userData` 目录。项目素材不会上传到 LumaWorks 自有服务器。模型生成和平台投稿只会发送到用户配置的官方服务。

## 已知边界

- 首版只验证 macOS arm64/x64。
- MVP 编辑器支持镜头排序所需的数据结构与 FFmpeg 成片，不提供专业时间线 NLE。
- 语音模型的可用音色由火山语音账户决定，默认音色可以通过任务参数覆盖。
- 平台 OAuth 回调需要开发者后台允许本机 loopback 地址；不允许时可以直接配置 Access Token。

## 验证命令

```bash
pnpm typecheck
pnpm test
pnpm build
```
