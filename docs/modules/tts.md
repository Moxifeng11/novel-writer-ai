# 章节朗读（TTS · 听校）

> 状态：stable（功能缺口 ⑥ 交付 2026-11-18）　｜　最后更新：2026-11-18　｜　Owner：dsh

## 1. 定位

- **用户视角**：写久了眼睛累，想让系统把当前章念出来边听边校——点命令面板「🎧 听校：朗读当前章」，
  右下角出现播放条，逐句朗读并高亮正文里的当前句；可暂停/上一句/下一句/停止，可调语速、
  选系统音色；也可以只选一段文字朗读选段。
- **代码入口**
  - 命令 id：`shared/command-ids.ts:89-93`（`TTS_READ_CHAPTER = 'novel-writer-tts-read-chapter'`、
    `TTS_READ_SELECTION`、`TTS_STOP`）
  - 命令注册：`core/command-registry.ts:576-578`（COMMANDS 表 `:164-166`、`uiCommandIds` `:384-386`），
    组 `CommandGroup.Tools`、`callback: exec(...)`（不设模式守卫，三种创作域都可用）
  - 执行体：`ui/command-ui-executor.ts:688-706` 的 `ttsReadChapter` / `ttsReadSelection`，
    取编辑器走 `:681 resolveEditor(editor?)`（缺省回落 `getActiveViewOfType(MarkdownView)`）
  - 播放条：`ui/tts/tts-player.ts`（427 行）——`TtsPlayer`、单例 `getTtsPlayer(app, plugin)`、
    测试用 `resetTtsPlayerForTests()`
  - 语音引擎：`ui/tts/tts-speech.ts`（163 行）——`createTtsSpeechEngine(synth?)`，
    把 `speechSynthesis` / `SpeechSynthesisUtterance` 全包在 try/catch 里
  - 断句清洗：`shared/tts-text.ts`（261 行）——`frontmatterEndOffset` / `cleanForSpeech` / `splitSentences` /
    `clampRate` / `estimateSpeechMs` / `TTS_RATE_OPTIONS = [0.75, 1, 1.25, 1.5, 2]`
  - 样式：`styles-src/44-tts-player.css`（127 行，命名空间 `.nw-tts-*`，全部用 Obsidian CSS 变量）
- **相关数据**
  - 持久化只有两项设置（`main.ts` 的 `NovelWriterSettings`）：`ttsRate?: number`（默认 `1`）、
    `ttsVoice?: string`（默认 `''` = 系统默认）；默认值在 `core/settings-service.ts` 的 `getDefaultSettings()`
  - 不落盘任何朗读记录/进度；章节内容每次从编辑器现取

## 2. 现状（事实，不写愿望）

- **断句**：`splitSentences(text, { from, to, maxChars: 120 })` 先跳过 frontmatter
  （`frontmatterEndOffset` 只认文件开头的 `---\n…\n---\n`，支持 CRLF），再按句末标点 `。！？…；!?;`
  与「非数字后的 `.`」切句，换行是软边界；引号/括号收尾符（`”’」』）)】》`）并入前句；
  超过 120 字的句子优先在 `，、,` 处切，切不动才硬切；清洗后为空的片段丢弃，过短残句并入上一句。
- **清洗**（`cleanForSpeech`）：图片整段丢弃；行内代码去反引号、双链取别名（`[[路径|别名]]` → 别名）、
  链接取文字、去 HTML 标签 / 标题井号 / 引用符 / 列表符 / 分隔线 / 强调号 / 零宽字符，最后压空白。
  代码块**没有**整段跳过——按行处理，围栏行会被当普通文本念（见 §7）。
- **播放条**：`document.body` 上的固定浮层 `.nw-tts-bar.nw-scope`（右下角，`bottom:24px;right:24px`），
  结构 = 头部（`🎧 听校 · <标题>` + 进度 `1/1417`）+ 控制排（⏮ ⏸ ⏭ ⏹ ✕）+ 下拉排（语速 / 音色）。
  不打断编辑器焦点：按钮是 `<button type="button">`，点击后不抢输入。
- **逐句调度**：每次 `speakCurrent()` 用当前 `session` 号包住回调，`onEnd` 走 `goTo(cursor + 1)`，
  `onError` 提示一次后同样跳下一句（单句失败不整章中断）；最后一句话说完就 `finish()` —— 收条 +
  `Notice(t('tts.finished'))`。`stop()` / `destroy()` 会 `engine.cancel()`、退订 `voiceschanged`、`root.remove()`。
- **高亮**：`highlight(sentence)`（`ui/tts/tts-player.ts:250-262`）用编辑器原生选区
  `editor.setSelection(from, to)` + `scrollIntoView({from,to}, true)`，坐标由 `offsetToPos` 换算
  （编辑器不支持时退化为从选区起点逐字符数换行）。代价：朗读期间选区被播放条占用。
  编辑器已随文件关闭时 `setSelection` 抛错 → `stop()`，避免对着看不见的文本继续念。
- **语速/音色**：下拉变化立刻写 `plugin.settings.ttsRate/ttsVoice` 并 `await plugin.saveSettings()`，
  下一次 `speak` 生效（不重启当前句）。音色列表来自 `speechSynthesis.getVoices()`；
  **实测 Obsidian 1.15.1 / Windows 首次调用返回空数组**，必须监听 `voiceschanged` 再填，
  且空列表时下拉仍有「系统默认」一项（不能以「没有音色」判不支持）。
- **不支持平台**：`createTtsSpeechEngine` 在 `synth` 或 `SpeechSynthesisUtterance` 缺失时
  `isSupported() === false`，播放条不创建，命令给 `t('tts.unsupported')` 警告。
- **空内容**：整章清洗后无句子 → `t('tts.noText')` 警告；选段为空 → `t('tts.noEditor')` 之外的
  `noText` 分支（空选区由 `playSelection` 直接返回）。
- **i18n**：播放条 18 条文案全部走 `t('tts.*')`（`i18n/messages/{zh-CN,en-US}.ts`，两份资源各 60 条）；
  实测切换 `language: 'en-US'` 后条内显示 `🎧 Listen & proofread` / `System default`。
  **命令面板里的命令名仍是硬编码中文**（`core/command-registry.ts` 的 `COMMANDS` 表，属 i18n 第二期）。

## 3. 问题清单

| 编号 | 级别 | 现象 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| TTS-01 | — | 全仓 `speechSynthesis` 0 引用，写完只能看 | 逐句朗读 + 高亮 + 控制条 | done（2026-11-18） |
| TTS-02 | P2 | 整章丢给 `speechSynthesis` 会「长文本提前 onend」，且无法高亮 | 先断句，逐句 `speak` | done |
| TTS-03 | P2 | 章节开头有几十行 frontmatter/JSON 会被念出来 | `frontmatterEndOffset` 跳过 | done |
| TTS-04 | P2 | 音色列表首调为空（Chromium 异步加载） | `voiceschanged` 回填 + 「系统默认」兜底 | done |
| TTS-05 | P3 | 播放条浮层遮挡正文右下角 | 右下角 24px，实测与状态栏留 29px 间隙 | done（见 §5） |
| TTS-06 | P3 | 朗读时占用用户选区 | 接受（不引 CodeMirror 装饰器） | 已知取舍 |

## 4. 关键决策

- **逐句朗读，不整章丢给引擎**：中文长文本在 Chromium 里会提前触发 `onend`；
  且只有逐句才知道「现在念到哪」，才能高亮。
- **高亮用原生选区而非 CodeMirror 装饰器**：`setSelection` 是 `Editor` 公开 API，跨 Obsidian 版本稳；
  装饰器需要 `cm` 内部结构，升级易碎。代价是朗读期间选区被占用——停止后不恢复原选区（文档 §7 记为可改进）。
- **播放条挂 `document.body` 而不进侧栏/设置页**：用户朗读时盯着正文，条子只需浮在右下；
  关闭正文（`setSelection` 抛错）就停。
- **`session` 号丢弃迟到回调**：`stop` → 立刻再 `play` 时，上一句的 `onEnd` 可能晚到；
  每次 `start/stop` 自增 `session`，回调里先比对。单测「停止后迟到 onEnd 不推进」锁定。
- **不判「音色为空 = 不支持」**：实机探针 `voiceCount: 0` 但 `speak()` 的 `onstart/onend` 都触发
  （见 `D:/nw-tmp/probe-tts.json`）；用 `isSupported()` 只看构造器存在性。
- **设置写回走 `plugin.saveSettings()` 而非内存**：语速/音色是长期偏好，重开 Obsidian 应保留；
  下拉变化时先算 `next` 再 `await`，失败也先把 UI 值改掉（与既有设置项一致）。
- **`.nw-scope` 前缀 + 显式过渡属性**：`transition: border-color .15s ease, background-color .15s ease`，
  不写 `transition: all`（`tests/unit/ui/panel-resizer-and-motion.test.ts:108` 硬断言）。

## 5. 验收记录

| 日期 | 操作 | 结果 | 证据 |
| --- | --- | --- | --- |
| 2026-11-18 | 实机章节模式（Obsidian 1.15.1 / Windows，1,003,133 字 / 40,546 行、frontmatter 39,092 行的样例文件） | 播放条出现、`1/1417` 句、`speechSynthesis.speaking === true`；高亮选区 `# 将夜 - 人设提取报告\n`（14 字）落在第 39,094 行 = frontmatter 之后第一行；点⏭ → `2/1417` | `D:\nw-dev-vault\_visual-tts\bar-playing.png`、`bar-next.png`（419×123）、`probe.json` |
| 2026-11-18 | 语速下拉改 1.5× | `plugin.settings.ttsRate === 1.5`、`saveSettings` 已调用；重开进程后下拉仍 1.5× | `_visual-tts\bar-rate.png`、`probe.json` |
| 2026-11-18 | 语言切 en-US | 条内 `🎧 Listen & proofread · <标题>` / `System default` / `1/1417`；下拉 6 个 Microsoft 音色（Huihui/Kangkang/Yaoyao/Mark/Zira/David） | 同上（首次启动 voices 为空，`voiceschanged` 后补齐） |
| 2026-11-18 | 实机选段模式（2,340 字小文件，选中 80 字） | 标题 `🎧 听校 · 选段`、进度 `1/4`、高亮 = 选中段第一句、`speaking === true`；停止后条消失 | `_visual-tts\zh-bar-selection.png`（423×127）、`zh-window-selection.png`（1280×900）、`probe-selection.json` |
| 2026-11-18 | 暂停/恢复 | 按钮 `⏸ → ▶`、`speechSynthesis.paused === true`；再点回 `⏸`、`paused === false`（Chromium 暂停时 `speaking` 仍为 true，不能拿它判暂停） | `paused.png`、`probe-tts-pause` 输出 |
| 2026-11-18 | 几何 | 条 `y=737.6 h=106.4 → bottom=844`，状态栏 `y=873.2 h=26.8`，间隙 29px，无遮挡 | 同上 |
| 2026-11-18 | 门禁 | typecheck / lint / preflight 全绿（见 §6 与提交信息） | preflight EXIT=0 |

## 6. 测试清单

- `tests/unit/shared/tts-text.test.ts`（19）：frontmatter（含 CRLF / 缺失 / 偏移越界）、清洗各记号、
  `splitSentences` 连续覆盖 / 引号收尾 / 换行软边界 / 英文句点与版本号 / 超长句按逗号 / 硬切 / 区间起点、
  `clampRate`（非法 → 1，夹 0.5–2）、`estimateSpeechMs`。
- `tests/unit/ui/tts-speech.test.ts`（10）：缺构造器 → 不支持、空音色仍算支持、`getVoices` 抛错 → `[]`、
  utterance 属性写入、`voiceUri` 找不到回系统默认、`speak` 抛错 → `onError`、pause/resume/cancel 吞错、
  `voiceschanged` 订阅与退订。
- `tests/unit/ui/tts-player.test.ts`（13）：frontmatter 后断句 + 高亮坐标、进度 1/3、自动续读与读完收条、
  单句出错续读、暂停/恢复、下一句、末句收条、停止退订、选段标题「选段」、空选区/空文本/不支持不建条、
  语速下拉 0.75×–2× 写回设置、音色空 → 仅「系统默认」、有音色 → 保存 `voiceURI`。
- 命令注册：`tests/unit/core/command-registry.test.ts` 的 `EXPECTED_REGISTERED_IDS` 含 3 个 TTS id（总数 101）。
- 辅助库：`tests/unit/ui/support/fake-dom.ts` 的 `FakeEl` 增加 `parent` + 原生 `remove()`
  （播放条 `stop()/finish()` 调 `root.remove()`，旧替身没有）。

## 7. 剩余 backlog（P2/P3）

- [ ] 代码块（``` 围栏）应整段跳过而不是逐行朗读；表格竖线、HTML 属性残留也会被念。
- [ ] `estimateSpeechMs` 目前只有单测，未接 UI；若要「预估剩余时长」，用它算总时长并显示。
- [ ] `lang` 固定 `'zh-CN'`（`ui/tts/tts-player.ts:209`）：读英文书/中文音色不匹配时发音怪；
      应按 `voice.lang` 或当前语言设置推导。
- [ ] 停止后不恢复用户原选区；`stop()` 里记录 `previousSelection` 即可复原。
- [ ] 只看章标题取 `basename`；若用户朗读的是非章节文件（如设定文档），标题显示文件名属预期。
- [ ] 命令面板里的「🎧 听校：…」三条仍是硬编码中文（i18n 第二期统一迁）。

## 8. 交接备注

- **必须先 `npm run build` 并确认 dev vault 里的 `main.js` 时间戳**：`scripts/dev-vault.mjs` 默认
  vault 是 `C:\Users\admin\nw-dev-vault`，而视觉验收用的是 `D:\nw-dev-vault`；
  两边不同步，实测踩过「命令没注册」的假象。做法：`Copy-Item main.js,styles.css,manifest.json,versions.json <D 盘插件目录> -Force`。
- **CDP 里命令 id 要带插件前缀**：`app.commands.executeCommandById('novel-writer-ai:novel-writer-tts-read-chapter')`；
  只写 `novel-writer-tts-read-chapter` 会静默失败（`commands` 表里没有该键）。
- **CDP 里 `window.require('obsidian')` 不可用**：取编辑器用
  `app.workspace.getLeavesOfType('markdown')` 找 `view.file.path` 匹配的活动叶子，别用 `MarkdownView` 类。
- **别用 `speechSynthesis.speaking` 判暂停**：Chromium 暂停时它仍是 true，只有 `paused` 会变。
- **音色首调为空是常态**：等 `voiceschanged`；探针脚本里要 `await` 一段时间再读下拉。
- 播放条 DOM 类：`.nw-tts-bar`、`.nw-tts-bar-head/-title/-progress`、`.nw-tts-btn-play`（暂停按钮就是它，
  不是 `btn-pause`）、`.nw-tts-rate`、`.nw-tts-voice`。
