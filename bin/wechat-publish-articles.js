#!/usr/bin/env node

import { readFile, writeFile, chmod } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const API_BASE = "https://api.weixin.qq.com";
const DEFAULT_CACHE_FILE = ".wechat_access_token.json";
const TOKEN_REFRESH_BUFFER_SECONDS = 300;

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const files = {
  skill: join(rootDir, "SKILL.md"),
  reference: join(rootDir, "references", "wechat-official-api.md"),
  package: join(rootDir, "package.json"),
};

const MIME_TYPES = {
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".wav": "audio/wav",
};

class WeChatAPIError extends Error {}

function showHelp() {
  process.stdout.write(`WeChat Official Account publishing helper

Usage:
  wechat-publish-articles [auth options] <command> [command options]
  npx github:LearnAIHubC/wechat-publish-articles <command> [options]

Commands:
  token                         Get or refresh access_token
  upload-inline-image <file>    Upload image for article body HTML and return URL
  upload-material <file>        Upload permanent material and return media_id
  add-draft <payload.json>      Create a WeChat draft from JSON payload
  submit-publish <media_id>     Submit draft media_id for publication
  get-publish <publish_id>      Get publish job status
  skill                         Print SKILL.md for LLM/agent usage
  skill-path                    Print the local SKILL.md path
  reference                     Print the API reference markdown
  reference-path                Print the local API reference path

Auth options:
  --appid <id>                  WeChat AppID. Defaults to WECHAT_APP_ID.
  --secret <secret>             WeChat AppSecret. Defaults to WECHAT_APP_SECRET.
  --access-token <token>        Use an existing token.
  --cache-file <path>           Token cache file. Defaults to .wechat_access_token.json.
  --force-refresh               Ignore cache/token and request a new token.

upload-material options:
  --type <kind>                 image, voice, video, or thumb. Defaults to image.
  --title <title>               Video material title.
  --introduction <text>         Video material introduction.

Examples:
  wechat-publish-articles token
  wechat-publish-articles token --access-token "$ACCESS_TOKEN"
  wechat-publish-articles upload-inline-image ./body.jpg
  wechat-publish-articles upload-material ./cover.jpg --type image
  wechat-publish-articles add-draft ./draft.json
  wechat-publish-articles submit-publish DRAFT_MEDIA_ID
  wechat-publish-articles get-publish PUBLISH_ID
`);
}

function requireValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new WeChatAPIError(`Missing value for ${option}.`);
  }
  return value;
}

function parseArgs(argv) {
  const opts = {
    forceRefresh: false,
    type: "image",
  };
  const positionals = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "-h":
      case "--help":
        opts.help = true;
        break;
      case "--appid":
        opts.appid = requireValue(argv, i, arg);
        i += 1;
        break;
      case "--secret":
        opts.secret = requireValue(argv, i, arg);
        i += 1;
        break;
      case "--access-token":
        opts.accessToken = requireValue(argv, i, arg);
        i += 1;
        break;
      case "--cache-file":
        opts.cacheFile = requireValue(argv, i, arg);
        i += 1;
        break;
      case "--force-refresh":
        opts.forceRefresh = true;
        break;
      case "--type":
        opts.type = requireValue(argv, i, arg);
        i += 1;
        break;
      case "--title":
        opts.title = requireValue(argv, i, arg);
        i += 1;
        break;
      case "--introduction":
        opts.introduction = requireValue(argv, i, arg);
        i += 1;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new WeChatAPIError(`Unknown option: ${arg}`);
        }
        positionals.push(arg);
    }
  }

  return {
    command: positionals[0],
    args: positionals.slice(1),
    opts,
  };
}

function writeJson(data) {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function loadCache(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function saveCache(path, token, expiresIn) {
  const payload = {
    access_token: token,
    expires_at: Math.floor(Date.now() / 1000) + Number(expiresIn),
  };
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(path, 0o600).catch(() => {});
}

async function requestJson(method, url, payload = undefined) {
  const headers = {
    Accept: "application/json",
  };
  const init = {
    method,
    headers,
  };
  if (payload !== undefined) {
    headers["Content-Type"] = "application/json; charset=utf-8";
    init.body = JSON.stringify(payload);
  }

  const response = await fetch(url, init);
  const raw = await response.text();
  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    throw new WeChatAPIError(`Invalid JSON response from WeChat API: HTTP ${response.status}`);
  }

  if (!response.ok) {
    throw new WeChatAPIError(`HTTP ${response.status}: ${result.errmsg || response.statusText}`);
  }

  const errcode = result.errcode;
  if (errcode !== undefined && errcode !== 0) {
    throw new WeChatAPIError(`WeChat API error ${errcode}: ${result.errmsg || ""}`);
  }
  return result;
}

function tokenUrl(appid, secret) {
  const params = new URLSearchParams({
    appid,
    secret,
    grant_type: "client_credential",
  });
  return `${API_BASE}/cgi-bin/token?${params.toString()}`;
}

function urlWithToken(path, accessToken, extra = undefined) {
  const params = new URLSearchParams({
    access_token: accessToken,
    ...(extra || {}),
  });
  return `${API_BASE}${path}?${params.toString()}`;
}

async function getToken(opts) {
  if (opts.accessToken && !opts.forceRefresh) {
    return opts.accessToken;
  }

  const envToken = process.env.WECHAT_ACCESS_TOKEN;
  if (envToken && !opts.forceRefresh) {
    return envToken;
  }

  const cacheFile = opts.cacheFile || process.env.WECHAT_TOKEN_CACHE || DEFAULT_CACHE_FILE;
  if (!opts.forceRefresh) {
    const cached = await loadCache(cacheFile);
    if (cached) {
      const expiresAt = Number(cached.expires_at || 0);
      const now = Math.floor(Date.now() / 1000);
      if (expiresAt - now > TOKEN_REFRESH_BUFFER_SECONDS && cached.access_token) {
        return String(cached.access_token);
      }
    }
  }

  const appid = opts.appid || process.env.WECHAT_APP_ID;
  const secret = opts.secret || process.env.WECHAT_APP_SECRET;
  if (!appid || !secret) {
    throw new WeChatAPIError("Missing credentials. Set WECHAT_APP_ID and WECHAT_APP_SECRET or pass --appid and --secret.");
  }

  const result = await requestJson("GET", tokenUrl(appid, secret));
  const token = String(result.access_token);
  await saveCache(cacheFile, token, Number(result.expires_in || 7200));
  return token;
}

function guessMime(path) {
  return MIME_TYPES[extname(path).toLowerCase()] || "application/octet-stream";
}

async function multipartPost(url, fileField, filePath, fields = undefined) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields || {})) {
    form.append(key, String(value));
  }

  const bytes = await readFile(filePath);
  const blob = new Blob([bytes], {
    type: guessMime(filePath),
  });
  form.append(fileField, blob, basename(filePath));

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
    },
    body: form,
  });
  const raw = await response.text();
  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    throw new WeChatAPIError(`Invalid JSON response from WeChat API: HTTP ${response.status}`);
  }

  if (!response.ok) {
    throw new WeChatAPIError(`HTTP ${response.status}: ${result.errmsg || response.statusText}`);
  }

  const errcode = result.errcode;
  if (errcode !== undefined && errcode !== 0) {
    throw new WeChatAPIError(`WeChat API error ${errcode}: ${result.errmsg || ""}`);
  }
  return result;
}

function normalizeDraftPayload(raw) {
  if (Array.isArray(raw)) {
    return { articles: raw };
  }
  if (raw && typeof raw === "object" && Array.isArray(raw.articles)) {
    return raw;
  }
  throw new WeChatAPIError("Draft JSON must be an object with articles[] or a raw array of article objects.");
}

function requireArg(args, index, label) {
  const value = args[index];
  if (!value) {
    throw new WeChatAPIError(`Missing ${label}.`);
  }
  return value;
}

async function cmdToken(opts) {
  writeJson({ access_token: await getToken(opts) });
}

async function cmdUploadInlineImage(args, opts) {
  const accessToken = await getToken(opts);
  const file = requireArg(args, 0, "file");
  const url = urlWithToken("/cgi-bin/media/uploadimg", accessToken);
  writeJson(await multipartPost(url, "media", file));
}

async function cmdUploadMaterial(args, opts) {
  const accessToken = await getToken(opts);
  const file = requireArg(args, 0, "file");
  const allowedTypes = new Set(["image", "voice", "video", "thumb"]);
  if (!allowedTypes.has(opts.type)) {
    throw new WeChatAPIError("--type must be one of image, voice, video, or thumb.");
  }

  const fields = {};
  if (opts.type === "video" && (opts.title || opts.introduction)) {
    fields.description = JSON.stringify({
      title: opts.title || "",
      introduction: opts.introduction || "",
    });
  }

  const url = urlWithToken("/cgi-bin/material/add_material", accessToken, {
    type: opts.type,
  });
  writeJson(await multipartPost(url, "media", file, Object.keys(fields).length ? fields : undefined));
}

async function cmdAddDraft(args, opts) {
  const accessToken = await getToken(opts);
  const payloadPath = requireArg(args, 0, "payload");
  const payload = normalizeDraftPayload(await readJson(payloadPath));
  const url = urlWithToken("/cgi-bin/draft/add", accessToken);
  writeJson(await requestJson("POST", url, payload));
}

async function cmdSubmitPublish(args, opts) {
  const accessToken = await getToken(opts);
  const mediaId = requireArg(args, 0, "media_id");
  const url = urlWithToken("/cgi-bin/freepublish/submit", accessToken);
  writeJson(await requestJson("POST", url, { media_id: mediaId }));
}

async function cmdGetPublish(args, opts) {
  const accessToken = await getToken(opts);
  const publishId = requireArg(args, 0, "publish_id");
  const url = urlWithToken("/cgi-bin/freepublish/get", accessToken);
  writeJson(await requestJson("POST", url, { publish_id: publishId }));
}

async function printFile(path) {
  process.stdout.write(await readFile(path, "utf8"));
}

async function run() {
  if (process.argv.includes("--version") || process.argv.includes("-v")) {
    const pkg = JSON.parse(await readFile(files.package, "utf8"));
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }

  const { command, args, opts } = parseArgs(process.argv.slice(2));
  if (!command || opts.help) {
    showHelp();
    return 0;
  }

  switch (command) {
    case "skill":
    case "skill-md":
      await printFile(files.skill);
      return 0;
    case "skill-path":
      process.stdout.write(`${files.skill}\n`);
      return 0;
    case "reference":
    case "reference-md":
      await printFile(files.reference);
      return 0;
    case "reference-path":
      process.stdout.write(`${files.reference}\n`);
      return 0;
    case "token":
      await cmdToken(opts);
      return 0;
    case "upload-inline-image":
      await cmdUploadInlineImage(args, opts);
      return 0;
    case "upload-material":
      await cmdUploadMaterial(args, opts);
      return 0;
    case "add-draft":
      await cmdAddDraft(args, opts);
      return 0;
    case "submit-publish":
      await cmdSubmitPublish(args, opts);
      return 0;
    case "get-publish":
      await cmdGetPublish(args, opts);
      return 0;
    default:
      throw new WeChatAPIError(`Unknown command: ${command}`);
  }
}

try {
  process.exitCode = await run();
} catch (error) {
  if (error instanceof WeChatAPIError) {
    process.stderr.write(`error: ${error.message}\n`);
    process.exitCode = 2;
  } else {
    process.stderr.write(`error: ${error.message || String(error)}\n`);
    process.exitCode = 1;
  }
}
