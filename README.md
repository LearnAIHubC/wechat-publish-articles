# WeChat Publish Articles

一个用于微信公众号文章发布流程的 Codex Skill 和纯 Node.js 命令行工具。

它可以辅助完成常见的服务端发布链路：

1. 获取并缓存 `access_token`。
2. 上传正文内图片。
3. 上传永久封面素材。
4. 创建草稿。
5. 提交草稿发布。
6. 轮询异步发布状态。

## 重要权限说明

微信公众号发布接口有账号权限限制。如果账号没有对应接口权限，发布接口可能返回：

```text
48001 api unauthorized
```

这通常不是脚本问题，而是公众号主体类型、认证状态或接口权限不满足要求。

根据微信公众平台当前规则，个人主体账号、企业主体未认证账号，以及不支持认证的账号，可能无法调用发布相关 API。正式接入前，请先在「微信公众平台后台 -> 开发者中心 -> 接口权限」确认账号是否具备草稿箱和发布能力。

相关官方文档：

- [发布能力](https://developers.weixin.qq.com/doc/offiaccount/Publish/Publish.html)
- [发布草稿接口](https://developers.weixin.qq.com/doc/service/api/public/api_freepublish_submit.html)
- [微信公众号接口文档](https://developers.weixin.qq.com/doc/subscription/api/)

## 目录结构

```text
.
├── SKILL.md
├── agents/
│   └── openai.yaml
├── references/
│   └── wechat-official-api.md
├── bin/
│   └── wechat-publish-articles.js
└── package.json
```

## 环境要求

- Node.js 18+
- 微信公众号 AppID 和 AppSecret
- 服务端运行环境
- 草稿箱接口和发布接口权限

AppSecret 和 access token 必须只放在服务端，不要写入前端代码、截图、日志或 git 仓库。

## 快速开始

### 通过 npx 使用

当前仓库已经包含 npm CLI 包配置，可以直接通过 GitHub 运行：

```bash
npx github:LearnAIHubC/wechat-publish-articles --help
```

调用发布工具：

```bash
npx github:LearnAIHubC/wechat-publish-articles token
npx github:LearnAIHubC/wechat-publish-articles add-draft ./draft.json
npx github:LearnAIHubC/wechat-publish-articles submit-publish DRAFT_MEDIA_ID
```

LLM 或自动化 Agent 可以直接读取 Skill 说明和接口参考：

```bash
npx github:LearnAIHubC/wechat-publish-articles skill
npx github:LearnAIHubC/wechat-publish-articles reference
```

如果后续发布到 npm registry，也可以使用：

```bash
npx wechat-publish-articles --help
```

### 本地开发使用

通过环境变量配置凭证：

```bash
export WECHAT_APP_ID="your_app_id"
export WECHAT_APP_SECRET="your_app_secret"
```

获取 access token：

```bash
node bin/wechat-publish-articles.js token
```

也可以传入已有 token。认证参数既可以放在子命令前，也可以放在子命令后：

```bash
node bin/wechat-publish-articles.js --access-token "$ACCESS_TOKEN" token
node bin/wechat-publish-articles.js token --access-token "$ACCESS_TOKEN"
```

## 命令说明

下面示例使用 npx。也可以把 `npx github:LearnAIHubC/wechat-publish-articles` 替换为本地命令：

```bash
node bin/wechat-publish-articles.js
```

上传正文内图片，返回可用于文章 HTML 的微信图片 URL：

```bash
npx github:LearnAIHubC/wechat-publish-articles upload-inline-image ./body.jpg
```

上传永久封面素材，返回 `media_id`：

```bash
npx github:LearnAIHubC/wechat-publish-articles upload-material ./cover.jpg --type image
```

创建草稿：

```bash
npx github:LearnAIHubC/wechat-publish-articles add-draft ./draft.json
```

提交草稿发布：

```bash
npx github:LearnAIHubC/wechat-publish-articles submit-publish DRAFT_MEDIA_ID
```

查询发布状态：

```bash
npx github:LearnAIHubC/wechat-publish-articles get-publish PUBLISH_ID
```

## 草稿 JSON 示例

`add-draft` 支持两种输入格式：

- `{"articles": [...]}`
- 直接传入文章对象数组 `[...]`

示例：

```json
{
  "articles": [
    {
      "article_type": "news",
      "title": "文章标题",
      "author": "作者",
      "digest": "摘要",
      "content": "<p>正文 HTML，图片需使用微信托管 URL</p>",
      "content_source_url": "https://example.com/source",
      "thumb_media_id": "PERMANENT_MEDIA_ID",
      "need_open_comment": 0,
      "only_fans_can_comment": 0
    }
  ]
}
```

普通图文文章至少需要提供 `title`、`content` 和 `thumb_media_id`。正文图片应先通过正文图片上传接口上传，并替换为微信返回的图片 URL。

## Token 缓存

脚本默认会把 token 临时缓存到：

```text
.wechat_access_token.json
```

该文件已被 `.gitignore` 忽略。也可以指定其他缓存路径：

```bash
npx github:LearnAIHubC/wechat-publish-articles token --cache-file /secure/path/wechat_token.json
```

## 常见问题

### 48001 api unauthorized

账号或 AppID 没有权限调用对应接口。请检查公众号主体类型、认证状态，以及开发者中心里的接口权限。

### 53503 draft check failed

草稿没有通过微信发布检查。请检查必填字段、封面素材、正文格式和正文图片 URL。

### 提交成功但暂时没有文章链接

发布是异步流程。`submit-publish` 成功只表示任务已提交，不代表文章已经发布成功。需要使用返回的 `publish_id` 调用 `get-publish` 轮询到终态。

## 安全清单

- AppSecret 和 access token 只保存在服务端。
- 不要提交 `.wechat_access_token.json`。
- 日志中不要记录带 `access_token` 的完整 URL。
- 保存草稿 `media_id`、发布 `publish_id` 和发布结果，方便审计和重试。
- 后台工具在调用 `submit-publish` 前应增加人工确认步骤。

## 参考资料

更多接口说明、字段限制、状态码和实现注意事项见 [references/wechat-official-api.md](references/wechat-official-api.md)。
