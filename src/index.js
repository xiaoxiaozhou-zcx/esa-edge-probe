const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type"
};

const MAX_TARGETS = 12;

const COLO_MAP = {
  AMS: ["Amsterdam", "Netherlands", "Europe"],
  ARN: ["Stockholm", "Sweden", "Europe"],
  ATL: ["Atlanta", "United States", "North America"],
  BKK: ["Bangkok", "Thailand", "Asia"],
  BLR: ["Bangalore", "India", "Asia"],
  BOM: ["Mumbai", "India", "Asia"],
  BOS: ["Boston", "United States", "North America"],
  BRU: ["Brussels", "Belgium", "Europe"],
  CDG: ["Paris", "France", "Europe"],
  CGK: ["Jakarta", "Indonesia", "Asia"],
  CPH: ["Copenhagen", "Denmark", "Europe"],
  DFW: ["Dallas", "United States", "North America"],
  DEL: ["New Delhi", "India", "Asia"],
  DEN: ["Denver", "United States", "North America"],
  DET: ["Detroit", "United States", "North America"],
  DUB: ["Dublin", "Ireland", "Europe"],
  EWR: ["Newark", "United States", "North America"],
  FRA: ["Frankfurt", "Germany", "Europe"],
  FUK: ["Fukuoka", "Japan", "Asia"],
  GIG: ["Rio de Janeiro", "Brazil", "South America"],
  GRU: ["Sao Paulo", "Brazil", "South America"],
  HKG: ["Hong Kong", "Hong Kong", "Asia"],
  HNL: ["Honolulu", "United States", "North America"],
  HYD: ["Hyderabad", "India", "Asia"],
  IAD: ["Ashburn", "United States", "North America"],
  ICN: ["Seoul", "South Korea", "Asia"],
  IST: ["Istanbul", "Turkey", "Europe"],
  JNB: ["Johannesburg", "South Africa", "Africa"],
  KIX: ["Osaka", "Japan", "Asia"],
  KUL: ["Kuala Lumpur", "Malaysia", "Asia"],
  LAX: ["Los Angeles", "United States", "North America"],
  LHR: ["London", "United Kingdom", "Europe"],
  MAD: ["Madrid", "Spain", "Europe"],
  MAA: ["Chennai", "India", "Asia"],
  MAN: ["Manchester", "United Kingdom", "Europe"],
  MIA: ["Miami", "United States", "North America"],
  MNL: ["Manila", "Philippines", "Asia"],
  MRS: ["Marseille", "France", "Europe"],
  NRT: ["Tokyo", "Japan", "Asia"],
  ORD: ["Chicago", "United States", "North America"],
  PER: ["Perth", "Australia", "Oceania"],
  PHL: ["Philadelphia", "United States", "North America"],
  PHX: ["Phoenix", "United States", "North America"],
  PRG: ["Prague", "Czechia", "Europe"],
  SCL: ["Santiago", "Chile", "South America"],
  SEA: ["Seattle", "United States", "North America"],
  SIN: ["Singapore", "Singapore", "Asia"],
  SJC: ["San Jose", "United States", "North America"],
  SYD: ["Sydney", "Australia", "Oceania"],
  TPE: ["Taipei", "Taiwan", "Asia"],
  VIE: ["Vienna", "Austria", "Europe"],
  YVR: ["Vancouver", "Canada", "North America"],
  YYZ: ["Toronto", "Canada", "North America"],
  ZRH: ["Zurich", "Switzerland", "Europe"]
};

export default {
  async fetch(request) {
    const requestUrl = new URL(request.url);

    if (requestUrl.pathname !== "/api/probe" && requestUrl.pathname !== "/api/cf-colo") {
      return json({ error: "Not found" }, 404);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "请求体必须是 JSON" }, 400);
    }

    const mode = String(payload.mode || "cf-hosts");

    if (mode === "cf-hosts" || mode === "cf-ip") {
      return handleCloudflareHostProbe(payload);
    }

    if (mode === "trace-host") {
      return handleTraceHostProbe(payload);
    }

    if (mode === "trace") {
      return json({
        error: "ESA Pages/函数运行时不支持真实 traceroute",
        detail: "traceroute 需要 ICMP/UDP/TCP TTL 控制或系统命令。这里改用 Cloudflare HTTP 响应里的 cf-ray/colo 判断命中的 Cloudflare 机房。"
      }, 422);
    }

    return json({ error: "未知探测模式" }, 400);
  }
};

async function handleCloudflareHostProbe(payload) {
  const parsedTargets = normalizeHostTargets(payload.targets || payload.target || "");
  if (!parsedTargets.ok) {
    return json({ error: parsedTargets.error }, 400);
  }

  const timeoutMs = clampInteger(payload.timeoutMs, 500, 8000, 3000);
  const protocol = String(payload.protocol || "http").toLowerCase();
  if (protocol !== "http" && protocol !== "https") {
    return json({ error: "协议只能是 http 或 https" }, 400);
  }

  const path = normalizePath(payload.path || "/cdn-cgi/trace");
  if (!path.ok) {
    return json({ error: path.error }, 400);
  }

  const results = [];
  for (const target of parsedTargets.value) {
    results.push(await probeCloudflareHost(target.host, protocol, path.value, timeoutMs, target.label, target.inputType));
  }

  return json({
    type: "cloudflare-colo-by-host",
    transport: protocol,
    path: path.value,
    timeoutMs,
    count: results.length,
    summary: summarizeResults(results),
    results,
    note: "如果输入的是 IP，程序会自动转换为 nip.io 通配解析域名再访问，例如 104.16.124.96 -> 104-16-124-96.nip.io。Cloudflare 返回 403/error 1003 也可以，只要响应头里有 cf-ray。"
  });
}

async function handleTraceHostProbe(payload) {
  const parsedHost = normalizeHost(payload.host || payload.target || "www.cloudflare.com");
  if (!parsedHost.ok) {
    return json({ error: parsedHost.error }, 400);
  }

  const protocol = String(payload.protocol || "https").toLowerCase();
  if (protocol !== "https" && protocol !== "http") {
    return json({ error: "协议只能是 http 或 https" }, 400);
  }

  const timeoutMs = clampInteger(payload.timeoutMs, 500, 8000, 3000);
  const result = await probeTraceHost(parsedHost.value, protocol, timeoutMs);

  return json({
    type: "cloudflare-trace-host",
    host: parsedHost.value,
    url: result.url,
    timeoutMs,
    summary: summarizeResults([result]),
    results: [result],
    trace: result.trace,
    note: "Cloudflare 代理域名的 /cdn-cgi/trace 通常会返回 colo 和 ip，其中 ip 是 Cloudflare 看到的 ESA 出口地址。"
  });
}

async function probeCloudflareHost(host, protocol, path, timeoutMs, label = host, inputType = "domain") {
  const targetUrl = new URL(`${protocol}://${host}${path}`);
  targetUrl.searchParams.set("_esa_cf_probe", `${Date.now()}`);

  return runProbe({
    label,
    url: targetUrl.toString(),
    timeoutMs,
    evidenceHint: "cf-ray header",
    requestHost: host,
    inputType
  });
}

async function probeTraceHost(host, protocol, timeoutMs) {
  const targetUrl = new URL(`${protocol}://${host}/cdn-cgi/trace`);
  targetUrl.searchParams.set("_esa_cf_probe", `${Date.now()}`);

  return runProbe({
    label: host,
    url: targetUrl.toString(),
    timeoutMs,
    evidenceHint: "trace body"
  });
}

async function runProbe({ label, url, timeoutMs, evidenceHint, requestHost = "", inputType = "domain" }) {
  const startedAt = Date.now();

  try {
    const response = await fetchWithTimeout(url, {
      method: "GET",
      redirect: "manual",
      headers: {
        "accept": "text/plain,*/*",
        "cache-control": "no-cache",
        "pragma": "no-cache",
        "x-esa-edge-probe": "1"
      }
    }, timeoutMs);

    const text = await readSmallText(response, 4096);
    const trace = parseTraceBody(text);
    const cfRay = response.headers.get("cf-ray") || "";
    const colo = normalizeColo(trace.colo || parseCfRayColo(cfRay));
    const coloInfo = lookupColo(colo);
    const server = response.headers.get("server") || "";

    return {
      target: label,
      requestHost,
      targetType: inputType,
      url,
      reachable: true,
      cloudflare: isCloudflareResponse({ cfRay, server, text, trace }),
      status: response.status,
      statusText: response.statusText || "",
      elapsedMs: Date.now() - startedAt,
      server,
      cfRay,
      colo,
      coloName: coloInfo.name,
      coloCountry: coloInfo.country,
      coloRegion: coloInfo.region,
      sourceIpSeenByCloudflare: trace.ip || "",
      evidence: trace.colo ? "trace body colo" : (cfRay ? evidenceHint : "not found"),
      trace,
      bodyPreview: text.slice(0, 240)
    };
  } catch (error) {
    return {
      target: label,
      requestHost,
      targetType: inputType,
      url,
      reachable: false,
      cloudflare: false,
      elapsedMs: Date.now() - startedAt,
      error: normalizeError(error, timeoutMs)
    };
  }
}

async function fetchWithTimeout(url, init, timeoutMs) {
  if (typeof AbortController !== "function") {
    return fetch(url, init);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readSmallText(response, maxLength) {
  const text = await response.text();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function normalizeHostTargets(input) {
  const targets = Array.isArray(input)
    ? input
    : String(input).split(/[\s,;，；]+/);

  const cleanTargets = [...new Set(targets.map((item) => String(item).trim()).filter(Boolean))];

  if (!cleanTargets.length) {
    return { ok: false, error: "请输入至少一个域名" };
  }

  if (cleanTargets.length > MAX_TARGETS) {
    return { ok: false, error: `一次最多探测 ${MAX_TARGETS} 个域名，可分批执行` };
  }

  const normalized = [];
  for (const item of cleanTargets) {
    const host = extractHost(item);
    const ipv4 = parseIPv4(host);
    if (ipv4) {
      if (isBlockedIPv4(ipv4)) {
        return { ok: false, error: `禁止探测内网、回环、链路本地、多播和保留 IPv4：${host}` };
      }

      normalized.push({
        label: host,
        host: wildcardHostForIPv4(host),
        inputType: "ip-via-sslip"
      });
      continue;
    }

    if (!isValidDomain(host)) {
      return { ok: false, error: `目标不是合法域名：${item}` };
    }

    normalized.push({
      label: host,
      host,
      inputType: "domain"
    });
  }

  return { ok: true, value: normalized };
}

function extractHost(input) {
  const raw = String(input || "").trim();
  if (/^https?:\/\//i.test(raw)) {
    try {
      return new URL(raw).hostname.toLowerCase();
    } catch {
      return raw.toLowerCase();
    }
  }

  return raw.replace(/^\[|\]$/g, "").toLowerCase();
}

function wildcardHostForIPv4(ip) {
  return `${ip.replaceAll(".", "-")}.nip.io`;
}

function normalizeHost(input) {
  let host = String(input || "").trim();
  if (!host) {
    return { ok: false, error: "请输入 Cloudflare 代理域名" };
  }

  if (/^https?:\/\//i.test(host)) {
    try {
      host = new URL(host).hostname;
    } catch {
      return { ok: false, error: "URL 格式不正确" };
    }
  }

  host = host.replace(/^\[|\]$/g, "").toLowerCase();

  if (!isValidDomain(host)) {
    return { ok: false, error: "请输入合法域名，例如 www.cloudflare.com" };
  }

  return { ok: true, value: host };
}

function normalizePath(input) {
  let path = String(input || "/cdn-cgi/trace").trim();
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }

  if (path.length > 256 || /[\r\n]/.test(path)) {
    return { ok: false, error: "路径过长或包含非法字符" };
  }

  return { ok: true, value: path };
}

function parseTraceBody(text) {
  const trace = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index <= 0) {
      continue;
    }

    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (/^[a-z][a-z0-9_]*$/i.test(key)) {
      trace[key] = value;
    }
  }
  return trace;
}

function parseCfRayColo(cfRay) {
  const match = String(cfRay || "").match(/-([A-Z]{3})(?:$|[^A-Z])/);
  return match ? match[1] : "";
}

function normalizeColo(value) {
  const code = String(value || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : "";
}

function lookupColo(code) {
  const item = COLO_MAP[code];
  if (!item) {
    return {
      name: code ? "Unknown Cloudflare colo" : "",
      country: "",
      region: ""
    };
  }

  return {
    name: item[0],
    country: item[1],
    region: item[2]
  };
}

function isCloudflareResponse({ cfRay, server, text, trace }) {
  return Boolean(
    cfRay ||
    trace.colo ||
    String(server || "").toLowerCase().includes("cloudflare") ||
    /cloudflare|error code:\s*1003/i.test(String(text || ""))
  );
}

function summarizeResults(results) {
  const successful = results.filter((item) => item.reachable);
  const cloudflare = results.filter((item) => item.cloudflare);
  const identified = results.filter((item) => item.colo);
  const latencies = successful.map((item) => item.elapsedMs);
  const colos = [...new Set(identified.map((item) => item.colo))];

  return {
    sent: results.length,
    received: successful.length,
    cloudflare: cloudflare.length,
    identified: identified.length,
    colos,
    lossPercent: percent(results.length - successful.length, results.length),
    minMs: minOrNull(latencies),
    avgMs: averageOrNull(latencies),
    maxMs: maxOrNull(latencies)
  };
}

function normalizeError(error, timeoutMs) {
  if (error && error.name === "AbortError") {
    return `请求超时，超过 ${timeoutMs}ms`;
  }

  return error && error.message ? error.message : String(error);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: JSON_HEADERS
  });
}

function parseIPv4(host) {
  const parts = host.split(".");
  if (parts.length !== 4) {
    return null;
  }

  const bytes = [];
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) {
      return null;
    }

    const byte = Number(part);
    if (byte > 255) {
      return null;
    }
    bytes.push(byte);
  }

  return bytes;
}

function isValidDomain(host) {
  if (host.length > 253 || host.includes("..")) {
    return false;
  }

  const labels = host.split(".");
  if (labels.length < 2) {
    return false;
  }

  return labels.every((label) => (
    label.length >= 1 &&
    label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
  ));
}

function isBlockedIPv4(bytes) {
  const [a, b, c, d] = bytes;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && b === 18) ||
    (a === 198 && b === 19) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224 ||
    (a === 255 && b === 255 && c === 255 && d === 255)
  );
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, number));
}

function percent(part, total) {
  if (!total) {
    return 0;
  }

  return Math.round((part / total) * 10000) / 100;
}

function minOrNull(values) {
  return values.length ? Math.min(...values) : null;
}

function maxOrNull(values) {
  return values.length ? Math.max(...values) : null;
}

function averageOrNull(values) {
  if (!values.length) {
    return null;
  }

  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}
