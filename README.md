# Telegram WEB 代理

在 Cloudflare 上搭自己的 Telegram WEB 代理。你需要一个已经接入 Cloudflare 的域名，以及支持 **WEB 代理**的 Telegram 客户端。

**实际运行的 Worker 文件是 `telegram_webproxy.js`。** [打开 JS 文件](./telegram_webproxy.js)

## 第一次部署

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/bababoyi6/b)

1. 点部署按钮，按提示连上 GitHub。密钥 `p` 填你自己设的密码，至少 16 个字符。Cloudflare 会为 Worker 创建保存后台密钥的空间。
2. 在 Worker 的 **设置 → 域名和路由 → 添加 → 自定义域名** 里绑定域名，例如 `tg.example.com`。[Cloudflare 域名设置](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
3. 访问自己的域名会看到 **Welcome to nginx!**。打开域名后的 `/admin` 并输入密码。Worker 会在首次登录时生成并保存后台密钥。点 **打开 Telegram** 或 **复制链接**，在 Telegram 里确认添加并开启代理。

用命令行部署时，在项目目录运行 `npm ci` 和 `npx wrangler deploy`，然后用 `npx wrangler secret put p` 设置登录密码。[Cloudflare 密钥设置](https://developers.cloudflare.com/workers/configuration/secrets/)

## 遇到问题

- **打开 `/admin` 提示 404**。检查域名是否绑定到了这个 Worker，以及小写的 `p` 是否按密钥类型保存，长度是否足够。
- **登录时报后台存储尚未配置**。用仓库里的 Wrangler 配置部署，确保绑定了保存后台密钥的 Durable Object。
- **Telegram 找不到 WEB 代理**。检查客户端版本是否支持。可以先在电脑端试。
- **能连但下载慢**。登录后点 **连接诊断** 看哪一段花时间。测速度时，用同一台电脑、同一条网络下载未缓存的文件。

[亚太配置（香港、东京、新加坡）](./wrangler.apac.jsonc) · [测试记录](./docs/audit.md)

按 [GPL-3.0](./LICENSE) 分发。
