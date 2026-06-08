# WeChat Official Account Publishing API Reference

Load this file when implementing, debugging, or extending WeChat Official Account asset upload and article publishing workflows.

## Source Links

- Access token: https://developers.weixin.qq.com/doc/service/api/base/api_getaccesstoken
- Upload inline article image: https://developers.weixin.qq.com/doc/service/api/material/permanent/api_uploadimage
- Upload permanent material: https://developers.weixin.qq.com/doc/service/api/material/permanent/api_addmaterial
- Add draft: https://developers.weixin.qq.com/doc/service/api/draftbox/draftmanage/api_draft_add
- Submit draft publish: https://developers.weixin.qq.com/doc/service/api/public/api_freepublish_submit
- Get publish status: https://developers.weixin.qq.com/doc/service/api/public/api_freepublish_get

## Endpoint Summary

### Get access token

`GET https://api.weixin.qq.com/cgi-bin/token?appid=APPID&secret=APPSECRET&grant_type=client_credential`

Returns `access_token` and `expires_in`. The documented validity is currently 7200 seconds. Cache the token and refresh before expiry. WeChat also recommends the stable access token API in current docs; use the user's project conventions if one already exists.

### Upload inline article image

`POST https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token=ACCESS_TOKEN`

Request is multipart form data with field `media=@image`.

Returns `url`. Use that URL inside article HTML. This endpoint is for images inside the article body. Images uploaded here do not count toward the account image material count. Current documented limits: jpg/png only, under 1 MB.

### Upload permanent material

`POST https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=ACCESS_TOKEN&type=image`

Request is multipart form data with field `media=@file`. `type` may include `image`, `voice`, `video`, or `thumb`; for this skill, use `image` for normal cover/material image upload unless the existing project has a different convention.

Returns `media_id`; image upload may also return `url`. Use the returned permanent `media_id` as `thumb_media_id` when creating a normal news draft. Current documented image limits for permanent material: up to 10 MB, bmp/png/jpeg/jpg/gif.

### Add draft

`POST https://api.weixin.qq.com/cgi-bin/draft/add?access_token=ACCESS_TOKEN`

Payload:

```json
{
  "articles": [
    {
      "article_type": "news",
      "title": "TITLE",
      "author": "AUTHOR",
      "digest": "SUMMARY",
      "content": "<p>HTML content with WeChat image URLs</p>",
      "content_source_url": "https://example.com/original",
      "thumb_media_id": "PERMANENT_MEDIA_ID",
      "need_open_comment": 0,
      "only_fans_can_comment": 0
    }
  ]
}
```

Returns draft `media_id`.

Important field notes from current docs:

- `title` is required and capped at 32 Chinese characters.
- `author` is optional and capped at 16 Chinese characters.
- `digest` is optional and capped at 128 Chinese characters.
- `content` is required, supports HTML, strips JavaScript, and external image URLs are filtered.
- `content` must use image URLs returned by the inline image upload endpoint.
- `thumb_media_id` is required for `article_type=news` and must be a permanent media ID.
- Drafts can be viewed and managed in the Official Account platform.
- After a draft is published or mass-sent, it is removed from the draft box.

### Submit draft for publication

`POST https://api.weixin.qq.com/cgi-bin/freepublish/submit?access_token=ACCESS_TOKEN`

Payload:

```json
{
  "media_id": "DRAFT_MEDIA_ID"
}
```

Returns `errcode`, `errmsg`, `publish_id`, and `msg_data_id`. A successful return means the publish task was submitted, not that the article is already published.

### Get publish status

`POST https://api.weixin.qq.com/cgi-bin/freepublish/get?access_token=ACCESS_TOKEN`

Payload:

```json
{
  "publish_id": "PUBLISH_ID"
}
```

Useful response fields:

- `publish_status`: `0` success, `1` publishing, `2` original declaration failed, `3` normal failure, `4` platform review rejected, `5` deleted after success, `6` banned after success.
- `article_id`: returned on success.
- `article_detail.item[].article_url`: permanent article URL on success.
- `fail_idx`: failed article indexes for selected failure statuses.

## Implementation Caveats

- Call these APIs from the server only.
- Confirm API permissions in the WeChat Official Account backend before implementation.
- As of current official docs, some personal, uncertified enterprise, or non-certifiable accounts may lose publish API permissions from July 2025.
- Preserve the full request payload snapshot for each draft so failed publish jobs can be inspected and retried.
- Avoid duplicate uploads by hashing local files, but only reuse assets within the same WeChat account.
- Redact access tokens from logs and error reports.
