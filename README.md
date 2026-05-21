# Cloudflare Colo 识别工具

这是一个可直接上传到阿里云 ESA Pages 的静态页面 + 边缘函数项目，用来从 ESA 边缘函数访问 Cloudflare IP、CIDR 段或域名，并判断请求命中的 Cloudflare 机房。

## 原理

ESA 函数运行时不允许 `fetch` 直接访问 IP 地址，例如：

```text
http://104.16.124.96/cdn-cgi/trace
```

会报：

```text
Direct access to IP addresses is not allowed
```

所以本项目在你输入 IP 时，会自动转换为 `sslip.io` 通配解析域名：

```text
104.16.124.96 -> 104-16-124-96.sslip.io
172.67.74.226 -> 172-67-74-226.sslip.io
```

然后函数实际访问：

```text
http://104-16-124-96.sslip.io/cdn-cgi/trace
```

这样 ESA 看到的是域名，DNS 又会把它解析到目标 IP，不需要你手动修改 DNS。

Cloudflare 即使返回 `403` 或 `error code: 1003`，响应头通常仍有 `cf-ray`，可以通过 `cf-ray` 末尾三字母代码判断 Cloudflare colo，例如 `...-HKG`、`...-NRT`、`...-SJC`。

## 输入方式

可以混合输入：

```text
104.16.124.96
104.16.123.0/24
172.67.74.0/23
www.cloudflare.com
```

CIDR 段会按每个 `/24` 取一个样本 IP：

```text
104.16.123.0/24 -> 104.16.123.1
172.67.74.0/23 -> 172.67.74.1, 172.67.75.1
```

如果输入的是 `/25`、`/26`、`/32` 这类小于或等于一个 `/24` 的段，只取一个样本 IP。

为避免浏览器一次发起过多请求，页面默认最多展开 256 个目标。更大的 IP 段请分批测试。

## 模式

- **IP/域名批量**：可以混合输入 IP、CIDR 和域名，网页会自动每 4 个一批请求并合并结果。
- **Trace 域名**：访问 Cloudflare 代理域名的 `/cdn-cgi/trace`，读取正文里的 `colo=` 和 `ip=`。其中 `ip=` 是 Cloudflare 看到的 ESA 出口 IP。

## 部署配置

ESA Pages 构建信息建议填写：

```text
安装命令：npm install
构建命令：npm run build
根目录：/
静态资源目录：public
函数文件路径：src/index.js
Node.js 版本：22.x
```

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

## 安全默认值

- 后端单次最多探测 4 个目标，网页会自动分批，避免边缘函数子请求过多。
- 内网、回环、链路本地、多播和保留 IPv4 会被拦截。
- 默认使用 HTTP `GET`，避免 IP 通配域名因 HTTPS 证书不匹配失败。
