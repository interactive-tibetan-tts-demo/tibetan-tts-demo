# 藏语流式语音合成演示

这是一个可部署到 GitHub Pages 的匿名演示页面。页面没有个人姓名、学校、机构、原始服务器 IP 或密钥；它仅公开 Cloudflare Worker 的代理地址。

页面顶部展示：**“We reject fixed-template examples.”**。其含义是：审稿人不必只能听论文中预先给出的固定例子，而可以自行输入任意藏语文本，直接测试系统。

## 重要说明

GitHub Pages 只是静态网页，不能读取访客 IP，也不能限制每个 IP 的使用次数。为此，项目中的 Cloudflare Worker 负责：

- 保存真实 TTS HTTP 地址，地址不会写进 GitHub；
- 按 IP 记录合成请求；
- 每个 IP 累计只允许成功发起 **10 次合成**；
- 第 11 次开始拒绝合成；这个计数没有按天、按月或按刷新页面重置。

一次 HTTP POST 合成请求计为一次。刷新页面或重新打开网页不会消耗次数。

IP 限制不能阻止用户切换网络、使用代理或 VPN。为了避免用户绕过 Worker 直接访问真实 TTS 服务，必须在真实服务器防火墙中仅允许 Cloudflare 出站 IP 访问该 HTTP 服务。

## 目录结构

```text
index.html          页面结构与样式
app.js              浏览器端逻辑，只含 Worker 公共地址
worker/             Cloudflare Worker：隐藏上游地址并实施限制
```

## 第一步：仅预览页面

在此目录中打开 PowerShell：

```powershell
cd <path-to>\tts-demo-github
python -m http.server 8080
```

浏览器访问 `http://localhost:8080`。这一步可以检查页面和背景动画。此时还不能合成，因为 Worker 地址尚未配置。

按 `Ctrl+C` 停止本地预览服务器。

## 第二步：部署 Cloudflare Worker

准备：注册 Cloudflare 账号，并安装 Node.js 20 或更高版本。

```powershell
cd <path-to>\tts-demo-github\worker
npm install
npx wrangler login
npx wrangler secret put TTS_UPSTREAM_URL
```

执行最后一条命令后，粘贴真实的上游 HTTP 地址：

输入你实际的私有上游 API 地址，例如 `http://<服务器IP>:<端口>/api/v1`。不要把真实值写入仓库。

该地址只保存到 Cloudflare Secret，**不要**写入 `wrangler.toml`、`app.js` 或 GitHub。Worker 使用 Cloudflare 出站 TCP 连接访问这个裸 IP，不需要额外域名，也不需要让本地 PowerShell 长期运行。接口请求体为 `{"text":"藏文文本"}`，返回 JSON 中的 `data` 是 Base64 WAV 音频。

继续执行：

```powershell
npm run deploy
```

命令会输出类似下面的公开 Worker 地址：

```text
https://anonymous-tts-demo.<你的子域名>.workers.dev
```

将这个地址补上 `/tts`，并替换 `app.js` 第一行中的占位内容：

```js
const WORKER_HTTP_URL = "https://anonymous-tts-demo.<你的子域名>.workers.dev/tts";
```

然后回到项目根目录重新用 `python -m http.server 8080` 测试。输入一段藏语并点击合成；确认能播放或下载 WAV 后，再上传 GitHub。上游失败、超时或没有返回音频时不会消耗 IP 次数；只有成功返回音频才累计一次。

## 第三步：上传 GitHub 并开启网页

1. 在 GitHub 创建一个新的公开仓库，例如 `tibetan-tts-demo`。
2. 上传本目录内的 `index.html`、`app.js`、`README.md` 和 `worker` 文件夹。
3. 不要上传原始的 `TTSDemo - 副本.html`，不要上传任何含原始 HTTP 地址的文件。
4. 在仓库进入 `Settings` -> `Pages`。
5. 在 `Build and deployment` 中选择 `Deploy from a branch`。
6. 选择 `main` 分支和 `/(root)` 文件夹，点击 `Save`。
7. 等待 GitHub Pages 给出网址，例如 `https://<github用户名>.github.io/tibetan-tts-demo/`。

GitHub Pages 部署完成后，页面将通过 Worker 与隐藏的上游 TTS 服务通信。

## 修改合成总次数

默认每 IP 总共 10 次。若要修改，在 `worker/wrangler.toml` 中调整：

```toml
RATE_LIMIT_MAX_REQUESTS = "10"
```

修改后在 `worker` 目录重新执行 `npm run deploy`。已有 IP 的历史次数会保留；如需重新开始统计，需在 Cloudflare 中删除对应 Durable Object 数据，或使用新的 Worker 名称部署。
