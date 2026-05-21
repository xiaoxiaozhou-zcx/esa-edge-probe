# Cloudflare Colo 识别工具

这是一个可直接上传到阿里云 ESA Pages 的静态页面 + 边缘函数项目，用来从 ESA 边缘函数访问 Cloudflare IP 或 Cloudflare 代理域名，并判断请求命中的 Cloudflare 机房。

## 原理

真实 `ping` 和 `traceroute` 需要 ICMP、TTL 控制或系统命令，ESA Pages/函数这种边缘 JavaScript 运行时不开放这些能力。

本项目改用 HTTP 方式判断：

- **CF IP 模式**：访问 `http://<CF_IP>/cdn-cgi/trace`，即使 Cloudflare 返回 `403` 或 `error code: 1003`，响应头通常仍然包含 `cf-ray`。`cf-ray` 末尾的三字母代码就是 Cloudflare colo，例如 `...-HKG`、`...-NRT`、`...-SJC`。
- **Trace 域名模式**：访问 `https://<Cloudflare代理域名>/cdn-cgi/trace`，读取响应正文里的 `colo=` 和 `ip=`。其中 `ip=` 是 Cloudflare 看到的 ESA 出口 IP。

## 能做什么

- 批量输入 Cloudflare IPv4；网页会自动按每批 4 个分批请求后合并结果。
- 显示 HTTP 状态、耗时、`cf-ray`、colo 代码、城市/地区。
- 用 Cloudflare 代理域名查看 `/cdn-cgi/trace` 返回的 `colo` 和 ESA 出口 IP。
- 保留 JSON 原始结果，方便复制分析。

## 文件结构

```text
esa-edge-probe/
  esa.jsonc
  package.json
  public/
    index.html
    favicon.svg
  src/
    index.js
```

## 部署

1. 在 ESA 控制台创建 Pages 项目。
2. 上传本目录，或把本目录推到 Git 仓库后接入 Pages。
3. 构建命令留空。
4. 输出目录/静态资源目录使用 `public`。
5. 函数入口使用 `src/index.js`，配置文件 `esa.jsonc` 已经写好。

## 使用建议

- 如果你要比较多个 Cloudflare Anycast IP，使用 **CF IP** 模式。
- 如果你要看 ESA 出口被 Cloudflare 判断到哪个 colo，使用 **Trace 域名** 模式，默认 `www.cloudflare.com` 就可以。
- 结果表示“这次 ESA 函数到 Cloudflare 的 HTTP 请求命中的 Cloudflare colo”，不是传统三层路由追踪。

## 本地语法检查

```bash
npm run check
```

如果本机没有 `npm`，也可以直接部署；项目没有构建依赖。

## 安全默认值

- 后端单次最多探测 4 个目标，网页会自动分批，避免边缘函数子请求过多。
- 默认拒绝内网、回环、链路本地、多播和保留 IPv4 地址，降低 SSRF 风险。
- CF IP 模式只使用 HTTP `GET` 请求。
