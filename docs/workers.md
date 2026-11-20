# Workers 发布与验收

## 基线与部署方式

远端核对到 `main` 为 `9bae146`，Workers 上轮分支为 `59aeb06`，Pages 发布分支为 `9158d6337b4a495cd29176a476cd7c8e7a505dbc`。本轮从最后一个提交建立 `codex/workers-release-hardening`。它包含已验证的自适应 KWS、快速票据、传输流控和 TCP 实验。 [基线提交](https://github.com/bababoyi6/b/commit/9158d6337b4a495cd29176a476cd7c8e7a505dbc)

Cloudflare Workers 的静态上传界面用于资产。可执行模块使用 Dashboard **编辑代码**，或者由开发工具以 `multipart/form-data` 上传并在 metadata 的 `main_module` 标明入口。Workers ZIP 直接变成可执行模块的路径未验证，发行包将 `Workers.zip` 标记为源码压缩包。发布同时提供相同字节的独立 JS 和 SHA-256。构建测试验证 ZIP 目录、CRC32、SHA-256、独立 JS 与仓库源码一致，从 ZIP 解出的模块在 workerd 执行登录、固定向量、Bridge、WebSocket Upgrade 和父授权到期测试。默认配置的兼容日期为 `2026-11-18`，仅需 `p`，无必需附加服务，使用 Cloudflare 默认执行位置。 [Dashboard](https://developers.cloudflare.com/workers/get-started/dashboard/) · [Static Assets](https://developers.cloudflare.com/workers/static-assets/) · [Module Upload API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/) · [Placement](https://developers.cloudflare.com/workers/configuration/placement/)

## 改动

- **下行保留量。** 当前端 WebSocket 被背压阻塞时，上游密文原本会和转码缓冲一起保留。合包完成即释放原有分块，最后一个加密块的 WebCrypto 输入处理完毕后立即归还密文预算。异步发送中的数组继续由该次发送独占。受控 256 KiB 测试在发送阻塞点的应用记账量由 1,311,104 降为 1,048,704 字节。进程 GC 与平台内存是独立指标。
- **到期和恢复。** 父授权仍为签发时的 12 小时加初始引导窗口，滚动短票据续签继续共享，健康现有 lane 继续运行。绝对到期时 Worker 发送私有 WebSocket 关闭码 4001，Bridge 一次关闭该父会话内所有 lane，并通知客户端重建。普通已建 lane 故障由单 lane 处理。原有 HTTP 重试次数和退避保留。恢复过程不重发已进入原流的业务数据。
- **廉价拒绝。** Session 请求先检查声明长度和创建请求的 Content-Type，明确声明为非 WebSocket 13 的 Upgrade 在解码凭证前结束。冷 host 回归确认这些请求返回空 404 且未调用密钥派生。未配置账号数据库。登录和诊断仍使用现有同源校验、短会话、域名绑定及认证。KWS 只向验证后的 DC 对应 Telegram 主机发起 HTTPS Upgrade，拒绝重定向及错误子协议。
- **实验 TCP。** 从 64 KiB BYOB 开始，只有实际填满才提升读取容量，最多 512 KiB，短读会降低容量。读取始终受对端信用和应用预算控制，仍使用固定官方 DC IPv4 与 443。媒体 DC 没有放入 TCP 实验，正式引擎继续是 KWS。

## 安全边界

密码至少 16 字符。PBKDF2 16,000 次、HKDF、HMAC、Cookie 和域名绑定沿用现有实现。登录限流为每个 isolate、每分钟按域名与客户端 IP 尝试 8 次，isolate 总计 120 次。验证签名、时效及会话配额后才创建 lane，实际 KWS 拨号还需要有效的 MTProto 头。撤销记录和复用检测限于当前 isolate，票据签名跨实例验证。格式合法的 Bridge capability 在冷实例仍可能引发密钥派生。公开请求在到达 Worker 后计入账户额度，可选的 Free 区域 WAF 规则可以仅覆盖 `POST /admin`。 [Cloudflare WAF](https://developers.cloudflare.com/waf/)

应用不将请求头、密码、代理密钥或原始协议数据写日志。Bridge capability 位于请求 URL。平台的 invocation logs 或 tail 可能包含 URL，默认 Wrangler 配置关闭应用观测日志。内建诊断只向已认证管理页提供实例级合计。TLS 由 Cloudflare 终止，域名、连接时序、大小等元数据有独立的可见边界。现有 HTTPS/WSS 和标准协议行为继续生效。 [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)

## Free 用量模型

截至 2026-11-20，官方说明 Workers Free 每账户每日 100,000 个入站请求，HTTP CPU 上限 10 ms，内存上限每 isolate 128 MB，子请求上限每调用 50，等响应头阶段同时出站上限每调用 6。入站 WebSocket Upgrade 算一次请求，后续消息不另算请求。网络等待不等同于 CPU 时间，处理帧仍使用 CPU。KWS 拨号是出站子请求，单 lane 最多两个同时等待。Cloudflare 运行时升级会终止旧进程中剩余连接。 [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/) · [Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)

下面是用源码计数关系推导的每日示例。总入站请求等于 Bridge GET、Upgrade、Session 创建、续签、DELETE 和管理等流量之和。快速票据通常将创建请求省掉。媒体长度增加主要影响处理字节、AES、下发和拥塞积压。正常完成的 lane 通常一次出站，在每条都需备用时为两次。没发有效流头的 lane 可以是零次出站。

| 示例 | Bridge | Upgrade | 创建 | 续签 | DELETE | 入站合计 | KWS 拨号估计 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 单人低频聊天 | 2 | 8 | 0 | 2 | 2 | 14 | 8–16 |
| 单人正常使用 | 4 | 32 | 1 | 8 | 3 | 48 | 32–64 |
| 单人长时间媒体下载 | 2 | 12 | 0 | 4 | 2 | 20 | 12–24 |
| 五人同时正常使用 | 20 | 160 | 5 | 40 | 15 | 240 | 160–320 |
| 异常重连示例 | 60 | 240 | 10 | 12 | 20 | 342 | 240–480 |

示例不含公网请求与手动诊断。一次浏览器时延测量额外请求五次 HEAD。应用计账最多 32 MiB/lane、36 MiB/会话、40 MiB/isolate，最多 128 条本地活动 lane。应用计账覆盖已知缓冲，真实 isolate 还包含 JS、平台网络缓冲等。常态请求数与账户免费额度相距较大，应用配额和测试结果不足以给持续流量的真实边缘 CPU 或内存作上限担保。

## 地域与复用取舍

默认就近放置由 Cloudflare 决定。Worker 执行地、客户端到 Cloudflare 的入口及 Cloudflare 到 Telegram 的出站是三段路径，代码运行在客户端完成连接之后。上轮对 `cloudflare.182682.xyz` 的本地配对测量与 DNS 边界见历史记录，未将第三方解析结果用于正式上游。继续采用 bounded KWS 冷却与 900 ms 备用竞速，现场样本缺少同时可比较的自然故障，支持修改固定时序的证据不足。Telegram 单 WebSocket 复用要求同一父会话仅一个载体，无共享绑定时不同 isolate 无法原子判断占用。现有 lanes 可以将故障和背压限制在各流。 [入口历史对照](./pages.md#dns入口与地域) · [Telegram 载体协议](https://github.com/telegramdesktop/tproxy-server/blob/master/PROTOCOL.md#carrier-modes)

## 本地性能对照

对照使用 Windows、Node 24.16，固定基线 `9158d63`。启动场景每版 40 次，传输每版每场景 7 次，计入完整校验后的数据。首字节路径上主要成本是客户端入口往返、升级和上游 KWS，健康本机路径继续使用快速票据，0 次 Session POST、1 次拨号。下行主要成本是上游读、两次串流 AES-CTR、组帧和前端排队。传输表中的吞吐为中位数，括号是最小值到最大值。公开端到端实测见下一节。

| 本地模拟 | 基线 P50 / P95 | 候选 P50 / P95 |
| --- | ---: | ---: |
| 冷启动首个转发字节 | 6.943 / 7.928 ms | 6.996 / 7.891 ms |
| 热启动首个转发字节 | 2.181 / 2.489 ms | 2.241 / 2.707 ms |
| 主 KWS 立即失败后恢复 | 6.772 / 7.752 ms | 6.895 / 7.622 ms |

| 本地传输模拟 | 基线 MiB/s | 候选 MiB/s | 轮内 P95 记时中位数 |
| --- | ---: | ---: | ---: |
| KWS 交互小包 | 1.403（1.279–1.523） | 1.399（1.326–1.538） | 0.120 → 0.110 ms |
| KWS 交互与媒体 | 379.7（270.4–397.0） | 354.7（302.0–409.9） | 1.632 → 1.872 ms |
| KWS 16 MiB 持续下载 | 773.3（673.4–798.4） | 716.1（653.8–786.1） | 约 2.20 → 2.32 ms |
| KWS 16 MiB 持续下载复测 | 824.2（470.3–895.6） | 836.1（749.1–874.8） | 1.776 → 1.700 ms |
| KWS 1 MiB 分块持续下载 | 1215.0（1082.8–1272.3） | 1212.8（1125.7–1254.5） | 约 2.18 → 2.36 ms |
| 实验 TCP 16 MiB 持续下载 | 411.6（336.9–446.4） | 765.9（552.5–826.2） | 约 3.37 → 1.89 ms |

KWS 混合负载复测为 305.1 → 282.9 MiB/s，样本范围重叠。两轮中位数约低 7%，CPU 和吞吐差异需要更多样本。受控下载 KWS 的每 MiB AES 调用 16 次、Worker 下发 8 次，两版相同。实验 TCP 的每 MiB AES 调用由 32 降至 6.25、下发由 16 降至 3.125 次。大读也增加了部分场景进程 `arrayBuffers` 采样峰值，例如 1 MiB 媒体包约从 10.5 到 16.4 MiB。Windows CPU 样本粒度约 15 ms，未测得可分辨的 CPU 减少。应用背压预算下降可复现，真实下载速度和真实边缘峰值内存仍需测量。

复现使用 `npm test`、`npm run test:runtime`、`npm run bench -- --tcp --tcp-baseline --sizes --against=9158d6337b4a495cd29176a476cd7c8e7a505dbc` 和 `npm run bench:startup -- --against=9158d6337b4a495cd29176a476cd7c8e7a505dbc`。发布门禁使用同一基线的快速运行，校验数据、样本成功和上游行为。耗时分布受 runner 影响，报告用途为测量。

## 隔离 Workers 在线验收

2026-11-20 使用两条各自独立的 `workers.dev` 部署，保留默认位置和同一测试配置，仅设 `p`。使用 Wrangler 原样上传独立模块，Dashboard 实见的入口为 **编辑代码** 和 **部署**。测试点按轮次交换两版请求顺序，覆盖 DC 1–5 普通及媒体 KWS，每版 30 次。管理页登录、获取连接链接、Bridge、WebSocket Upgrade 和对随机 nonce 的 Telegram `resPQ` 校验均通过。Telegram 握手未使用账号。所有时序从同次探测起点累积，P95 取最近秩。

| 端到端在线路径 | 基线 P50 / P95 | 候选 P50 / P95 |
| --- | ---: | ---: |
| Bridge | 2.430 / 4.616 秒 | 2.022 / 4.214 秒 |
| WebSocket Upgrade | 2.992 / 5.235 秒 | 2.417 / 5.156 秒 |
| 校验 Telegram `resPQ` | 3.814 / 7.103 秒 | 3.281 / 6.644 秒 |

这是一个入口、一个测试时段的样本。基线和候选完整握手范围分别为 2.091–8.327 秒和 2.249–6.729 秒，无法从该样本把差异归因到代码。两个部署的 Cloudflare 上报启动时间分别为 5 ms 和 4 ms，也不代表请求 CPU。

52 个 Node 测试和 8 个 workerd 测试覆盖固定协议向量、登录、Bridge、包入口、非法请求、流控、lane 隔离、恢复和父授权到期。并发到期会合并为一次 Bridge 通知，本机受控失效路径通过。下列场景仍待验证。

- 中国大陆电信、联通、移动实际入口各自的首连、恢复和下载表现。
- Telegram 桌面客户端长时媒体传输、真实弱网切换、设备休眠以及平台升级造成的连接迁移。合成握手只覆盖 `req_pq_multi` 和 `resPQ`。
- 真实边缘稳态 CPU/内存、长时间并发拥塞和跨 isolate 全局配额。现有应用上限为按实例执行。
- Dashboard 静态 ZIP 直传作为可执行 Module Worker。发行 JS 的实网执行使用原样模块上传，已确认控制台编辑器入口。 [部署步骤](../README.md#部署到-workers)

## 发布资产

`npm run build:workers` 生成 `Workers.zip`、`telegram_webproxy.js` 和 `SHA256SUMS.txt`。发布流程校验部署文件与源码逐字节相同。切换到前一版请使用 Workers **Deployments** 中的回滚，或将前一版的独立 JS 粘贴部署。原 Pages 版本仍可从自己的发布页下载。 [Workers v0.2.0](https://github.com/bababoyi6/b/releases/tag/v0.2.0-workers) · [部署回滚](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
