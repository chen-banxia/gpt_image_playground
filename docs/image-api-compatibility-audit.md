# 图像参数官方兼容性核查

核查日期：2026-11-05。通过 `http://127.0.0.1:7890` 读取 OpenAI 官方文档正文，并对照 `openaiCompatibleImageApi.ts` 的实际请求。应用当前默认连接兼容网关；网关扩展不等于官方 API 能力。

## 官方来源

- [Images 生成参数](https://developers.openai.com/api/reference/resources/images/methods/generate)
- [Images 编辑参数](https://developers.openai.com/api/reference/resources/images/methods/edit)
- [Responses 参数](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [图像生成指南](https://developers.openai.com/api/docs/guides/image-generation)
- [图像输入要求](https://developers.openai.com/api/docs/guides/images-vision#image-input-requirements)

## 模型 ID 与网关扩展

| 项目中的模型 ID | 官方确认情况 |
| --- | --- |
| `gpt-image-2.6-sunburst`、`gpt-image-2.6-flare` | 生成、编辑和 Responses 图像工具的支持清单明确列出。Responses 顶层仍必须选择文本模型。 |
| `gpt-image-2.6`、`gpt-image-2.5` | 未列在官方支持清单中，不应当作已确认的官方别名。保留用户/网关用途，界面沿用原有描述，核查结论仅在此记录。 |
| `gpt-image-2-2k/4k`、`gpt-image-2.5-flare-2k/4k`、`gpt-image-2.5-sunburst-2k/4k` | codex2api 网关别名，不是官方模型 ID。界面沿用原有描述；直接连接 `api.openai.com` 时不再自动添加这些后缀。显式选择的 ID 仍原样发送，须由目标网关支持。 |

## 实际请求字段逐项核查

| 字段 | 官方约束 | 当前处理 |
| --- | --- | --- |
| `prompt` | Images API 最长 32000 字符 | 在附加构图要求和提示前缀后检查实际发送长度，超出时拒绝，不截断。Responses 文本输入不套用这个 Images 专属上限。 |
| `quality` | `auto/low/medium/high`；生成指南确认 2.5、2.6 Sunburst/Flare 支持 `xhigh/max` | 保留；不再仅凭模型名包含 `gpt-image-2.5` 就启用扩展档位。现有已知网关超分别名沿用其基础模型质量档位。 |
| `size` | 静态图参考文档列出 16 倍数、比例 1:3–3:1、边长/总像素约束；大于 2560×1440 为实验性 | 保留现有尺寸规整，非法输入改为 `auto`。2.6 专属尺寸说明尚未写齐，不宣称所有 4K 尺寸已获模型保证。GIF 单帧尺寸单独处理。 |
| `n` | Images 为 1–10 的整数；SVG 要求 1 | 发送前补齐整数/有限值校验。当前网关模式多图通常拆成并发单图；Responses 工具本身不发送 `n`，由客户端并发。 |
| `output_format` | 生成支持 PNG/JPEG/WebP/GIF/SVG；格式还取决于模型 | 2.6 Sunburst/Flare 开放 GIF/SVG，其他模型保守回退 PNG。非法格式不透传。 |
| `output_compression` | JPEG/WebP 专用，整数 0–100 | 非 JPEG/WebP 不发送；导入配置中的小数、越界、非有限值已规范化。 |
| `background` | `auto/opaque/transparent`；透明输出要求 PNG/WebP | 原生透明只在 PNG/WebP 发送 `transparent`。本地抠图是客户端功能，不发送透明背景字段。 |
| `moderation` | Images 和 Responses 图像工具都支持 `auto/low` | 保留两档。非法导入值归一化为 `auto`。不是移除审核，也不保证内容一定通过。 |
| `stream`、`partial_images` | 静态图支持；部分图数 0–3 | 本项目固定 `partial_images=2`，合法。GIF/SVG 不发送部分图预览。Responses GIF 可流式返回生命周期事件，但当前预览开关不实现此用途。 |
| `complexity` | `low/medium/high`，独立于 quality | 2.6 Sunburst/Flare 可显式发送。Images 省略时 high；Responses 省略时可继承外层受支持的 effort。 |
| `frame_count`、`frame_duration_ms` | 仅 GIF | 采用两份文档共同支持的 2–16 帧、20–2000ms、10ms 间隔；默认 9 帧、200ms。 |
| `image[]` | multipart 编辑仍受支持；JSON 编辑使用 `images` 对象数组 | 沿用 multipart，不需要因为 JSON schema 展示 `images` 就改名。Images 请求前检查不超过 16 张。 |
| `mask` / `input_image_mask` | 前者用于 Images，后者用于 Responses 工具；遮罩应用于首图 | 保留两种正确字段；无原图的遮罩请求提前拒绝。UI 验证尺寸，Images 首图和遮罩转为 PNG。 |
| 输入 GIF / SVG | 视觉输入仅支持非动画 GIF；SVG 不是支持的编辑栅格输入 | GIF 解析图像数据块判断是否多帧，多帧与 SVG 提前拒绝；不自动取第一帧或把矢量静默栅格化。 |
| `action` / `tool_choice` | Responses 支持 `generate/edit/auto`；`tool_choice: required` 合法 | 按参考图选择 generate/edit，顶层强制调用图像工具。 |

## 明确不支持、已弃用或未启用的字段

- `response_format`、`style`：API 参考明确写明 GPT Image 不支持；项目没有发送。图片仍从 `b64_json` 解码，不必添加 `response_format=b64_json`。
- `input_fidelity`：参考仅列旧模型适用，`gpt-image-2` 明确要求省略；2.6 未确认该字段，本项目不发送。
- `user`：已弃用，替代是可选的 `safety_identifier`（最多 128 字符）。两者项目均未发送；省略可选字段合法。
- `prompt_rewriter`：GIF/SVG/markup 明确不能组合；项目不发送此字段。提示词中的“不要重写”前缀只是文本，不是 API 参数，也不能保证服务端绝不改写。
- `markup`：官方支持透明 PNG 标注层，和首图尺寸一致，不能与 mask/prompt_rewriter 同用；本项目暂未实现标注层编辑 UI，不发送该字段。
- `svg.model`、`svg.reasoning`：可选的 SVG 作者模型配置，有权限和端点差异；本项目不发送，使用服务端默认作者。Images 若账号启用了必须指定作者模型的模式，当前 UI 尚不覆盖该配置。
- `size_fit`、`source_size`、`transparent_output`、`transparent_method`、`codexCli`、`apiProxy`、`imageGenerationModel`：均是本地配置/元数据，不作为同名字段发送给官方。`imageGenerationModel` 映射到 Responses 的 `tools[].model`。

## 官方文档尚不一致的部分

1. GIF 帧数：指南写 2–64，Images/Responses schema 写 2–16。
2. GIF 每帧时长：指南和 Responses 为 20–2000ms，Images schema 描述了更大的编码上限。
3. GIF 编辑：指南明确不支持，编辑 schema 仍列 GIF 字段；当前按指南禁止。
4. `xhigh/max`：生成指南明确确认 2.6；API 字段说明仍主要列 2.5。本项目依据明确的 2.6 指南开放。
5. 2.6 的静态尺寸和透明背景：字段通用说明存在，但专门列举模型的段落仍主要停留在 2/2.5；没有证据表明已移除，也不能据此承诺新型号所有组合都已实测。

通用视觉输入文档写 512 MB 总请求负载、最多 1500 张，这不替代 Images 编辑端点的 16 张限制。项目的 512 MiB 检查是客户端图片负载保护，不能精确代表包含 JSON/multipart 开销的整个 HTTP 请求。遮罩指南要求原图/遮罩格式及尺寸一致、文件小于 50MB，现有界面与上传路径提供相应校验；最终模型/账户/网关限制仍以服务端为准。

本次核查没有发起真实生图，也没有把网关兼容行为当成官方端点实测结果。
