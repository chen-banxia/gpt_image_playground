# 图片生成 API 对接文档

本文档按当前项目代码的真实请求方式整理，重点覆盖两条链路：

- 网页端画图：OpenAI 兼容的 `Images API` 请求方式。
- Codex 画图：Codex CLI/API 兼容模式下的请求差异，以及 `Responses API` 图片工具请求方式。

相关代码入口：

- `src/store.ts`：任务创建、参数归一化、调用 API、落库。
- `src/lib/api.ts`：根据当前 profile 分发 provider。
- `src/lib/openaiCompatibleImageApi.ts`：OpenAI 兼容图片接口主实现。
- `src/lib/imageApiShared.ts`：通用请求/响应类型、大小限制、错误解析。
- `src/lib/paramCompatibility.ts`：不同 provider/mode 的参数归一化。

## 1. 总体调用链

用户点击生成后，调用链如下：

```text
submitTask()
  -> normalizeParamsForSettings(params, settings)
  -> executeTask(taskId)
  -> callImageApi({
       settings,
       prompt,
       params,
       inputImageDataUrls,
       maskDataUrl
     })
  -> getActiveApiProfile(settings)
  -> provider=openai: callOpenAICompatibleImageApi()
  -> apiMode=images: callImagesApi()
  -> apiMode=responses: callResponsesImageApi()
```

`inputImageDataUrls.length === 0` 时是文生图；大于 0 时是图生图/编辑图；存在 `maskDataUrl` 时是带遮罩编辑。

## 2. 公共配置

### 2.1 Profile 字段

```ts
interface ApiProfile {
  id: string
  name: string
  provider: 'openai' | 'fal'
  baseUrl: string
  apiKey: string
  model: string
  timeout: number
  apiMode: 'images' | 'responses'
  codexCli: boolean
  apiProxy: boolean
}
```

本文档只展开 `provider='openai'` 的请求。`fal` 是单独 provider，走 `@fal-ai/client`，不属于这两条主链路。

默认值：

```ts
baseUrl: VITE_DEFAULT_API_URL || 'https://colorflowai.com/v1'
images model: 'gpt-image-2'
responses model: 'gpt-5.5'
timeout: 600 秒
apiMode: 'images'
```

代码现状需要特别注意：`getActiveApiProfile()` 对 `provider='openai'` 会把 `codexCli` 归一化为 `true`。因此当前项目实际发起 OpenAI provider 请求时，会使用 Codex 兼容行为。若后续要恢复“官方网页端 OpenAI Images API”行为，需要检查 `src/lib/apiProfiles.ts` 中对 `codexCli` 的强制覆盖逻辑。

### 2.2 API URL 拼接

`baseUrl` 会先被 `normalizeBaseUrl()` 处理：

- 没有协议时自动补 `https://`。
- 如果路径中包含 `v1`，保留到 `v1` 为止。
- 如果没有 `v1`，请求时会补成 `/v1/...`。

常见结果：

| 输入 baseUrl | 实际请求前缀 |
| --- | --- |
| `https://api.example.com` | `https://api.example.com/v1` |
| `https://api.example.com/v1` | `https://api.example.com/v1` |
| `api.example.com` | `https://api.example.com/v1` |
| `https://api.example.com/custom/v1/extra` | `https://api.example.com/custom/v1` |

如果开启 `apiProxy` 且当前环境可用代理，请求会改为同源路径：

```text
/api-proxy/images/generations
/api-proxy/images/edits
/api-proxy/responses
```

### 2.3 公共请求头

所有 OpenAI 兼容请求都会带：

```http
Authorization: Bearer <apiKey>
Cache-Control: no-store, no-cache, max-age=0
Pragma: no-cache
```

JSON 请求额外带：

```http
Content-Type: application/json
```

`multipart/form-data` 请求由浏览器自动生成 `Content-Type` 和 boundary，代码不会手动设置。

### 2.4 任务参数

```ts
interface TaskParams {
  size: string
  quality: 'auto' | 'low' | 'medium' | 'high'
  output_format: 'png' | 'jpeg' | 'webp'
  output_compression: number | null
  moderation: 'auto' | 'low'
  n: number
}
```

默认值：

```json
{
  "size": "auto",
  "quality": "auto",
  "output_format": "png",
  "output_compression": null,
  "moderation": "auto",
  "n": 1
}
```

归一化规则：

- OpenAI provider 最多 `n=10`。
- `size` 如果是 `宽x高` 会被规整到 16 的倍数，并限制边长、像素数和宽高比。
- `output_format='png'` 时，`output_compression` 会被清空为 `null`。
- `quality` 由用户自由选择，任何模式下都会照原样发送。

### 2.5 输入图片和大小限制

API 调用入参：

```ts
interface CallApiOptions {
  settings: AppSettings
  prompt: string
  params: TaskParams
  inputImageDataUrls: string[]
  maskDataUrl?: string
}
```

限制：

- 遮罩编辑时，主图文件上限：`50 MiB`。
- 遮罩文件上限：`50 MiB`。
- 所有输入图片和遮罩的总有效负载上限：`512 MiB`。

遮罩编辑时，目标图片会被移动到 `inputImageDataUrls[0]`，并且第一张图会转成 PNG 后上传，以匹配遮罩。

## 3. 网页端画图：Images API

对应代码：`callImagesApiSingle()`。

该模式使用 OpenAI 兼容图片接口：

- 文生图：`POST /v1/images/generations`
- 图生图/编辑图：`POST /v1/images/edits`

### 3.1 文生图请求

触发条件：

```ts
inputImageDataUrls.length === 0
```

请求：

```http
POST <baseUrl>/images/generations
Content-Type: application/json
Authorization: Bearer <apiKey>
```

标准网页端请求体：

```json
{
  "model": "gpt-image-2",
  "prompt": "一只白色陶瓷杯，极简产品摄影",
  "size": "1024x1024",
  "output_format": "png",
  "moderation": "auto",
  "quality": "auto",
  "n": 1
}
```

字段规则：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | 是 | 当前 profile 的模型 ID。Images API 默认 `gpt-image-2`。 |
| `prompt` | string | 是 | 用户提示词。Codex 模式会加防改写前缀，见第 4 节。 |
| `size` | string | 是 | 可为 `auto` 或 `1024x1024` 这类尺寸。 |
| `output_format` | string | 是 | `png`、`jpeg`、`webp`。 |
| `moderation` | string | 是 | `auto` 或 `low`。 |
| `quality` | string | 是 | `auto`、`low`、`medium`、`high`。所有模式都会发送。 |
| `output_compression` | number | 条件 | 仅当 `output_format !== 'png'` 且不为 `null` 时发送。 |
| `n` | number | 条件 | 仅当 `n > 1` 时发送。 |

`output_format='jpeg'` 或 `webp` 且设置压缩率时：

```json
{
  "model": "gpt-image-2",
  "prompt": "城市夜景",
  "size": "1536x1024",
  "output_format": "webp",
  "output_compression": 85,
  "moderation": "auto",
  "quality": "high"
}
```

### 3.2 图生图/编辑图请求

触发条件：

```ts
inputImageDataUrls.length > 0
```

请求：

```http
POST <baseUrl>/images/edits
Authorization: Bearer <apiKey>
Content-Type: multipart/form-data; boundary=...
```

`FormData` 字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | 是 | 当前 profile 的模型 ID。 |
| `prompt` | string | 是 | 编辑提示词。 |
| `size` | string | 是 | 输出尺寸。 |
| `output_format` | string | 是 | `png`、`jpeg`、`webp`。 |
| `moderation` | string | 是 | `auto` 或 `low`。 |
| `quality` | string | 是 | `auto`、`low`、`medium`、`high`。所有模式都会发送。 |
| `output_compression` | string | 条件 | 非 PNG 且不为 `null` 时发送字符串。 |
| `n` | string | 条件 | `n > 1` 时发送字符串。 |
| `image[]` | File | 是 | 每张输入图一个 `image[]` 字段。文件名为 `input-1.png` 等。 |
| `mask` | File | 条件 | 存在遮罩时发送，文件名固定 `mask.png`。 |

无遮挡编辑示例：

```bash
curl -X POST "https://api.example.com/v1/images/edits" \
  -H "Authorization: Bearer $API_KEY" \
  -F "model=gpt-image-2" \
  -F "prompt=把背景换成干净的浅灰色影棚" \
  -F "size=1024x1024" \
  -F "output_format=png" \
  -F "moderation=auto" \
  -F "quality=auto" \
  -F "image[]=@input-1.png"
```

带遮罩编辑示例：

```bash
curl -X POST "https://api.example.com/v1/images/edits" \
  -H "Authorization: Bearer $API_KEY" \
  -F "model=gpt-image-2" \
  -F "prompt=只替换遮罩区域，把杯子改成磨砂黑色" \
  -F "size=1024x1024" \
  -F "output_format=png" \
  -F "moderation=auto" \
  -F "quality=auto" \
  -F "image[]=@target.png" \
  -F "mask=@mask.png"
```

### 3.3 Images API 响应格式

项目接受以下响应：

```json
{
  "size": "1024x1024",
  "quality": "medium",
  "output_format": "png",
  "data": [
    {
      "b64_json": "iVBORw0KGgo...",
      "revised_prompt": "可选：API 改写后的提示词",
      "size": "1024x1024",
      "quality": "medium",
      "output_format": "png"
    }
  ]
}
```

图片读取优先级：

1. 如果 `data[i].b64_json` 存在，直接转成 `data:<mime>;base64,...`。
2. 否则如果 `data[i].url` 是 HTTP URL，会下载后转成 data URL。
3. 否则如果 `data[i].url` 本身是 data URL，直接使用。

实际生效参数提取：

- 优先从响应顶层提取 `size`、`quality`、`output_format`、`output_compression`、`moderation`、`n`。
- `revised_prompt` 按每张图片保存。
- 如果没有任何可用图片，抛出错误。

## 4. Codex 画图：Images API 兼容差异

对应代码：`callImagesApi()`、`callImagesApiConcurrent()`、`callImagesApiSingle()`。

Codex 兼容模式仍然使用：

- `POST /v1/images/generations`
- `POST /v1/images/edits`

但请求行为与网页端标准模式不同。

### 4.1 Prompt 防改写前缀

Codex Images API 请求会把用户 prompt 改成：

```text
Use the following text as the complete prompt. Do not rewrite it:
<用户原始 prompt>
```

示例：

```json
{
  "model": "gpt-image-2",
  "prompt": "Use the following text as the complete prompt. Do not rewrite it:\n画一个红色机械键盘的产品图",
  "size": "1024x1024",
  "output_format": "png",
  "moderation": "auto"
}
```

### 4.2 quality 照常发送

Codex 兼容模式不再改动 `quality`，用户在界面上选的值会原样发送。两种模式只在 prompt 前缀上不同：

网页端标准请求：

```json
{
  "model": "gpt-image-2",
  "prompt": "prompt",
  "size": "1024x1024",
  "output_format": "png",
  "moderation": "auto",
  "quality": "high"
}
```

Codex 请求：

```json
{
  "model": "gpt-image-2",
  "prompt": "Use the following text as the complete prompt. Do not rewrite it:\nprompt",
  "size": "1024x1024",
  "output_format": "png",
  "moderation": "auto",
  "quality": "high"
}
```

### 4.3 多图生成拆分为并发单图

当 `apiMode='images'`、`codexCli=true` 且 `n > 1` 时，项目不会向接口发送一次 `n` 多图请求，而是拆成 `n` 个并发单图请求：

```text
n=4
  -> Promise.allSettled([
       POST /images/generations, n=1
       POST /images/generations, n=1
       POST /images/generations, n=1
       POST /images/generations, n=1
     ])
```

合并规则：

- 只要至少一个请求成功，就把成功结果合并为任务成功。
- 如果全部失败，抛出第一个失败原因。
- 最终 `actualParams.n` 会记录实际成功图片数。

这用于兼容部分 Codex API 对 `n` 参数无效或不稳定的问题。

### 4.4 Codex Images API 响应要求

响应仍按 Images API 格式解析：

```json
{
  "output_format": "png",
  "quality": "medium",
  "size": "1033x1522",
  "data": [
    {
      "b64_json": "iVBORw0KGgo...",
      "revised_prompt": "可选"
    }
  ]
}
```

建议 Codex 后端尽量返回顶层真实参数，尤其是：

```json
{
  "size": "1033x1522",
  "quality": "medium",
  "output_format": "png"
}
```

项目会把这些字段展示为“实际生效参数”。如果 Codex 后端省略 `quality`，前端不会自行补一个假的 quality。

## 5. Codex 画图：Responses API 图片工具

对应代码：`callResponsesImageApiSingle()`。

该模式使用：

```http
POST <baseUrl>/responses
Content-Type: application/json
Authorization: Bearer <apiKey>
```

无论是否开启 Codex 兼容，Responses API 都会给 prompt 加防改写前缀。

### 5.1 文生图请求

触发条件：

```ts
apiMode === 'responses'
inputImageDataUrls.length === 0
```

请求体：

```json
{
  "model": "gpt-5.5",
  "input": "Use the following text as the complete prompt. Do not rewrite it:\n一张蓝色跑车海报",
  "tools": [
    {
      "type": "image_generation",
      "action": "generate",
      "size": "1024x1024",
      "output_format": "png",
      "quality": "auto"
    }
  ],
  "tool_choice": "required"
}
```

`quality` 始终随工具对象一起发送，与 Codex 兼容模式无关。

如果 `output_format !== 'png'` 且 `output_compression != null`：

```json
{
  "output_compression": 85
}
```

### 5.2 带参考图请求

触发条件：

```ts
apiMode === 'responses'
inputImageDataUrls.length > 0
```

请求体中的 `input` 从字符串变成消息数组：

```json
{
  "model": "gpt-5.5",
  "input": [
    {
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "Use the following text as the complete prompt. Do not rewrite it:\n保持人物不变，换成赛博朋克背景"
        },
        {
          "type": "input_image",
          "image_url": "data:image/png;base64,iVBORw0KGgo..."
        }
      ]
    }
  ],
  "tools": [
    {
      "type": "image_generation",
      "action": "edit",
      "size": "1024x1024",
      "output_format": "png"
    }
  ],
  "tool_choice": "required"
}
```

多张参考图时，会追加多个：

```json
{
  "type": "input_image",
  "image_url": "data:image/xxx;base64,..."
}
```

### 5.3 带遮罩请求

当存在 `maskDataUrl` 时，工具对象增加 `input_image_mask`：

```json
{
  "type": "image_generation",
  "action": "edit",
  "size": "1024x1024",
  "output_format": "png",
  "input_image_mask": {
    "image_url": "data:image/png;base64,iVBORw0KGgo..."
  }
}
```

完整示例：

```json
{
  "model": "gpt-5.5",
  "input": [
    {
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "Use the following text as the complete prompt. Do not rewrite it:\n只修改遮罩区域，把天空改成日落"
        },
        {
          "type": "input_image",
          "image_url": "data:image/png;base64,<target-image>"
        }
      ]
    }
  ],
  "tools": [
    {
      "type": "image_generation",
      "action": "edit",
      "size": "1024x1024",
      "output_format": "png",
      "input_image_mask": {
        "image_url": "data:image/png;base64,<mask>"
      }
    }
  ],
  "tool_choice": "required"
}
```

### 5.4 Responses API 多图生成

`Responses API` 模式下，项目不会在 tool 中传 `n`。如果用户设置 `n > 1`，同样拆成 `n` 个并发 `/responses` 请求：

```text
n=3
  -> POST /responses
  -> POST /responses
  -> POST /responses
```

合并规则与 Codex Images API 多图一致：

- 至少一个成功则任务成功。
- 全部失败才抛出错误。
- `actualParams.n` 记录实际成功图片数。

### 5.5 Responses API 响应格式

当前解析器只接收 `output[]` 中 `type='image_generation_call'` 且 `result` 是非空字符串的项：

```json
{
  "output": [
    {
      "type": "image_generation_call",
      "result": "iVBORw0KGgo...",
      "size": "1024x1024",
      "quality": "medium",
      "output_format": "png",
      "revised_prompt": "可选：API 改写后的提示词"
    }
  ]
}
```

`result` 可以是纯 base64；前端会按请求的 `output_format` 补成 data URL：

```text
data:image/png;base64,<result>
```

如果响应中没有可用的 `image_generation_call.result` 字符串，任务会失败。

## 6. 错误响应解析

非 2xx 响应会进入 `getApiErrorMessage()`。前端按以下顺序提取错误信息：

1. `error.message`
2. 字符串 `detail`
3. 数组 `detail`，逐项转字符串后换行拼接
4. 字符串 `error`
5. `message`
6. 响应文本
7. 兜底 `HTTP <status>`

推荐后端错误格式：

```json
{
  "error": {
    "message": "图片生成失败：余额不足"
  }
}
```

或：

```json
{
  "detail": "图片生成失败：输入图片过大"
}
```

## 7. 前端保存结果

API 返回后，前端会：

1. 把每张输出图片保存到 IndexedDB。
2. 在任务记录中保存输出图片 ID。
3. 对 OpenAI provider 保存实际生效参数：

```ts
actualParams?: Partial<TaskParams>
actualParamsByImage?: Record<imageId, Partial<TaskParams>>
revisedPromptByImage?: Record<imageId, string>
```

4. 如果检测到非 Codex 模式下 prompt 被改写，或接口缺少官方 API 常见返回字段，会提示用户开启 Codex CLI 兼容模式。

## 8. 后端适配清单

如果你要开发一个兼容本项目的后端，最少需要支持：

### 8.1 Images API 文生图

```http
POST /v1/images/generations
Content-Type: application/json
Authorization: Bearer <key>
```

请求体至少接收：

```json
{
  "model": "gpt-image-2",
  "prompt": "prompt",
  "size": "1024x1024",
  "output_format": "png",
  "moderation": "auto"
}
```

响应至少返回：

```json
{
  "data": [
    {
      "b64_json": "<base64>"
    }
  ]
}
```

### 8.2 Images API 编辑图

```http
POST /v1/images/edits
Content-Type: multipart/form-data
Authorization: Bearer <key>
```

必须接收：

```text
model
prompt
size
output_format
moderation
image[]
mask 可选
```

响应格式同 `/images/generations`。

### 8.3 Responses API 图片工具

```http
POST /v1/responses
Content-Type: application/json
Authorization: Bearer <key>
```

必须接收：

```json
{
  "model": "gpt-5.5",
  "input": "... 或消息数组 ...",
  "tools": [
    {
      "type": "image_generation",
      "action": "generate 或 edit",
      "size": "1024x1024",
      "output_format": "png"
    }
  ],
  "tool_choice": "required"
}
```

响应至少返回：

```json
{
  "output": [
    {
      "type": "image_generation_call",
      "result": "<base64>"
    }
  ]
}
```

## 9. 调试建议

- 如果图片接口返回 URL，确保浏览器能直接下载该 URL，否则前端转换 data URL 会失败。
- 如果接入 Codex 后端，建议返回顶层或单图级别的 `size`、`quality`、`output_format`，方便前端展示“实际参数”。
- `quality` 现在始终发送，后端需要能接受 `auto`、`low`、`medium`、`high`（不支持的值建议忽略而不是报错）。
- 如果后端不支持一次多图的 `n`，使用 Codex 兼容模式或 Responses API 模式，前端会自动拆成并发单图。
- 如果遇到 CORS，开发环境可启用 `dev-proxy.config.json`；部署环境可用 Docker/Nginx 的 `/api-proxy`。
