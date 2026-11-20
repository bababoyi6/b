# Workers v0.3.0 工程验收

## 基线与参考源码

远端 `main`、`codex/worker-relay-optimization` 和 `codex/pages-upstream-routing` 分别为 `9bae146`、`59aeb06` 和 `9158d63`。以最新已发布并通过验证的 `432737c60076db6d20e075e37358b8421d5b9085` 建立独立分支。基线已有密钥派生合并、Bridge 快速票据、独立 WebSocket lanes、官方 KWS 健康状态、失败竞速、TCP BYOB 实验以及可复现 Workers 和 Pages ZIP。 [固定基线](https://github.com/bababoyi6/b/commit/432737c60076db6d20e075e37358b8421d5b9085) · [基线 Release](https://github.com/bababoyi6/b/releases/tag/v0.2.0-workers)

审查的 cfnew `core-only` 提交为 `12dc411f79323b7204ae69281fa42d32ec86a9b2`，发行版为 `v2026.10.17.2`。审查的 cfnew-panel `main` 提交为 `6c828b80f466ae6c0c767becccae822e2fc532df`。实现沿用本项目 GPL 源码并独立编写，没有引入参考项目的源码和依赖。 [cfnew 内核](https://github.com/byJoey/cfnew/tree/12dc411f79323b7204ae69281fa42d32ec86a9b2) · [发行说明](https://github.com/byJoey/cfnew/releases/tag/v2026.10.17.2) · [cfnew-panel 与署名许可](https://github.com/byJoey/cfnew-panel/tree/6c828b80f466ae6c0c767becccae822e2fc532df)

| 参考方向 | 对照结论 |
| --- | --- |
| 精简内核 | cfnew 把订阅、管理和优选处理放到独立面板。本项目 `/admin` 的页面与诊断按路由运行，转发时不构建页面，生产模块亦不加载 TCP 实验。单 Worker 已满足需求。 |
| BYOB 和队列 | cfnew 的 TCP 读使用 BYOB，写端有队列和锁回收。目标已有同类 TCP 机制。正式 KWS 通过 WebSocket 消息交付，不能用 BYOB 接收这些消息。本轮减少正常路径的临时批次数组与合并后引用，并测试异步发送时的所有权。 |
| 故障回退 | cfnew 的 TCP 竞速使用 `Promise.any` 等异步协调。目标的顺序备用、并行备用限额、迟到握手回收和按 DC 冷却已经通过回归。健康 KWS 路径只在主拨号时分配所需的取消控制器。 |
| Free CPU | cfnew 的 `384 KiB / 96 块` 是显式连接中断预算。面板测试验证配置默认值、优先级和开关兼容性，不能用于估算本项目边缘 CPU。目标限制在途缓冲、并发和格式异常，持续媒体传输没有固定累计字节断开线。 |
| 发布校验 | 两项目均将可执行 JS、ZIP 和 SHA-256 放在发行流程中校验。本轮 Workers 标签同时校验包版本和包内容，构建物仍从源码重新生成。Pages 和 Workers 各用自己的部署入口。 |

VLESS、Trojan、XHTTP、任意目的地址、第三方中转、公开凭证后备值及外部面板对本项目的原生 Telegram 客户端和认证边界均不适用。 [cfnew 变量](https://github.com/byJoey/cfnew/blob/12dc411f79323b7204ae69281fa42d32ec86a9b2/docs/variables.md) · [打包校验](https://github.com/byJoey/cfnew/blob/12dc411f79323b7204ae69281fa42d32ec86a9b2/scripts/package-release.py) · [Free CPU 测试](https://github.com/byJoey/cfnew-panel/blob/6c828b80f466ae6c0c767becccae822e2fc532df/src/test/free-cpu.test.mjs)

## 实际代码变更

- 上传批次完成上游发送后，释放已消费的原始帧或合批缓冲，再等客户端 WebSocket 腾出发送上传信用的空间。客户端收到原格式 `CREDIT` 后才获得对应额度。受控的 256 KiB 上传，在信用发送阻塞点少记账 262,408 字节，测试同时用独立 AES-CTR 检查已发给 KWS 的完整包内容。
- 上下行只在多个已到达的分块适合合并时分配打包缓冲，单块直接读取。合并完成后及时释放源分块。保留 KWS 一条 WebSocket 消息承载一个完整 MTProto 传输包的要求，上传信用帧使用一次独立分配。
- 可读 `bufferedAmount` 的运行时，在发送队列停止下降时把空闲记账检查从 30 ms 回退到最多 250 ms。有进展时恢复 30 ms，新发送仍立即核对。首秒无进展的受控测试从每侧 33 次轮询减到 6 次。队列清空或 lane 关闭时停止检查。实际发送等待和超时预算独立于这项检查。
- KWS 延迟创建备用拨号的取消控制器。健康 lane 保持一次拨号。主 KWS 立即失败继续尝试备用，超时、取消和迟到成功的连接继续释放。12 小时父授权与续签、到期一次通知、普通故障只关闭相应 lane 的策略保留。
- 新代理连接必须有有效的 `p` 配置。旧访问码路径已统一到密码登录的 `/admin`，历史种子可以与有效 `p` 同时使用以保留链接。只有 `PORTAL_PASSWORD`、种子或绑定时，现有 capability 和签发过的票据均不能启动新代理连接。`p` 配置也在 Session 创建、续签与撤销时检查。

## 部署与入口

与上一发布版相同，正式模块使用单 Worker、默认 Cloudflare 执行位置、域名下的 `/admin` 以及至少 16 字符的单个 `p` Secret。Workers 的 Dashboard 编辑器可部署独立 JS，上一版已在隔离 Worker 通过编辑和部署验证。本轮从构建物对可执行模块做运行时测试。`Workers.zip` 是带同一 JS 的源码归档，未验证为 Dashboard 可执行 ZIP。Pages Direct Upload 的同名上传方式有独立约定。 [部署步骤](../README.md#部署到-workers) · [Workers 模块上传](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/) · [Workers 静态资产](https://developers.cloudflare.com/workers/static-assets/) · [Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)

入口是客户端 TLS 连接抵达的 Cloudflare 位置，执行地是运行 Worker 的位置，出站路径由 Cloudflare 到 Telegram 的连接决定。`/cdn-cgi/trace` 仅描述观察到的单次请求。Telegram Desktop 原生 WEB Proxy 将代理主机交给 WebView，按 HTTPS origin 构建 Bridge URL，随后由 Bridge 对同源 `wss:` 建连。审查的原生客户端代码和参考协议没有分别配置拨号 IP 与 TLS 主机的参数。cfnew-panel 的指定 IP 测试和 sing-box 的订阅字段依赖各自控制的网络客户端。Cloudflare 支持执行位置 hint，文档面向固定后端，现有证据不足以为 Telegram KWS 发布经验证的亚太放置方案。 [Telegram Desktop WebView](https://github.com/telegramdesktop/tdesktop/blob/c2d0ad92432f6cde7504e8571ac2fcac9bbc42c7/Telegram/SourceFiles/mtproto/web_proxy/web_proxy_webview.cpp) · [Telegram 参考协议](https://github.com/telegramdesktop/tproxy-server/blob/master/PROTOCOL.md) · [cfnew-panel 优选实现](https://github.com/byJoey/cfnew-panel/blob/6c828b80f466ae6c0c767becccae822e2fc532df/src/preferred.mjs) · [Cloudflare Placement](https://developers.cloudflare.com/workers/configuration/placement/)

## 安全与资源预算

密码派生、Cookie、域名绑定、票据格式、过期验证及同源规则沿用基线。缺少有效 `p` 时拒绝提供代理服务。认证、会话配额和合法 MTProto 流头同时满足后才能使用固定 `*.web.telegram.org` KWS 目标，拒绝重定向与错误子协议。TCP 实验仅有官方普通 DC 目标，不含通用 TCP 转发。重放记录和配额按 isolate 执行。应用日志不记录密码、原始协议数据与密钥，平台调用日志可能记录包含 Bridge capability 的请求 URL。 [基线安全审计](./workers.md#安全边界) · [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)

Cloudflare Workers Free 当前每账号每日 100,000 个入站请求，每次 HTTP 调用 10 ms CPU，每 isolate 128 MB 内存，每调用允许 50 个出站子请求和 6 个同时等待出站响应头的连接。普通 Worker 的 WebSocket 初次 Upgrade 计入请求，后续消息不逐条计数。应用上限为 32 MiB/lane、36 MiB/父会话、40 MiB/isolate，单 lane 最多两次 KWS 尝试。上一版的每日入站示例仍适用，低频单人 14 次、正常单人 48 次、五人正常 240 次。运行时例行更新给予旧进程最多 20 分钟收尾，剩余连接之后会断开。应用预算与运行时实际 CPU、堆和原生队列独立。 [Free 用量示例](./workers.md#free-用量模型) · [Cloudflare 上限](https://developers.cloudflare.com/workers/platform/limits/) · [计费](https://developers.cloudflare.com/workers/platform/pricing/)

## 本机性能对照

使用 Windows、Node 24.16 和固定基线 `432737c`。两版交替运行。首连每版、每场景 40 次，传输两轮，每轮每版、每场景 7 次。下表首连时间以开启 Bridge 请求为零点，模块导入单列。配置和 capability 认证包含在 Bridge 页面阶段。单独的同域并发测试中，八个 Bridge 请求两版各只做一次 PBKDF2 和两次 HKDF。真实 MTProto 响应使用在线探测验证。

| 本地首连阶段 | 基线 P50 / P95 ms | 候选 P50 / P95 ms |
| --- | ---: | ---: |
| 冷模块导入 | 3.855 / 5.890 | 4.259 / 6.531 |
| 冷 Bridge 页面 | 3.416 / 4.094 | 3.472 / 3.953 |
| 冷 Bridge 脚本启动 | 4.184 / 4.908 | 4.253 / 4.729 |
| 冷 Session Ready | 4.296 / 5.017 | 4.368 / 4.843 |
| 冷 WebSocket Upgrade | 5.125 / 5.924 | 5.196 / 5.637 |
| 冷合法 MTProto 头通过，开始 KWS | 6.074 / 6.901 | 6.167 / 6.590 |
| 冷 KWS 已连接 | 6.076 / 6.904 | 6.169 / 6.593 |
| 冷向上游发送加密头 | 6.435 / 7.293 | 6.535 / 6.965 |
| 冷模拟上游响应第一批字节 | 6.476 / 7.337 | 6.591 / 7.037 |
| 冷模拟响应首批转发 | 6.915 / 7.788 | 7.042 / 7.497 |
| 热模拟响应首批转发 | 2.235 / 3.280 | 2.290 / 3.430 |
| 主 KWS 立即失败，备用首批转发 | 7.092 / 8.853 | 7.012 / 7.696 |

单连接场景均 40/40 成功。健康场景每次一次拨号和零次 Session POST，主 KWS 立即失败场景每次两次拨号。冷模块导入增加约 0.4 ms，冷热首批转发的差异约为 0.3 ms 以内。故障场景是受控模拟，正常网络的 KWS 建连时间另由上游路径决定。

| KWS 本地负载 | 首轮吞吐中位数，基线 → 候选 | 复测吞吐中位数，基线 → 候选 | 首轮批次 P95，基线 → 候选 |
| --- | ---: | ---: | ---: |
| 交互小包 | 1.407 → 1.372 MiB/s | 1.301 → 1.248 MiB/s | 0.126 → 0.126 ms |
| 并发交互和媒体 | 392.9 → 371.4 MiB/s | 284.8 → 303.6 MiB/s | 1.486 → 1.528 ms |
| 连续大块双向 | 1078.9 → 1103.0 MiB/s | 783.9 → 1201.8 MiB/s | 2.872 → 2.815 ms |
| 持续下载，128 KiB 分块 | 749.0 → 630.5 MiB/s | 819.0 → 858.9 MiB/s | 2.280 → 2.521 ms |
| 持续上传，512 KiB 分块 | 1421.3 → 1401.5 MiB/s | 1677.5 → 1670.3 MiB/s | 2.121 → 2.138 ms |
| 1 MiB 分块下载 | 1151.1 → 1164.1 MiB/s | 1240.2 → 1264.2 MiB/s | 2.348 → 2.337 ms |
| 1 MiB 分块上传 | 739.5 → 760.3 MiB/s | 931.5 → 925.5 MiB/s | 3.566 → 3.418 ms |
| 慢客户端持续下载 | 7.961 → 7.950 MiB/s | 7.952 → 7.952 MiB/s | 125.534 → 125.725 ms |

持续下载首轮范围为基线 `492.6–783.9` 和候选 `430.1–763.4 MiB/s`，复测为 `470.1–915.9` 和 `747.7–941.2 MiB/s`。混合负载两轮方向亦不同。慢客户端两版的应用缓冲采样峰值均为 `3.378 MiB`，上文的上传信用堵塞点则有确定的内存记账收益。常态 128 KiB 下载每 MiB 为 16 次 AES 与 8 次 Worker 下发，两版相同。实验 TCP 对同样负载为 6.25 次 AES 与 3.125 次下发，两版也相同。Windows 进程 CPU 样本多数为 0 或约 15–16 ms，GC 会左右 ArrayBuffer 采样。没有把这些读数作为真实边缘 CPU 或峰值内存下降的证据。

### 参数实验

各实验用三轮本机测量筛选。正式版使用 `DOWN_FRAME=64 KiB`、`CRYPT_CHUNK=512 KiB` 与 `SOCKET_BUFFER=2 MiB`。

| 单变量实验 | 观察到的取舍 |
| --- | --- |
| `DOWN_FRAME` 升到 128 KiB | 慢客户端的 Worker 下发从 100 次降到 64 次。1 MiB 下载的 P95 从 2.648 增到 3.473 ms，普通交互小包 P95 从 0.132 增到 0.165 ms。 |
| `CRYPT_CHUNK` 升到 1 MiB | 1 MiB 下载 AES 从 256 减到 128 次，应用记账峰值从 4.001 增到 6.001 MiB，吞吐中位数从 920.3 降到 737.9 MiB/s。1 MiB 上传中位数从 834.2 增到 976.3 MiB/s。后续可分离上传阈值单独测量。 |
| `SOCKET_BUFFER` 降到 1 MiB | 慢客户端的记账峰值从 3.378 减到 2.378 MiB，持续下载中位数从 650.7 降到 423.9 MiB/s，样本范围较宽。 |

运行 `node --expose-gc benchmarks/transport.mjs --sizes --tcp --tcp-baseline --against=432737c` 可复现完整性能对照。实验脚本接受 `--candidate=PATH` 指向只改变一个参数的独立 JS。加 `--verify` 时对不同内容的每包数据使用独立 AES-CTR 解密与 SHA-256 校验，适合验证完整性，这一模式的吞吐包含校验开销。首连使用 `node benchmarks/startup.mjs --against=432737c`。 [传输与完整性基准](../benchmarks/transport.mjs) · [首连基准](../benchmarks/startup.mjs)

## 运行时和在线验证

本地 55 个 Node 测试及 8 个 workerd 测试覆盖 `p` 的长度阈值、固定密码派生向量、无效环境配置、Portal 登录、Bridge、Session、Upgrade、跨 lane 隔离、回退、AES-CTR、流控和会话到期。无有效 `p` 时，已签发的 capability、会话和续签票据均返回空 `404`。完整性基准对 13 种负载分别执行基线与候选的 KWS 和实验 TCP，所有下发和上传明文摘要一致，KWS 帧边界通过检查。

用两个隔离 `workers.dev` 部署分别从已发布提交和候选构建提取独立 JS。候选从 ZIP 对应的同一份 JS 原样部署。两版仅注入测试 `p`，在线校验 `/admin` 登录与链接、Bridge、WebSocket 和真实 Telegram `resPQ` 的 nonce。探测不使用 Telegram 账号，按轮次交替调用两版，对 DC 1–5 分别测量普通和媒体 KWS。出站仍来自官方 KWS。

首次在线对照采用交替串行请求，两版各 `30/30` 成功。两测试域名的单次 `/cdn-cgi/trace` 均为 `AMS`。这个机房代码记录的是 HTTPS trace 请求的入口，不用于推断 Telegram 出站或各个 WebSocket 的路径。

| 串行在线阶段 | 基线 P50 / P95 秒 | 候选 P50 / P95 秒 |
| --- | ---: | ---: |
| 收到 Bridge | 2.733 / 3.941 | 2.736 / 5.238 |
| WebSocket Upgrade | 3.124 / 5.111 | 3.345 / 5.607 |
| 首次校验通过的 `resPQ` | 4.195 / 6.030 | 4.466 / 6.791 |

复测使用 `--paired`，在相同 DC 与同一类型的每个样本同时向基线和候选各发一次请求，下一组在两次请求都结束后开始。两版各成功 `29/30`。基线有一次 DC 1 普通入口的 Bridge 请求 `fetch failed`，候选有一次 DC 2 媒体入口的 Bridge 请求 `fetch failed`。下表使用成功样本的最近秩分位数。

| 配对在线阶段 | 基线 P50 / P95 秒 | 候选 P50 / P95 秒 |
| --- | ---: | ---: |
| 收到 Bridge | 2.172 / 4.942 | 2.428 / 4.174 |
| WebSocket Upgrade | 2.543 / 5.288 | 2.794 / 4.484 |
| 首次校验通过的 `resPQ` | 3.647 / 6.702 | 3.789 / 5.452 |
| Upgrade 后到 `resPQ` | 0.945 / 1.714 | 0.928 / 1.634 |

两轮端到端 P95 的变化方向相反，且 Bridge 阶段已出现秒级波动。成功率相同，完整配对里候选更快的次数分别是 `14/30` 和 `13/28`。该证据不足以判定实际首连稳定提速或持续回退。 [在线探测](../experiments/probe-pages.mjs)

## 发行产物

`npm run build:workers` 生成 `Workers.zip`、`telegram_webproxy.js` 和 `SHA256SUMS.txt`。Workers 发布任务核对标签与 `package.json`，运行 Node、workerd 和明文完整性测试，再校验 ZIP 和独立模块的 SHA-256。独立模块为 84,978 字节，上一版为 84,834 字节。 [GitHub 发行资产](https://github.com/bababoyi6/b/releases/tag/v0.3.0-workers) · [发行流水线](../.github/workflows/workers-release.yml)

## 仍待验证的场景

- 电信、联通、移动各自的实网路径、首连与真实下载。隔离 Worker 对照来自单一入口。
- Telegram 账号登录后的长时间媒体上传下载、设备休眠唤醒、Wi-Fi 与移动网络切换，以及 Cloudflare 滚动更新后的客户端恢复。
- 真实边缘稳态 CPU、原生队列内存和跨 isolate 资源竞争。下一轮可先独立评估上传的 1 MiB 加密阈值，在高并发下复核收益和记账峰值。
- 直连 TCP 的账号媒体传输、媒体 DC 地址和真实边缘可用性。该引擎继续单独实验。
- 以 Dashboard 静态上传执行 Workers ZIP。正式发布继续使用同一份核验过的 Module JS。
