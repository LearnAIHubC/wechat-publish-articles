#!/usr/bin/env python3
"""Small CLI for WeChat Official Account asset upload and article publishing."""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
from pathlib import Path
import sys
import time
from typing import Any
from urllib import parse, request


API_BASE = "https://api.weixin.qq.com"
DEFAULT_CACHE_FILE = ".wechat_access_token.json"
TOKEN_REFRESH_BUFFER_SECONDS = 300


class WeChatAPIError(RuntimeError):
    pass


def read_json(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json(data: Any) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True))


def load_cache(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def save_cache(path: Path, token: str, expires_in: int) -> None:
    payload = {
        "access_token": token,
        "expires_at": int(time.time()) + int(expires_in),
    }
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def request_json(method: str, url: str, payload: Any | None = None) -> dict[str, Any]:
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = request.Request(url, data=data, headers=headers, method=method)
    with request.urlopen(req, timeout=30) as resp:
        raw = resp.read().decode("utf-8")
    result = json.loads(raw)
    errcode = result.get("errcode")
    if errcode not in (None, 0):
        raise WeChatAPIError(f"WeChat API error {errcode}: {result.get('errmsg', '')}")
    return result


def multipart_post(url: str, file_field: str, file_path: Path, fields: dict[str, str] | None = None) -> dict[str, Any]:
    boundary = f"----codex-wechat-{int(time.time() * 1000)}"
    content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
    body = bytearray()

    for key, value in (fields or {}).items():
        body.extend(f"--{boundary}\r\n".encode("utf-8"))
        body.extend(f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode("utf-8"))
        body.extend(str(value).encode("utf-8"))
        body.extend(b"\r\n")

    body.extend(f"--{boundary}\r\n".encode("utf-8"))
    body.extend(
        (
            f'Content-Disposition: form-data; name="{file_field}"; '
            f'filename="{file_path.name}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode("utf-8")
    )
    body.extend(file_path.read_bytes())
    body.extend(b"\r\n")
    body.extend(f"--{boundary}--\r\n".encode("utf-8"))

    req = request.Request(
        url,
        data=bytes(body),
        headers={
            "Accept": "application/json",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    with request.urlopen(req, timeout=60) as resp:
        raw = resp.read().decode("utf-8")
    result = json.loads(raw)
    errcode = result.get("errcode")
    if errcode not in (None, 0):
        raise WeChatAPIError(f"WeChat API error {errcode}: {result.get('errmsg', '')}")
    return result


def token_url(appid: str, secret: str) -> str:
    qs = parse.urlencode(
        {
            "appid": appid,
            "secret": secret,
            "grant_type": "client_credential",
        }
    )
    return f"{API_BASE}/cgi-bin/token?{qs}"


def url_with_token(path: str, access_token: str, extra: dict[str, str] | None = None) -> str:
    params = {"access_token": access_token}
    if extra:
        params.update(extra)
    return f"{API_BASE}{path}?{parse.urlencode(params)}"


def get_token(args: argparse.Namespace) -> str:
    if args.access_token and not args.force_refresh:
        return args.access_token
    env_token = os.environ.get("WECHAT_ACCESS_TOKEN")
    if env_token and not args.force_refresh:
        return env_token

    cache_file = Path(args.cache_file or os.environ.get("WECHAT_TOKEN_CACHE", DEFAULT_CACHE_FILE))
    if not args.force_refresh:
        cached = load_cache(cache_file)
        if cached:
            expires_at = int(cached.get("expires_at", 0))
            if expires_at - int(time.time()) > TOKEN_REFRESH_BUFFER_SECONDS:
                return str(cached["access_token"])

    appid = args.appid or os.environ.get("WECHAT_APP_ID")
    secret = args.secret or os.environ.get("WECHAT_APP_SECRET")
    if not appid or not secret:
        raise WeChatAPIError("Missing credentials. Set WECHAT_APP_ID and WECHAT_APP_SECRET or pass --appid and --secret.")

    result = request_json("GET", token_url(appid, secret))
    token = str(result["access_token"])
    save_cache(cache_file, token, int(result.get("expires_in", 7200)))
    return token


def cmd_token(args: argparse.Namespace) -> None:
    token = get_token(args)
    write_json({"access_token": token})


def cmd_upload_inline_image(args: argparse.Namespace) -> None:
    access_token = get_token(args)
    path = Path(args.file)
    url = url_with_token("/cgi-bin/media/uploadimg", access_token)
    write_json(multipart_post(url, "media", path))


def cmd_upload_material(args: argparse.Namespace) -> None:
    access_token = get_token(args)
    path = Path(args.file)
    url = url_with_token("/cgi-bin/material/add_material", access_token, {"type": args.type})
    fields: dict[str, str] = {}
    if args.type == "video" and (args.title or args.introduction):
        fields["description"] = json.dumps(
            {"title": args.title or "", "introduction": args.introduction or ""},
            ensure_ascii=False,
        )
    write_json(multipart_post(url, "media", path, fields or None))


def normalize_draft_payload(raw: Any) -> dict[str, Any]:
    if isinstance(raw, list):
        return {"articles": raw}
    if isinstance(raw, dict) and isinstance(raw.get("articles"), list):
        return raw
    raise WeChatAPIError("Draft JSON must be an object with articles[] or a raw array of article objects.")


def cmd_add_draft(args: argparse.Namespace) -> None:
    access_token = get_token(args)
    payload = normalize_draft_payload(read_json(args.payload))
    url = url_with_token("/cgi-bin/draft/add", access_token)
    write_json(request_json("POST", url, payload))


def cmd_submit_publish(args: argparse.Namespace) -> None:
    access_token = get_token(args)
    url = url_with_token("/cgi-bin/freepublish/submit", access_token)
    write_json(request_json("POST", url, {"media_id": args.media_id}))


def cmd_get_publish(args: argparse.Namespace) -> None:
    access_token = get_token(args)
    url = url_with_token("/cgi-bin/freepublish/get", access_token)
    write_json(request_json("POST", url, {"publish_id": args.publish_id}))


def add_auth_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--appid", default=argparse.SUPPRESS, help="WeChat AppID. Defaults to WECHAT_APP_ID.")
    parser.add_argument("--secret", default=argparse.SUPPRESS, help="WeChat AppSecret. Defaults to WECHAT_APP_SECRET.")
    parser.add_argument(
        "--access-token",
        default=argparse.SUPPRESS,
        help="Use an existing token instead of reading cache or credentials.",
    )
    parser.add_argument(
        "--cache-file",
        default=argparse.SUPPRESS,
        help=f"Token cache file. Defaults to {DEFAULT_CACHE_FILE}.",
    )
    parser.add_argument(
        "--force-refresh",
        action="store_true",
        default=argparse.SUPPRESS,
        help="Ignore cached token and request a new one.",
    )


def ensure_auth_defaults(args: argparse.Namespace) -> None:
    for name, default in {
        "appid": None,
        "secret": None,
        "access_token": None,
        "cache_file": None,
        "force_refresh": False,
    }.items():
        if not hasattr(args, name):
            setattr(args, name, default)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="WeChat Official Account publishing helper")
    add_auth_args(parser)
    sub = parser.add_subparsers(dest="command", required=True)

    token_parser = sub.add_parser("token", help="Get or refresh access_token")
    add_auth_args(token_parser)
    token_parser.set_defaults(func=cmd_token)

    inline = sub.add_parser("upload-inline-image", help="Upload image for article body HTML and return URL")
    add_auth_args(inline)
    inline.add_argument("file")
    inline.set_defaults(func=cmd_upload_inline_image)

    material = sub.add_parser("upload-material", help="Upload permanent material and return media_id")
    add_auth_args(material)
    material.add_argument("file")
    material.add_argument("--type", default="image", choices=["image", "voice", "video", "thumb"])
    material.add_argument("--title", help="Video material title")
    material.add_argument("--introduction", help="Video material introduction")
    material.set_defaults(func=cmd_upload_material)

    draft = sub.add_parser("add-draft", help="Create a WeChat draft from JSON payload")
    add_auth_args(draft)
    draft.add_argument("payload")
    draft.set_defaults(func=cmd_add_draft)

    submit = sub.add_parser("submit-publish", help="Submit draft media_id for publication")
    add_auth_args(submit)
    submit.add_argument("media_id")
    submit.set_defaults(func=cmd_submit_publish)

    status = sub.add_parser("get-publish", help="Get publish job status")
    add_auth_args(status)
    status.add_argument("publish_id")
    status.set_defaults(func=cmd_get_publish)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    ensure_auth_defaults(args)
    try:
        args.func(args)
        return 0
    except WeChatAPIError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except OSError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
