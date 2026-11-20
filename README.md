# Telegram WEB 代理

在 Cloudflare 上搭自己的 Telegram WEB 代理。你需要一个已经接入 Cloudflare 的域名，以及支持 **WEB 代理**的 Telegram 客户端。

**Worker 的源码是 `telegram_webproxy.js`。** 复制整个文件即可在 Cloudflare 控制台部署。[打开 JS 文件](./telegram_webproxy.js)

## 控制台粘贴部署

1. 在 Cloudflare 创建 Worker，打开 **编辑代码**，粘贴完整的 `telegram_webproxy.js` 并部署。
2. 在 **设置 → 变量和密钥** 添加小写的 `p`，类型选 **密钥**。值填一个独立、难猜的登录密码，至少 16 个字符。[Cloudflare 密钥设置](https://developers.cloudflare.com/workers/configuration/secrets/)
3. 在 **设置 → 域名和路由 → 添加 → 自定义域名** 绑定域名。访问域名会看到 **Welcome to nginx!**。[Cloudflare 域名设置](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
4. 打开域名后的 `/admin`，输入密码。登录后直接点 **打开 Telegram** 或 **复制链接**。

只设置 `p` 时，Worker 会按域名和密码派生代理密钥。升级时沿用原域名和 `p`，已添加的链接可继续使用。换密码或域名后，从 `/admin` 复制新链接，再添加到 Telegram。使用旧版存储、`PROXY_SEED`、`PORTAL_KEY` 或离线部署版的用户，更新前先核对原来的密钥来源。[历史部署兼容性](./docs/audit.md#密钥来源与回滚)

## 遇到问题

- **打开 `/admin` 提示 404**。检查域名是否绑定到了这个 Worker，以及小写的 `p` 是否按密钥类型保存，长度是否足够。
- **Telegram 找不到 WEB 代理**。检查客户端版本是否支持。可以先在电脑端试。
- **能连但下载慢**。登录后点 **连接诊断** 查看当前 Worker 实例的阶段统计。测速时用同一台电脑和同一条网络下载未缓存的文件。

[测试记录与回滚](./docs/audit.md) · [可选亚太配置](./wrangler.apac.jsonc)

按 [GPL-3.0](./LICENSE) 分发。
