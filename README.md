# WeChat Publish Articles

Codex skill and helper script for publishing WeChat Official Account articles through the server-side WeChat APIs.

It covers the common publishing flow:

1. Get and cache an `access_token`.
2. Upload inline article images.
3. Upload a permanent cover image.
4. Create a draft.
5. Submit the draft for publication.
6. Poll the asynchronous publish status.

## Important Permission Note

WeChat publishing APIs are permission-gated. The publish endpoint may return `48001 api unauthorized` when the account cannot call the API.

As of WeChat's current platform rules, personal-subject accounts, uncertified enterprise accounts, and accounts that do not support certification may be unable to call the publish APIs. Check the WeChat Official Account backend under Developer Center / API permissions before relying on automated publishing.

Relevant docs:

- [Publishing capability](https://developers.weixin.qq.com/doc/offiaccount/Publish/Publish.html)
- [Submit draft for publication](https://developers.weixin.qq.com/doc/service/api/public/api_freepublish_submit.html)
- [WeChat API index](https://developers.weixin.qq.com/doc/subscription/api/)

## Repository Layout

```text
.
├── SKILL.md
├── agents/
│   └── openai.yaml
├── references/
│   └── wechat-official-api.md
└── scripts/
    └── wechat_publish.py
```

## Requirements

- Python 3.10+
- A WeChat Official Account AppID and AppSecret
- Server-side execution environment
- API permissions for draft and publish endpoints

Never put AppSecret or access tokens in frontend code, screenshots, logs, or committed files.

## Quick Start

Set credentials with environment variables:

```bash
export WECHAT_APP_ID="your_app_id"
export WECHAT_APP_SECRET="your_app_secret"
```

Get an access token:

```bash
python3 scripts/wechat_publish.py token
```

You can also pass an existing access token. Auth flags work either before or after the subcommand:

```bash
python3 scripts/wechat_publish.py --access-token "$ACCESS_TOKEN" token
python3 scripts/wechat_publish.py token --access-token "$ACCESS_TOKEN"
```

## CLI Commands

Upload an inline image for article HTML:

```bash
python3 scripts/wechat_publish.py upload-inline-image ./body.jpg
```

Upload a permanent cover image:

```bash
python3 scripts/wechat_publish.py upload-material ./cover.jpg --type image
```

Create a draft:

```bash
python3 scripts/wechat_publish.py add-draft ./draft.json
```

Submit a draft for publication:

```bash
python3 scripts/wechat_publish.py submit-publish DRAFT_MEDIA_ID
```

Poll publish status:

```bash
python3 scripts/wechat_publish.py get-publish PUBLISH_ID
```

## Draft Payload Example

`add-draft` accepts either an object with `articles` or a raw array of article objects.

```json
{
  "articles": [
    {
      "article_type": "news",
      "title": "Article title",
      "author": "Author",
      "digest": "Short summary",
      "content": "<p>HTML content with WeChat-hosted image URLs</p>",
      "content_source_url": "https://example.com/source",
      "thumb_media_id": "PERMANENT_MEDIA_ID",
      "need_open_comment": 0,
      "only_fans_can_comment": 0
    }
  ]
}
```

For normal news articles, `title`, `content`, and `thumb_media_id` are required. Body images should use URLs returned by the inline image upload endpoint.

## Token Cache

By default, the helper stores a temporary token cache in:

```text
.wechat_access_token.json
```

This file is ignored by `.gitignore`. You can override the cache location:

```bash
python3 scripts/wechat_publish.py token --cache-file /secure/path/wechat_token.json
```

## Troubleshooting

`48001 api unauthorized`

The account or AppID does not have permission to call the API. Check account type, certification status, and Developer Center API permissions.

`53503 draft check failed`

The draft did not pass WeChat's publish checks. Review required fields, cover media, content format, and article images.

Submit succeeded but no article URL appears yet

Publication is asynchronous. Use `get-publish` with the returned `publish_id` until the status is terminal.

## Security Checklist

- Keep AppSecret and access tokens server-side.
- Do not commit `.wechat_access_token.json`.
- Redact `access_token` query parameters from logs.
- Store draft and publish job IDs for audit and retry.
- Add a manual confirmation step before calling `submit-publish` in admin tools.

## Reference

See [references/wechat-official-api.md](references/wechat-official-api.md) for endpoint details, payload notes, status codes, and implementation caveats.
