/**
 * example-project-service.ts — 最小示例项目导入（FR-C-06）
 *
 * 目的：让新用户在空 vault 中一键得到一个可浏览、可继续写作的完整项目骨架：
 * 1 卷 3 章 + 1 个人物 + 1 条伏笔。全部内容为静态示例，不调用 AI。
 */

import { App } from 'obsidian';
import { ensureTemplateScaffold } from '../shared/template-scaffold';

export const EXAMPLE_PROJECT_NAME = '示例项目';

interface ExampleFile {
    path: string;
    content: string;
}

const CHAPTER_FILES: ExampleFile[] = [
    {
        path: '03-大纲与章节/正文/第1卷/第1章_正文.md',
        content: `---
标题: 初入山门
tags: [正文, nw/正文]
---

# 第一章 初入山门

山门在雾里，像一把竖着的剑。

林昭把断剑从背上解下来，放在石阶前。守门的老道士睁开一只眼，看了剑，又看了她。

“这剑，不吉利。”老道士说。

“我知道。”林昭说。

她拾起剑，继续往上走。雾在她身后合拢，把来路一并收走了。
`,
    },
    {
        path: '03-大纲与章节/正文/第1卷/第2章_正文.md',
        content: `---
标题: 藏经阁的灯
tags: [正文, nw/正文]
---

# 第二章 藏经阁的灯

藏经阁的灯亮了三十年，从没有人见它灭过。

林昭在第三层找到那本没有书名的册子。翻开第一页，只有一行字：断剑归鞘之日，山门重开。

她合上册子，听见楼下有人上楼。脚步很轻，却每一步都踩在她的心跳上。
`,
    },
    {
        path: '03-大纲与章节/正文/第1卷/第3章_正文.md',
        content: `---
标题: 剑鸣
tags: [正文, nw/正文]
---

# 第三章 剑鸣

断剑在鞘里响了一声。

不是风。林昭握紧剑柄，看见山门方向升起一道白光。老道士站在光里，像是等了很久。

“你终于来了。”他说。

林昭忽然明白，这本书里写的不是故事，是她的名字。
`,
    },
];

const EXAMPLE_FILES: ExampleFile[] = [
    {
        path: '.project',
        content: `# ${EXAMPLE_PROJECT_NAME}

## 题材
仙侠

## 类型
original

## 描述
用于验证安装与理解流程的最小示例项目：1 卷 3 章 + 1 个人物 + 1 条伏笔。所有内容均为静态示例，可自由修改或删除。
`,
    },
    {
        path: '01-世界架构/世界观总览.md',
        content: `---
tags: [世界观, nw/设定/世界观]
---

# 世界观总览

## 一句话设定
一座建在剑冢上的山门，以“断剑”为信物，守着一条无人敢走的登天路。

## 地理
- 山门：建在剑冢之上，终年有雾。
- 藏经阁：山门最高处，共七层，第三层从不对弟子开放。

## 规则
- 断剑归鞘之日，山门重开。
- 弟子不得在雾中回头。
`,
    },
    {
        path: '01-世界架构/人物/林昭.md',
        content: `---
tags: [人物, nw/实体/人物]
姓名: 林昭
年龄: 17
身份: 主角
性别: 女
首次出场: 第1章
entity_status: active
entity_created_at: 第1章
entity_last_changed_at: ""
entity_last_changed_reason: ""
外貌特征: 眉眼很淡，背一把断剑
性格标签: 克制、执拗、不肯欠人情
习惯性小动作: 思考时用拇指摩挲剑柄缺口
金手指/特殊能力: 能听见断剑的鸣声
所属势力: 山门（外门弟子）
核心动机: 查明断剑的来历与自己的身世
核心驱动力_软肋: 害怕被留在雾里
当前状态: 初入山门
当前情绪: 警惕
当前位置: 山门石阶
character_core:
  desire: 找到断剑归鞘的方法
  fear: 被证实自己只是剑的容器
  obsession: 断剑上的铭文
  shame: 曾丢下同伴独自逃命
  trauma: 雾中走失的那一夜
  weakness: 不肯求助
  soft_spot: 对老人和孩子心软
  rage_trigger: 有人拿断剑要挟她
  moral_boundary: 不杀已放下武器的人
---

# 林昭

## 确定性设定
- 外貌：眉眼很淡，常年背一把没有鞘的断剑。
- 核心性格：克制，执拗，认死理。
- 关键背景：七岁那年在雾中走失，醒来时手里攥着断剑。

## 不确定性
- 内心矛盾：想知道身世，又怕答案否定“自己”。
- 隐藏秘密：她能听懂断剑的鸣声。
- 成长弧光：从独自硬撑，到学会把后背交给同伴。

## 关系网
- [[老道士]]：守门人，似乎认识断剑。
`,
    },
    {
        path: '02-时间线与伏笔/伏笔库.md',
        content: `---
tags:
  - 伏笔库
---

# 伏笔库

## 未回收伏笔

| # | 伏笔名称 | 重要程度 | 埋设章节 | 计划回收 | 相关人物 | 关联主线 | 当前状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 断剑上的铭文 | 高 | 第1章 | 第3章 | 林昭 | 身世主线 | 已回收 |

## 已回收伏笔

| # | 伏笔名称 | 重要程度 | 埋设章节 | 相关人物 | 关联主线 | 回收章节 | 回收方式 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 断剑上的铭文 | 高 | 第1章 | 林昭 | 身世主线 | 第3章 | 藏经阁无名册子揭示 |
`,
    },
    {
        path: '03-大纲与章节/分卷大纲/第1卷_分卷大纲.md',
        content: `---
tags: [大纲]
---

# 全书规划 & 分卷大纲

## 全书总览
- **总字数目标**：9000
- **总章节数**：3
- **分卷数**：1
- **每章字数**：2500-3000 字

## 伏笔布局规划

| 伏笔名 | 伏笔简述 | 埋入章 | 暗示章 | 揭示章 | 关联人物 | 关联主线 |
|--------|---------|--------|--------|--------|----------|----------|
| 断剑上的铭文 | 铭文指向林昭的身世 | 第1章 | 第2章 | 第3章 | 林昭 | 身世主线 |

## 分卷大纲

### 第1卷
- **卷名**：《雾中山门》
- **章节范围**：第1章 - 第3章
- **核心冲突**：林昭想弄清断剑来历，山门却试图让她留下。
- **主要事件**：入门、进入藏经阁、断剑鸣响。
- **人物弧光**：从独自硬撑到第一次向他人求证。
- **本卷字数**：约 9000
- **本卷高潮**：第3章断剑鸣响，老道士揭示等待。
- **结尾过渡**：身世线索指向山门之外。
- **章节分配**：

| 章号 | 核心冲突 |
|------|---------|
| 1 | 林昭带着断剑入山门 |
| 2 | 藏经阁中发现无名册子 |
| 3 | 断剑鸣响，身份线索浮现 |
`,
    },
    {
        path: '03-大纲与章节/步骤结果/第1卷/第1章/第1章_大纲摘要.md',
        content: `---
tags: [步骤结果, 大纲摘要, nw/步骤/大纲摘要]
---

# 第1章 大纲摘要

- **核心事件**：林昭带着断剑来到山门，被守门老道士注意。
- **冲突**：山门规矩要求缴械，林昭拒绝放下断剑。
- **信息增量**：断剑没有鞘；老道士认识这把剑。
- **结尾钩子**：老道士放她进门，却说她“来早了”。
`,
    },
    {
        path: '03-大纲与章节/步骤结果/第1卷/第1章/第1章_信息规划.md',
        content: `---
tags: [步骤结果, 信息规划, nw/步骤/信息规划]
---

# 第1章 信息规划

| 信息 | 读者是否可知 | 林昭是否可知 | 释放方式 |
|---|---|---|---|
| 断剑没有鞘 | 是 | 是 | 动作描写 |
| 老道士认识断剑 | 是 | 否 | 对话暗示 |
| 断剑会鸣响 | 否 | 是 | 第3章揭示 |
`,
    },
    ...CHAPTER_FILES,
];

async function ensureDir(app: App, dir: string): Promise<void> {
    const adapter = app.vault.adapter;
    const segments = dir.split('/').filter(Boolean);
    let current = '';
    for (const segment of segments) {
        current = current ? `${current}/${segment}` : segment;
        if (!(await adapter.exists(current))) {
            await adapter.mkdir(current);
        }
    }
}

export interface ImportExampleResult {
    created: boolean;
    project: string;
}

/**
 * 在 vault 根目录创建最小示例项目。
 * 已存在时不覆盖，直接返回 created=false（避免覆盖用户改动）。
 */
export async function importExampleProject(app: App): Promise<ImportExampleResult> {
    const project = EXAMPLE_PROJECT_NAME;
    const adapter = app.vault.adapter;

    if (await adapter.exists(project)) {
        return { created: false, project };
    }

    // 后续步骤需要元文件模板；失败不影响示例导入
    await ensureTemplateScaffold(app).catch(() => undefined);

    const dirs = new Set<string>();
    for (const file of EXAMPLE_FILES) {
        const fullPath = `${project}/${file.path}`;
        const parent = fullPath.substring(0, fullPath.lastIndexOf('/'));
        dirs.add(parent);
    }
    const sortedDirs = [...dirs].sort((a, b) => a.split('/').length - b.split('/').length);
    for (const dir of sortedDirs) {
        await ensureDir(app, dir);
    }

    for (const file of EXAMPLE_FILES) {
        await adapter.write(`${project}/${file.path}`, file.content);
    }

    return { created: true, project };
}
