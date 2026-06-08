---
name: wechat-publish-articles
description: Upload assets and publish WeChat Official Account articles through server-side WeChat APIs. Use when Codex needs to prepare article images, upload permanent cover assets, create or update draft payloads, submit drafts for publication, poll publish status, handle publish failures, or wrap this flow into a backend/admin publishing workflow.
---

# WeChat Publish Articles

## Overview

Use this skill to automate the WeChat Official Account article publishing flow: get an access token, upload article images, create a draft, submit it for publication, and verify the asynchronous publish result.

Keep API secrets server-side. Never place AppSecret or access tokens in frontend code, screenshots, logs, or committed files.

## Workflow

1. Confirm the account can call the draft and free publish APIs.
2. Get an `access_token`, preferably from a shared cache with a safety buffer before expiry.
3. Upload body images with `/cgi-bin/media/uploadimg`; replace local or external image URLs in article HTML with returned WeChat image URLs.
4. Upload the cover image as permanent material with `/cgi-bin/material/add_material`; use the returned `media_id` as `thumb_media_id`.
5. Create a draft with `/cgi-bin/draft/add`; store the returned draft `media_id`.
6. Submit the draft with `/cgi-bin/freepublish/submit`; store the returned `publish_id`.
7. Poll `/cgi-bin/freepublish/get` or process the publish callback event until the status is terminal.
8. Store `article_id`, `article_url`, failure status, and failure indexes for audit and retry.

Read `references/wechat-official-api.md` when you need field limits, endpoint details, payload examples, status codes, or implementation caveats.

## Recommended Data Model

Track at least these records in the user's project:

- `wechat_assets`: local path or source URL, asset kind, returned `url`, returned `media_id`, hash, upload time.
- `wechat_drafts`: draft `media_id`, article payload snapshot, title, source content version, created time.
- `wechat_publish_jobs`: `publish_id`, draft `media_id`, status, `article_id`, `article_url`, failure detail, last checked time.

Use idempotency where possible: hash uploaded image files and reuse existing uploaded assets when the account and file hash match.

## Script Helper

Use `scripts/wechat_publish.py` for direct API calls during implementation or testing.

Set credentials with environment variables or flags:

```bash
export WECHAT_APP_ID="..."
export WECHAT_APP_SECRET="..."
```

Common commands:

```bash
python scripts/wechat_publish.py token
python scripts/wechat_publish.py upload-inline-image ./body.jpg
python scripts/wechat_publish.py upload-material ./cover.jpg --type image
python scripts/wechat_publish.py add-draft ./draft.json
python scripts/wechat_publish.py submit-publish MEDIA_ID
python scripts/wechat_publish.py get-publish PUBLISH_ID
```

The `add-draft` input may be either `{"articles": [...]}` or a raw JSON array of article objects.

## Implementation Notes

Do server-side validation before calling WeChat:

- Ensure `title`, `content`, and `thumb_media_id` are present for normal news articles.
- Ensure body images use WeChat-hosted URLs from the inline image upload endpoint.
- Enforce image file type and size limits before upload.
- Treat submit success as "publish job accepted", not "article published".
- On token error or expired token errors, refresh once and retry the failed request.
- Log WeChat `errcode` and `errmsg`, but redact credentials and token query values.

For admin tools, add a manual confirmation step before `submit-publish`, because publication is user-facing and may trigger platform review.
