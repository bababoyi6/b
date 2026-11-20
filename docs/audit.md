# 工程验收记录

## 2026-11-20 单文件部署版

固定基线为拉取时 GitHub `main` 的 `9bae14677f663670fceed2e007b6b3d6b4347368`。本地原有 `main` 为 `37dd816`，双方历史已分叉。优化分支从 GitHub 的提交创建。以下是本轮对照，后面的历史数据使用其他基线。 [固定基线](https://github.com/bababoyi6/b/tree/9bae14677f663670fceed2e007b6b3d6b4347368)

### 首连与故障恢复

- 同一 isolate 内，相同域名和配置共用一次 WebCrypto 密钥派生。缓存最多八个域名，配置变化后按新值导出，失败的初始化可重试。历史 Durable Object 读取留在发起请求的调用中。PBKDF2-SHA256 保持 16,000 次，盐、HKDF 上下文和签发格式继续兼容。
- 有效内联票据在本地验证 HELLO 后直接返回 WELCOME。接近过期时用同一父会话走幂等 Session 创建，多 lane 共用续签。HTTP 明确拒绝立即结束，503 按 `Retry-After` 秒数退避，网络失败最多尝试四次。创建或续签各有 21.5 秒上限。首次客户端 Upgrade 受 HELLO 后 30 秒总预算约束，单次 Upgrade 上限为 8 秒。退出页面会取消请求和定时器。新 lane 握手失败由客户端重建父会话，已建 lane 断开只终止对应流。
- 收到完整混淆头后才拨号。保持 KWS 每次 3 秒、慢主连接 900 毫秒后启动备用、每实例最多八个并行备用竞速。主连接明确失败会立即试备用，关闭落败和晚到连接。新增 HTTP、子协议、网络与超时计数。Worker 仍有 12 秒等待流头与建立上游。握手后首批有效响应取决于客户端数据和 KWS。
- `/admin` 新增 Bridge 配置与页面耗时，已有 Upgrade、KWS、第一批上游字节和第一批转发统计。只统计当前 isolate。生产采样分辨率受 Workers 时钟影响。WebView 启动、DNS、TCP、TLS 和真实网络耗时需在客户端和在线域名上采集。 [Worker 源码](../telegram_webproxy.js) · [首包基准](../benchmarks/startup.mjs)

首包基准运行实际 Bridge 脚本、路由、票据、lane 和加解密，WebSocket 与 KWS 在 Node.js 进程内模拟。模块加载单列，其他阶段从 Bridge 请求开始累计。预热后两版交替各 40 轮。三种单连接场景各 40/40 成功，超时和 Session POST 均为 0。主入口立即失败的场景每次拨号两次，其余每次一次。分位尾部样本不足以报告 P99。

| 场景或阶段 | 基线 P50 / P95（ms） | 新版 P50 / P95（ms） |
| --- | ---: | ---: |
| 冷模块加载 | 3.297 / 4.331 | 3.646 / 4.904 |
| 冷 Bridge 页面 | 3.329 / 3.925 | 3.303 / 3.923 |
| 冷 Bridge 脚本初始化 | 4.105 / 4.705 | 4.046 / 4.740 |
| 冷 Session Ready（WELCOME） | 4.250 / 4.848 | 4.158 / 4.852 |
| 冷 WebSocket Upgrade | 4.982 / 5.624 | 4.930 / 5.726 |
| 冷 KWS Connected | 5.854 / 6.589 | 5.803 / 6.664 |
| 冷首批上游字节 | 6.240 / 7.057 | 6.221 / 7.130 |
| 冷首批转发字节 | 6.683 / 7.550 | 6.687 / 7.557 |
| 热首批转发字节 | 2.050 / 2.225 | 2.051 / 2.305 |
| KWS 主入口失败后，备用首批转发字节 | 6.580 / 6.953 | 6.622 / 7.281 |
| 同域八个冷 Bridge 页面全部完成 | 6.523 / 7.296 | 4.418 / 4.616 |

八个冷请求的耗时范围为 6.170–8.990 → 4.122–4.766 ms。每轮 PBKDF2 8 → 1 次，HKDF 中位数 10 → 2 次，CryptoKey 导入中位数 23 → 4 次，HMAC 签名和验证均为 32 次。前一轮并发冷请求的 P95 为 7.633 → 5.900 ms。单连接冷首批转发 P95 持平，冷模块加载 P95 上升。首批转发是代理层指标。Telegram 登录、消息同步和客户端断线重连耗时尚待实测。

### 数据传输对照

256 KiB 以上、最多 512 KiB 的上传包可用一次 WebCrypto 调用得到 KWS 密文，省去分段结果拼接。大于 512 KiB 的包继续按 256 KiB 加密。KWS 消息边界和预算上限沿用基线。Bridge 记录已校验下行帧的位置，直接交给原生 WebView，MessagePort 继续转移原批次。扩大 Worker 下行合批的实验拖慢了双向连续负载。收窄实验后，单向下载的 ArrayBuffer 采样峰值仍由约 16 MiB 增至 28 MiB。两项实验均已撤回。

Windows 上 Node.js 24.16.0，16 个逻辑 CPU。两版各预热一次，交替七轮。吞吐为中位数［最小–最大］，延迟为各轮批完成延迟分位数的中位数。持续下载为 16 MiB、每包 128 KiB，持续上传为 32 MiB、每包 512 KiB。混合负载同时运行一条交互 lane 和两条媒体 lane。 [可复现基准](../benchmarks/transport.mjs)

| 本地负载 | 吞吐 MiB/s，基线 → 新版 | P50 / P95 ms，基线 → 新版 |
| --- | --- | --- |
| 交互小包 | 1.498［1.415–1.549］→ 1.422［1.314–1.512］ | 0.072 / 0.108 → 0.074 / 0.120 |
| 交互与媒体 | 316.7［284.2–350.6］→ 325.8［308.0–340.8］ | 0.089 / 2.009 → 0.089 / 1.962 |
| 连续大块双向 | 810.1［698.3–1586.8］→ 1119.3［786.8–1627.4］ | 2.347 / 4.727 → 1.310 / 2.842 |
| 512 KiB 双向 | 1332.8［1281.4–1462.1］→ 1377.9［1250.7–1424.4］ | 1.167 / 2.993 → 1.130 / 2.655 |
| 持续下载 | 858.0［421.6–888.9］→ 858.6［719.3–865.5］ | 1.068 / 1.794 → 1.101 / 1.620 |
| 持续上传 | 1195.7［913.2–1285.8］→ 1643.4［826.3–1735.7］ | 1.510 / 2.730 → 1.118 / 2.457 |

| 本地负载 | AES 调用 | KWS / Worker 客户端发送 | ArrayBuffer 采样峰值增量（MiB） | 进程 CPU 中位数（ms） |
| --- | --- | --- | --- | --- |
| 交互小包 | 880 → 880 | 220 / 440 → 220 / 440 | 0 → 0 | 0 → 0 |
| 交互与媒体 | 864 → 864 | 320 / 432 → 320 / 432 | 0 → 0 | 16 → 0 |
| 连续大块双向 | 384 → 384 | 96 / 192 → 96 / 192 | 5.011 → 0 | 0 → 0 |
| 512 KiB 双向 | 160 → 128 | 32 / 64 → 32 / 64 | 0 → 0 | 0 → 15 |
| 持续下载 | 256 → 256 | 0 / 128 → 0 / 128 | 0 → 0 | 0 → 0 |
| 持续上传 | 192 → 128 | 64 / 64 → 64 / 64 | 13.003 → 0 | 0 → 0 |

上传的 AES 调用下降与本地持续上传的 P95 改善均在复跑中出现，前一轮 P95 为 3.262 → 2.348 ms。持续下载未测得稳定吞吐提升。双向大块的吞吐范围高度重叠，ArrayBuffer 峰值增量范围为 0–8.761 → 0–12.011 MiB。CPU 读数大多为 0 或约 16 ms。内存采样受 GC 和时间间隔影响，0 代表未抓到增量。边缘 CPU、真实 isolate 峰值与公网吞吐待实测。

### 安全审计

| 严重度 | 发现 | 处理与剩余风险 |
| --- | --- | --- |
| 中 | 并发冷请求重复派生，过期或编码不合法的票据可先触发冷配置 | 共用密钥派生，先检查票据编码和期限，再进行签名校验。格式正确的 Bridge 能力码仍需要派生后的密钥来验证。回归覆盖并发、初始化失败重试、密码及域名变化。 |
| 中 | 父会话到期后已建立的 lane 可继续占用资源 | 在父授权到期时关闭 lane。空闲 lane 超期释放有回归。DELETE、流 ID、配额和登录限流仍是 isolate 局部状态。跨实例重放和全局即时撤销需共享状态。 |
| 中 | 单 Secret 模式的代理密钥由域名和密码确定 | 保持派生参数以兼容已发行链接。泄露代理密钥或可长期使用的 Bridge 能力码时，可离线校验密码猜测。使用独立高熵密码并保护链接。旧随机种子部署继续使用独立密钥来源。 |
| 低 | 错误 Upgrade 和慢流可占用资源 | Upgrade 响应构造失败时归还配额及流 ID。实例、会话和 lane 继续限制字节数和条目数。验证慢流隔离、窗口恢复和异常关闭。入站消息投递给 JS 前的原生分配由平台管理。 |
| 低 | 认证材料随请求元数据传输，KWS 路由需受控 | KWS 只访问 DC 1–5 的官方 HTTPS 主机，禁用重定向并校验 `binary` 子协议。应用无凭证日志或第三方采集。部署侧日志也须保护 URL 查询、`Authorization` 和 `Sec-WebSocket-Protocol`。 |

认证继续使用域名绑定、HMAC 用途隔离、定时安全比较、登录限流、同源表单、CSP 与 Secure/HttpOnly/SameSite Cookie。密码变化使旧管理 Cookie 无效。已建立的代理连接按其生命周期结束。

### 默认载体、免费版和三网

- 默认采用 `websocket-lanes`。单 WebSocket 可减少 Upgrade，同时共享发送队列和断线范围。官方规范要求拒绝同一 relay session 的第二条载体。无共享状态时，不同 isolate 可同时校验同一票据，无法跨实例原子拒绝。单 Worker 调用内多流拨号还需处理六个等待响应头的连接及 50 个 Free 子请求的累计限额。本轮完成协议及架构核对，未实现复用载体或执行两种载体的真机 A/B。 [Telegram 载体协议](https://github.com/telegramdesktop/tproxy-server/blob/master/PROTOCOL.md#carrier-modes) · [Workers 限额](https://developers.cloudflare.com/workers/platform/limits/)
- Free 当前公布每个 HTTP 请求 10 ms CPU、每 isolate 128 MB、每日 100,000 请求。单 lane 最多发起两个 KWS 请求。单文件 p-only 方案无额外绑定。真实 workerd 以 2026-11-18 兼容性日期验证 `arraybuffer` 和 Close 回送。平台 WebSocket 入站限制为 32 MiB，应用载体消息上限为 2 MiB。运行时更新可断开仍在使用的连接。 [Workers 限额](https://developers.cloudflare.com/workers/platform/limits/) · [WebSocket 运行时](https://developers.cloudflare.com/workers/runtime-apis/websockets/)
- 默认沿用 Custom Domain 和默认放置。Anycast 入口、Worker 执行位置与 KWS 出站目标是三个测量点。Smart Placement 与香港、东京、新加坡提示须通过 Cloudflare 配置启用，只影响 Worker 放置。电信、联通、移动尚无配对数据。应按运营商记录连接成功率、冷暖首包、断线、交互 P95、未缓存下载和上传吞吐，再决定放置。 [Cloudflare Placement](https://developers.cloudflare.com/workers/configuration/placement/) · [可选亚太配置](../wrangler.apac.jsonc)

### 实际运行

| 命令 | 结果 |
| --- | --- |
| `node --check telegram_webproxy.js`、`node --check benchmarks/startup.mjs` | 通过 |
| `npm test` | 39 项通过。覆盖独立 CTR、三种 transport、最大包、票据、退避与取消、KWS 主备和 lane 关闭 |
| `npm run test:runtime` | 5 项通过。覆盖 workerd WebSocketPair、Close、二进制类型与缓冲、单 Secret 并发冷 Bridge、登录及 Upgrade |
| `npm run bench -- --against=9bae14677f663670fceed2e007b6b3d6b4347368` | 每版每负载七轮，校验字节数及 KWS 消息边界 |
| `npm run bench:startup -- --against=9bae14677f663670fceed2e007b6b3d6b4347368` | 每版每场景四十轮，校验返回明文字节 |

使用 Vitest 4.1.12、Cloudflare Vitest 插件 1.8.5、workerd 1.20261118.1。最终回归无失败或跳过。GitHub Actions 远端流水线、Cloudflare 在线 CPU 和内存、长时间实网断连、Desktop/iOS/Android 发行版互通及中国大陆三网未执行。本地模拟无法确认 Cloudflare Free 在线 CPU 是否始终满足上限。 [回归工作流](../.github/workflows/regression.yml) · [基准工作流](../.github/workflows/benchmark.yml)

### 密钥来源与回滚

- 单 Secret 部署升级时沿用现有域名和 `p`，旧 Telegram 链接可继续使用。原先启用 `PROXY_SEED`、`PORTAL_KEY` 或 `PROXY_STATE` 的部署继续保留相同 Secret 和绑定。历史部署配置仍支持 `PROXY_STATE`。
- 如果旧 JS 使用[离线工具](../prepare-dashboard.html)填入了随机种子，升级时须沿用原种子。可以使用同一个种子生成新的私有部署文件，历史 `PROXY_SEED` 也支持原种子。
- 在 Cloudflare Dashboard 的 **部署** 中回滚到上一次可用版本。也可重新粘贴本轮基线 JS，沿用原密钥和域名，从 Telegram 重连。单 Secret 版本以 `9bae146` 为回退基线。 [基线源文件](https://github.com/bababoyi6/b/blob/9bae14677f663670fceed2e007b6b3d6b4347368/telegram_webproxy.js) · [Cloudflare 回滚](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)

## 历史记录

在此源码包中运行 `npm run bench` 即可测当前版本。如需和旧版本对照，可用 `npm run bench -- --against=提交号`，对应提交需已存在于本地。

上游基线是 `e565c57ff58656fd544755f67e1c266148c0b88f`。WEB 协议核对版本是 `c8adb8b7c6b7fc46c12ae3acb68be9070c26a8e8`。 [上游源码](https://github.com/ToiCF/CF-Workers-TGProxy/blob/e565c57ff58656fd544755f67e1c266148c0b88f/telegram_webproxy.js) · [WEB 协议](https://github.com/telegramdesktop/tproxy-server/blob/c8adb8b7c6b7fc46c12ae3acb68be9070c26a8e8/PROTOCOL.md)

## 缺陷审计

| 范围 | 基线观察 | 候选版处理和验证 |
| --- | --- | --- |
| 配置与 bootstrap | `authBoot` 直接比较 `v === boot`，永久变量可充当创建会话的 Bearer。旧版只判断 `BOOT` 非空 | 移除永久 Bearer 路径。当前版本使用单个随机访问码，按域名和用途通过 HKDF-SHA256 派生代理密钥与内部签名密钥。两分钟 bootstrap、lane 票据和续签凭证签名用途独立，域名绑定。合成凭证负例覆盖用途混用、错误签名、密钥轮换、过期和异域使用 |
| leases、撤销和重复 sid | `leases` 是实例内 Map。DELETE 得到响应后，另一实例可能仍接受原票据。本实例已连接的 lane 也仅在收到下次数据时检查撤销。逐握手扫描过期条目 | 签名校验独立于实例状态。局部记录负责重复 sid、撤销、配额，清扫最多每 30 秒由入站活动触发。DELETE 之后，本实例的新连接和续签被拒绝，存量 lane 在检查到撤销的 I/O 处关闭 |
| 会话寿命与重放 | 创建每次签发不同票据。五分钟后仍在线的 Bridge 用原票据开新流会失败；之前的 lane 可继续 | 同一合法 HELLO 重试得到同一对票据。新 lane 按需共享短期票据续签，资格约 12 小时。重放未过期的凭证仍可能在另一个 isolate 成功。测试跨过原五分钟边界并检查旧 lane |
| 输入大小和故障响应 | `req.arrayBuffer()` 在校验 HELLO 前读全体；未配置返回可区分的 500，有公开 `/health` | HELLO 固定 9 字节、短读取期限。除公开站点首页外，未认证、未配置、错误路由用同样的空 404。过载 503 仅出现在通过鉴权后 |
| AES-CTR | 串行正常路径已有尾部处理。并发调用同一个实例共享 IV，最终计数回绕会在加密后检测 | 明确拒绝并发，校验整个计数区间，并允许耗尽前最后一个合法块。四个方向的 CryptoKey 各导入一次。对照 NIST 向量和独立 OpenSSL CTR，覆盖随机分片和计数进位 |
| MTProto 与 KWS | 支持三种 transport tag，出站由 DC 和 media 选择。基线把每个 KWS transport packet 单独发送，不能把 TCP 合包结论直接套用 | 保留 mode、DC/media 和内层 MTProto 字节，校验 KWS Upgrade 的 `binary` 子协议。Mock 检验三种 mode、碎片头、quick-ack 位和每个 KWS 消息边界 |
| 分片复制和 GC | `mkPkt` 对跨分片包反复拼接 tail，会在大包拆成大量小块时反复复制 | 首段解析出长度后只分配一次包缓冲，连续包用视图，合成数据验证最大 8 MiB 包仅一次 KWS send。原生 send 所用的字节缓冲由当前任务持有，之后不原地复用 |
| 上下行调度 | 每批下行小消息等 1 ms。每个 KWS 发送经过 ready/Promise | 先发送可处理的数据，机会性合并现有队列。小批 32 KiB，连续大包 256 KiB，KWS 发送次数仍按原始包数计算。Worker 给客户端的 DATA 帧始终 ≤64 KiB。客户端发送缓冲有空间时，一个 WebSocket 消息可承载多个完整 DATA 帧 |
| 流控和内存 | 上行有 4 MiB 窗口，下载 KWS 事件队列缺少字节硬限。基线将 `WINDOW` 加到接近 4 GiB，无整实例内存预算 | 保持每向 4 MiB 窗口。按 lane、会话、isolate 预算上下载队列、保留的帧、分段大包和加密临时缓冲。支持 `bufferedAmount` 的运行时额外管控已交给 native 的排队。故障测试覆盖额度用尽、超时、慢 lane 和其他 lane 独立继续 |
| 连接与释放 | KWS 每个候选等待 7.5 秒，失败后的资源靠多条回调收尾；旧任务可能在 close 之后返回 | 同一 DC 最多两个握手，每次最多三秒。主入口持续 900 ms 时可尝试备用，实例内最多并行八条流。先通过校验的连接转发数据，超时、落败或旧 lane 已关闭时回收晚到的连接。静态 lane 身份、AbortSignal 和明确阶段隔离旧任务。关闭时清理定时器、队列与两边 socket |
| Cloudflare 更新 | 原版 accept 使用 half-open，二进制类型在 accept 后设置 | 在 accept 前明确设为 `arraybuffer`。关闭处理兼容旧的手动回复与新自动回复。保留事件投递之前的运行时缓冲、Linux 边缘 CPU 和连接重启作为平台约束 |

Cloudflare 平台收到完整 WebSocket 消息后才交给 JS。应用预算和 Close 帧无法限制 Worker 事件投递前已经进入运行时的缓冲。可见的 native send backlog 计入预算，关闭时运行时仍可能持有待释放的缓冲。 Cloudflare 的 `1101` / `1102` 仍需在真实部署的图表中观察。 [WebSocket 运行时语义](https://developers.cloudflare.com/workers/runtime-apis/websockets/) · [workerd WebSocket 定义](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/web-socket.h) · [平台限额](https://developers.cloudflare.com/workers/platform/limits/)

## 载体选择与网络边界

- **保留 WebSocket lanes。** 单 lane 有独立的流控和出站连接。复用单 WebSocket 可节省握手，同时把多流排队与连接故障集中到一条通道。当前没有同地域真机证据表明多流复用能改善综合体验。HTTPS 两种载体需要持久地维持独立请求之间的游标、流和缓冲，代理会话按实例管理，目前使用 WebSocket lanes。 [官方四种载体规范](https://github.com/telegramdesktop/tproxy-server/blob/c8adb8b7c6b7fc46c12ae3acb68be9070c26a8e8/PROTOCOL.md#carrier-modes)
- **Windows 和 iOS 以实际客户端源码为准。** Desktop 支持注入的 WEB Proxy 消息边界及回环备用模式。iOS 同样通过注入消息对象与 Bridge 通信，WKWebView 安全配置明确允许同域 WSS。独立服务 Telemt 对其当前客户端环境采用自己的 iOS 协商约束，发行版与此 Worker 的互通以真机验证为准。Android 保留文档定义的 nonce 和 WebMessage 路径。 [Desktop 源码](https://github.com/telegramdesktop/tdesktop/blob/a532622be61ffb811c34311583c9fd4828786833/Telegram/SourceFiles/mtproto/web_proxy/web_proxy_webview.cpp) · [iOS 载体源码](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/WebProxyTransport/Sources/WebProxyWebViewCarrier.swift) · [iOS 安全配置](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/WebProxyTransport/Sources/WebProxyWebViewHardening.swift) · [Telemt 文档](https://github.com/telemt/telemt/blob/dac7aeeeda55951cf03a229ee9357e2af558d45e/docs/WEB/WEB_PROXY.en.md)
- **KWS 同 DC 有限回退。** 两个官方入口的尝试顺序按 media 标志调整。建立后失败时，由对应 Telegram 流重建，未经确认的密文字节由原连接丢弃。保留 Worker 对官方目标的严格允许列表，HTTPS Upgrade 禁止跟随重定向。 [Telegram Web K 混淆实现](https://github.com/morethanwords/tweb/blob/2e4bbb52b6aec5e95ee32e5c2882c1f05de32200/src/lib/mtproto/transports/obfuscation.ts)
- **调度思路。** GrainTCP 的串行 writer、机会性合包和连接代际隔离启发 Worker 队列。TCP relay 的 BYOB 与流合包适用于字节流 writer。KWS 仍需保持每条 WebSocket 消息的包边界，因此只把连续包合在一次 AES 调用里，随后逐包 send。 [GrainTCP](https://github.com/ToiCF/GrainTCP/tree/1d22628f4d1413989f521f1d41591b0c72e658eb) · [edgetunnel](https://github.com/cmliu/edgetunnel/tree/5b2aaf0daf7fa1b126170877f64dd8d2e34c2746)
- **接入层。** 原生客户端和 WebView 使用配置主机名来建立 TLS 和 WSS。CloudflareSpeedTest 的测量有助于实验筛选 IP，无法确认原生应用使用了候选地址，或保证证书、SNI、路由及长期效果。默认使用 Cloudflare Custom Domain。Placement Hints 影响 Worker 运行位置。[亚太部署配置](../wrangler.apac.jsonc)以香港为默认目标并提供东京和新加坡测试环境。选地区需要同时观察客户端接入和 Worker 至 KWS 的实测表现。 [CloudflareSpeedTest](https://github.com/XIU2/CloudflareSpeedTest/tree/50b42c7f95cfb06413740ce6e1967578ebe63380) · [Cloudflare Placement](https://developers.cloudflare.com/workers/configuration/placement/) · [Cloudflare Custom Domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

本次支持根路径 v1。官方 v2 Base Path 有单独的 host+path HMAC 上下文和链接格式。配置页独立于根路径 v1 Bridge。对公开服务的探测只能通过认证和最小化响应降低披露。在网络上，客户端 TLS 指纹与 Cloudflare 入口的可达性仍由各自平台决定。 [Base Path](https://github.com/telegramdesktop/tproxy-server/blob/c8adb8b7c6b7fc46c12ae3acb68be9070c26a8e8/BASE_PATH.md) · [公开探测防护](https://github.com/telegramdesktop/tproxy-server/blob/c8adb8b7c6b7fc46c12ae3acb68be9070c26a8e8/HARDENING.md)

## 自动化执行记录

2026-11-19 使用 Windows 11、Node.js 24.16.0、Vitest 4.1.12、Cloudflare Vitest 插件 1.8.5 与 workerd 1.20261118.1 执行。

| 命令或操作 | 结果 |
| --- | --- |
| `node --check telegram_webproxy.js` | 单文件 Module Worker 语法检查通过 |
| `npm test` | 25 项通过。协议官方向量、独立 CTR、最大分片包、错误凭证、Bridge 注入运行、票据续签、KWS 超时和晚到握手、积压与多 lane 隔离 |
| `npm run test:runtime` | 3 项通过。真实 workerd 的 `WebSocketPair`、101/lane 子协议、二进制类型、native `bufferedAmount`、模拟 KWS 回连和 DELETE |
| Wrangler 4.165.0 `pages dev` | 同一 JS 复制为 `_worker.js` 后编译启动。当时的版本对公开根路径返回 404，私人页和有效 Bridge 各得 200。仅使用回环地址与合成密钥 |
| `npm run bench` | 预热后交替执行原版和新版，各 7 轮。所有轮次验证双向字节计数和 KWS 消息边界 |

[协议回归](../tests/protocol.test.js) · [Bridge 回归](../tests/bridge.test.js) · [连接回归](../tests/lane.test.js) · [运行时回归](../tests/module.workers.test.js) · [GitHub Actions](../.github/workflows/regression.yml)

## 原版与新版性能对照

Windows 11，Node.js 24.16.0，16 个逻辑 CPU。模拟 WebSocket 在本机内存中运行，双向输入独立产生。小包为 1 条 lane 往返 220 次、每次每方向 64 B。混合负载为 3 条 lane 并行，分别使用 128 B 交互帧和两组 64 KiB、8 KiB 媒体包。连续大块为 1 条 lane 双向总计 24 MiB，以 128 KiB 包、每批 8 个包投递。每一轮计算批完成延迟的分位数，再取 7 轮中位值。范围为 7 轮的最小到最大值。

| 负载 | 双向吞吐 MiB/s，原版 → 新版 | P50 ms，原版 → 新版 | P95 ms，原版 → 新版 |
| --- | --- | --- | --- |
| 交互小包 | 0.010 → 1.001 | 15.194 → 0.113 | 17.228 → 0.157 |
| 交互与媒体 | 8.197 → 252.283 | 5.897 → 0.126 | 15.823 → 2.410 |
| 连续大块 | 901.402 → 1,307.360 | 2.162 → 1.355 | 2.571 → 2.239 |

连续大块的吞吐范围重叠，原版 814.307–1,403.566 MiB/s，新版 839.328–1,434.694 MiB/s。新版连续大块的 P95 最差轮次为 4.139 ms，原版为 2.784 ms。小包差异主要来自旧版计时器等待在本机调度下被放大。以上数字只反映进程内路径，公网 RTT、边缘 CPU 和用户文件传输速度需要另测。

| 负载 | WebCrypto AES 调用，原版 → 新版 | KWS send，原版 → 新版 | Worker 向客户端 send，原版 → 新版 | ArrayBuffer 采样峰值增量中位数，原版 → 新版 |
| --- | --- | --- | --- | --- |
| 交互小包 | 880 → 880 | 220 → 220 | 440 → 440 | 0 → 0 MiB |
| 交互与媒体 | 1,040 → 864 | 320 → 320 | 568 → 472 | 0 → 0 MiB |
| 连续大块 | 384 → 384 | 96 → 96 | 288 → 288 | 2.767 → 12.011 MiB |

原版和新版的 WebCrypto 结果分配字节数一致，三组分别约 0.054、19.078 和 48 MiB。ArrayBuffer 采样包含尚未 GC 的分配，短时的 0 视为采样分辨率不足。Windows 的进程 CPU 计量每轮只得到 0–32 ms 的稀疏数据，无法据此断定每请求 CPU 变化。连续大块每个方向使用预算约束，但新版进程采样的内存峰值仍较高，这是测得的代价。可用 GitHub Actions 在 Linux 上重跑并检查完整范围。 [可重放基准](../benchmarks/transport.mjs)

## 对照直接上一版 a011a6a

在 Windows、Node.js 24.16.0、16 个逻辑 CPU 上以 `node --expose-gc benchmarks/transport.mjs --against=a011a6a` 每次交替运行七轮。测试按原协议逐帧核对双向字节数。吞吐在同一进程内测得，下表为第一次运行的中位数。

| 负载 | Worker 向客户端 send 次数 | P95 中位值，上一版 → 本次 | 吞吐中位值，上一版 → 本次 |
| --- | --- | --- | --- |
| 交互小包 | 440 → 440 | 0.114 → 0.118 ms | 1.466 → 1.440 MiB/s |
| 交互与媒体 | 472 → 432 | 1.957 → 1.849 ms | 329.190 → 334.803 MiB/s |
| 连续大块 | 288 → 192 | 3.008 → 2.791 ms | 926.802 → 856.225 MiB/s |

连续大块的吞吐波动区间重叠，上一版约 690–1,448 MiB/s，本次约 765–1,561 MiB/s。独立复跑七轮时，该场景的吞吐中位数为 763 → 1,060 MiB/s，P95 为 3.565 → 2.635 ms。两次的大块吞吐中位数变化方向不同，发送次数 288 → 192 在两次均复现。握手超时和备用竞速由单独的模拟时钟用例验证。大陆实网延迟、下载速度和可识别性待实测。 [可重放基准](../benchmarks/transport.mjs) · [上游连接测试](../tests/lane.test.js)

## 下载路径复测

基线为 `afbcb5c`，候选版在下行队列紧张时一次发送缓冲能容纳的完整帧，并把 Bridge 的流量统计按 100 ms 汇总。数据帧按原顺序转发，每帧最多 64 KiB，流量统计单独汇总。

| 本地模拟负载 | 基线中位耗时 | 候选中位耗时 | 可重复的操作变化 |
| --- | --- | --- | --- |
| Chrome Bridge，128 个 64 KiB 数据块 | 196 ms | 190 ms | 流量统计消息 128 → 2 |
| Chrome Bridge，512 个 16 KiB 数据块 | 217 ms | 194 ms | 流量统计消息 512 → 2 |
| 模拟发送缓冲受限，转发 16 MiB | 427 ms | 424 ms | WebSocket 发送次数 256 → 64 |

每项交替执行七轮。Chrome 测试模仿桌面端的 Base64 消息边界，由本地接收器核对数据量。更大的 DATA 帧和更快的缓冲轮询在本机对照中耗时反而增加，两个实验都已撤回。下载验收还需要用同一台电脑、同一条国内网络，对照旧版和新版下载同一个未缓存文件。

## 安全与现场验收边界

鉴权、凭证隔离、输入边界、关闭和重连已在合成环境验证。域名首页显示 Welcome to nginx!。在 `/admin` 验证密码后，管理页提供代理链接和连接诊断。未知路径与未通过认证的代理请求返回空 404。无效访问码和格式不符的会话请求在派生密钥前拒绝。KWS 出站只使用从有效 DC 推导的官方 HTTPS Upgrade 目标。模拟中故障始终以流关闭或会话重建收敛。由于 bootstrap 和 lane 票据可在有效期内被持有者重放，账户级滥用防护依赖保管和轮换凭证。浏览器正常关闭时逐条关闭其 WebSocket，局部 DELETE 只作用于当前 Worker 实例。Durable Object 只用于保存自动生成的后台密钥。

Windows Desktop、iPhone、Android 发行版，公网 Cloudflare 至 Telegram KWS，Pages 在线部署和中国大陆实际网络均尚未实测。iPhone 后台挂起及 Share Extension 的行为也需独立验证。通过 [中文部署步骤](../README.md#第一次部署) 在自己的域名上检查这些项目。

## 主要变更位置

- [凭证验证](../telegram_webproxy.js#L118)、[限制请求读取](../telegram_webproxy.js#L171)、[会话/续签路由](../telegram_webproxy.js#L298)、[升级和局部重复 sid 校验](../telegram_webproxy.js#L381)。
- [CTR 跨分片处理](../telegram_webproxy.js#L422)、[大包组装](../telegram_webproxy.js#L517)、[KWS 回退和取消](../telegram_webproxy.js#L649)。
- [内存预算](../telegram_webproxy.js#L234)、[上行泵](../telegram_webproxy.js#L982)、[下行泵](../telegram_webproxy.js#L1054)、[WebSocket 写入记账](../telegram_webproxy.js#L1143)、[统一关闭](../telegram_webproxy.js#L1157)。
- [原生及回环 Bridge](../telegram_webproxy.js#L1191)、[私人配置页](../telegram_webproxy.js#L1569)。
