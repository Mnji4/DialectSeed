# DialectSeed · 乡音火种

我最开始只是想把自己的家乡话——阳江话——录下来。

做着做着发现，这件事不应该只属于一个地方。很多家乡话都面临类似的问题：会说的人在变少，年轻人听得懂但不一定会说；网上偶尔能找到视频和零散录音，但真正带有文本、说话人和授权信息、能长期保存甚至拿来训练语音模型的数据并不多。

所以我把原来的阳江话采集页面改成了 **DialectSeed**：一个可以让不同地方自己建立乡音语料库的小型开源框架。

它现在做的事情很朴素：让人选一种家乡话，看到一句提示，录下自己真实会说的版本，再把这条录音连同转写、说话人匿名 ID、授权范围一起保存下来。后台可以审核这些数据；满足条件的录音可以导出，继续用于 ASR（语音识别）或 TTS（语音合成）实验。

> 阳江话仍然保留在仓库里，但它只是默认示例，不再是系统写死的唯一语言。

## 现在能做什么

- 一个实例可以同时收集多种方言、土语或地方语言变体。
- 用户找不到自己的家乡话时，可以提交新增申请，由管理员确认后开放采集。
- “参考/释义文本”和“实际说出的家乡话转写”分开保存，避免把普通话提示误当成训练标签。
- 每个浏览器生成匿名 `speaker_id`，便于后续按说话人切分训练集，减少数据泄漏。
- 文化保存授权和模型训练授权分开记录。不同意训练的数据不会进入训练导出。
- 录音进入后台后可以审核、拒绝、恢复和删除。
- 管理员可以导出 ASR/TTS 训练清单，也可以用脚本下载成 `metadata.jsonl + audio/` 数据集。
- 如果说话人数足够，导出脚本会按 speaker 做稳定的 train / validation / test 切分，而不是把同一个人的声音随机散到不同集合里。

## 它目前不是什么

DialectSeed 目前是**语料采集和整理基础设施**，不是一个已经训练好的方言 ASR/TTS 模型，也不是一套完整的语言学调查系统。

特别是 TTS 对录音环境、音质一致性、文本规范和说话人数据量要求更高。网页众包录音可以作为起点，但不应该假装天然就是高质量 TTS 语料。当前导出保留浏览器产生的原始音频格式，采样率统一、降噪、静音裁剪等处理应该在独立、可复现的预处理流程里完成。

## 数据是怎么组织的

核心关系只有三层：

```text
variety  ->  text / prompt  ->  recording
家乡话       提示与转写          录音
```

### `varieties`

描述一种要采集的语言变体：

```text
id
slug
name
language_tag
region
description
status          pending / active / archived
created_by
created_at
```

这里没有试图强行解决“方言还是语言”的分类问题。对采集系统来说，`variety` 只是一个可管理的数据分区；名称、地区和 BCP 47 风格语言标签可以由维护者根据项目实际情况填写。

### `texts`

保存提示和转写：

```text
id
variety_id
content
reference_text  参考或释义文本
local_text      家乡话实际说法 / 转写
source          seed / user
prompt_key
status
created_at
```

`reference_text` 可以是普通话释义，也可以是其他便于参与者理解的提示；真正用于监督式 ASR/TTS 标签的是录音时保存下来的实际转写快照。

### `recordings`

保存录音元数据，音频本体放在 R2：

```text
id
text_id
variety_id
r2_key
mime_type
size_bytes
duration_ms
speaker_id
speaker_label
consent_archive
consent_training
consent_version
reference_text_snapshot
transcript_text_snapshot
status
created_at
```

训练导出当前只接受同时满足以下条件的数据：

1. 录音审核状态为 `approved`；
2. 贡献者明确勾选了训练授权；
3. 有非空的实际家乡话转写。

历史阳江话录音迁移到 v2 时，`consent_training` 默认保持为 `0`。旧数据没有明确授权，就不会因为升级系统而自动获得模型训练授权。

## 技术栈

```text
React + TypeScript + Vite     采集页和后台
Cloudflare Pages              前端托管
Cloudflare Workers            API
Cloudflare D1                 元数据
Cloudflare R2                 音频对象
```

主要目录：

```text
src/App.tsx                   众包采集页
src/AdminPage.tsx             审核与管理后台
worker/src/index.ts           Worker API
schema.sql                    新项目数据库结构
migrations/0002_multivariety.sql
                              从旧阳江话版本迁移到多语言版本
scripts/export-dataset.mjs    下载训练数据集
public/_worker.js             Pages 到 Worker 的同域代理
```

## 本地运行

需要 Node.js 20+。

```bash
npm install
npm run dev
```

另开一个终端运行 Worker：

```bash
npm run dev:worker
```

前端默认在本地访问 `http://localhost:8787` 的 API。也可以通过 `VITE_API_BASE_URL` 指定其他地址。

初始化本地 D1：

```bash
npm run db:migrate:local
```

构建：

```bash
npm run build
```

## 部署到 Cloudflare

先创建：

- 一个 D1 database；
- 一个 R2 bucket；
- 一个 Pages 项目。

然后把 `wrangler.toml` 里的占位符替换成自己的资源。

初始化远端数据库：

```bash
npm run db:migrate:remote
```

设置后台管理员令牌：

```bash
printf '%s' '你的管理员令牌' | npx wrangler secret put ADMIN_TOKEN --config wrangler.toml
```

如果希望保存不可逆的 IP 哈希用于基本的滥用分析，还可以额外设置一个随机盐：

```bash
printf '%s' '一段随机字符串' | npx wrangler secret put IP_HASH_SALT --config wrangler.toml
```

不设置 `IP_HASH_SALT` 时，系统不会保存 IP 哈希。

部署 Worker：

```bash
npm run deploy:worker
```

再把 Worker 的主机名写入 Pages 环境变量 `API_HOST`，然后构建并部署 Pages：

```bash
npm run build
npm run deploy:pages
```

`public/_worker.js` 会把前端的 `/api/*` 请求代理到 Worker，这样浏览器只需要访问 Pages 域名。

## 从旧阳江话版本升级

如果你用过这个项目最早的单一阳江话数据库，不要重新执行 `schema.sql` 覆盖旧数据，执行一次：

```bash
npm run db:migrate:v2:remote
```

迁移会创建 `varieties`，把原有语料归入阳江话，补齐录音的 variety 和匿名 speaker 字段，同时明确把旧录音训练授权设为关闭。建议正式执行前先备份 D1。

## 导出 ASR / TTS 数据

后台 `/admin` 可以直接下载训练 manifest。

如果希望把音频一起拉到本地：

```bash
node scripts/export-dataset.mjs \
  --api https://your-pages-domain.example \
  --token "$ADMIN_TOKEN" \
  --task asr \
  --out ./dataset-asr
```

只导出某一种家乡话：

```bash
node scripts/export-dataset.mjs \
  --api https://your-pages-domain.example \
  --token "$ADMIN_TOKEN" \
  --variety 1 \
  --task tts \
  --out ./dataset-tts
```

也可以使用环境变量 `DIALECTSEED_API_URL` 和 `DIALECTSEED_ADMIN_TOKEN`，避免把令牌写进 shell history。

少于 10 个说话人时，脚本不会硬切验证集和测试集，而是全部放进 train，避免小数据集被切得失去意义。

## 关于授权

语音数据不是普通的文本数据。声音可能包含身份信息、年龄、地区特征和其他个人特征，所以这里刻意把“保存这段乡音”和“拿它训练模型”拆成两个选择。

这个仓库只提供技术上的授权记录机制。真正公开数据集或训练模型前，维护者仍然需要根据自己的地区、参与者构成和发布方式，制定清楚的数据许可、撤回机制、未成年人政策和隐私说明。

## 为什么叫 DialectSeed

一条录音不会保存一种语言。

但如果每个地方都有人愿意留下第一批干净、可说明来源、可继续扩展的数据，它至少是一颗种子。

这个项目从阳江话开始，希望最后不只属于阳江。

## License

代码使用 [MIT License](LICENSE)。

语音、文本和其他用户贡献数据的许可应由实际部署者单独声明；**代码许可证不自动等于数据许可证**。
