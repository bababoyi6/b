# 工程验收记录

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
