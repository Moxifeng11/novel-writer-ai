import { App, TFile } from 'obsidian';
import {
    pjBodyTemplate,
    pjInfoPlanTemplate,
    pjPlotDistillTemplate,
    pjOutlineTemplate,
    pjVolumeOutlineTemplate,
    pjWorldviewTemplate,
    pjAnalysisTemplate,
    pjSettlementTemplate,
    pjCharTemplate,
    pjLocTemplate,
    pjFactionTemplate,
    pjItemTemplate,
    pjContinuityReviewTemplate,
    pjSelfCheckTemplate,
    pjFixTemplate,
    pjFinalFixTemplate,
    pjQualityControlTemplate,
    pjEmotionPlanTemplate,
    pjSceneExpandTemplate,
    pjCharacterSoulTemplate,
    pjPromptSystemTemplate,
    pjPromptUserTemplate,
    pjWritingRulesPromptTemplate,
} from '../shared/paths';
import { CHAPTER_FILE_TYPES } from './chapter-utils';
import {
    getStepTemplate,
    type PromptTemplate,
} from './prompt-templates';
import { RulesService } from '../services/rules-service';
import { createLogger } from '../shared/logger';


const log = createLogger('TemplateService');

/** 已告警过的模板路径，避免每次读取都刷屏 */
const warnedTemplatePaths = new Set<string>();

/**
 * 模板变量。
 */
export interface TemplateVariables {
    project?: string;
    volume?: string;
    chapterName?: string;
    chapterNumber?: number;
    title?: string;
    /** v4.18：创作模式；缺省按 long 兼容 */
    creationMode?: 'long' | 'short' | 'script';
    unitLabel?: string;
}

const DEFAULT_TEMPLATES: Record<string, string> = {
    body: `---
tags: [正文, nw/正文]
卷: ""
章: ""
标题: ""
status: pending
word_count: 0
writing_mode: pipeline
涉及人物: []
涉及地点: []
涉及势力: []
涉及物品功法: []
---

# 第X章

`,
    infoPlan: `---
tags: [信息规划, nw/步骤/信息规划]
卷: ""
章: ""
step_status: pending
step_model: ""
step_timestamp: ""
情感温度: ""
冲突强度: ""
节奏节拍: ""
---

# 第X章 信息规划

## 章名

## 核心冲突

## 情感与冲突量化
- 情感温度（0-10级）：
- 冲突强度阶梯（1-5级）：
- 节奏节拍模式：

## 熵预算
- 本章需解决的不确定性（降熵）：
- 本章新增的不确定性（提熵）：
- 预计章末信息熵水平：高/中/低

## 自信息目标
- 本章至少设计一个低概率但合理的事件（惊喜）：
  - 事件描述：
  - 为何合理：

## 互信息强化
- 必须强化的设定关联（行为-动机/伏笔-主线）：
- 禁止出现的互信息断裂（OOC行为）：

## 伏笔操作
- 需回收的旧伏笔：
- 需埋下的新伏笔：
`,
    plotDistill: `---
tags: [情节蒸馏, nw/步骤/情节蒸馏]
卷: ""
章: ""
step_status: pending
step_model: ""
step_timestamp: ""
---

# 第X章 情节蒸馏

## 场景节奏设计
- 起（铺垫）：
- 承（发展）：
- 转（转折）：
- 合（收尾）：

## 情节节点规划（3-5个）
- 节点1：
- 节点2：
- 节点3：
- 节点4：（可选）
- 节点5：（可选）

## 爽点设计
- 核心爽点：
- 爽点类型：逆袭/打脸/成长/揭秘/情感爆发
- 铺垫方式：

## 冲突升级路径
- 初始状态：
- 升级点1：
- 升级点2：
- 高潮点：
- 回落/悬念：

## 信息密度指标
- 预计章节字数：
- 情节节点密度：每千字≥1个节点
- 信息增量：高/中/低
`,
    outline: `---
tags: [大纲摘要, nw/步骤/大纲摘要]
卷: ""
章: ""
step_status: pending
step_model: ""
step_timestamp: ""
---

# 第X章 大纲摘要

## 全书定位
- 本章处于全书 [开端/发展/转折/高潮/收尾] 阶段
- 负责推进：
- 负责揭示：
- 负责铺垫：

## 关键场景（3-5个）
| # | 地点 | 人物 | 冲突 | 叙事目标 | 信息增量 |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |
| 4 | | | | | |

## 结尾钩子
- 钩子类型：悬念式/反转式/预告式/前置冲突
- 钩子内容：
`,
    continuityReview: `---
tags: [审查报告, nw/步骤/审查报告]
卷: ""
章: ""
step_status: pending
step_model: ""
step_timestamp: ""
审查时间: ""
审查范围: 单章
---

# 第X章 连贯性审查

> 待执行「连贯性审查」步骤后生成
`,
    analysisReport: `---
tags: [分析报告, nw/步骤/分析报告]
卷: ""
章: ""
step_status: pending
step_model: ""
step_timestamp: ""
---

# 第X章 分析报告

> 待执行「分析报告」步骤后生成
`,
    settlement: `---
tags: [结算表, nw/步骤/结算表]
卷: ""
章: ""
step_status: pending
step_model: ""
step_timestamp: ""
---

# 第X章 结算表

> 待执行「结算」步骤后生成
`,
    selfCheck: `---
tags: [自检报告, nw/步骤/自检报告]
卷: ""
章: ""
step_status: pending
step_model: ""
step_timestamp: ""
---

# 第X章 自检报告

> 待执行「自检」步骤后生成
`,
    fix: `---
tags: [修正记录, nw/步骤/修正记录]
卷: ""
章: ""
step_status: pending
step_model: ""
step_timestamp: ""
---

# 第X章 修正记录

> 待执行「修正」步骤后生成
`,
    finalFix: `---
tags: [最终修正, nw/步骤/最终修正]
卷: ""
章: ""
step_status: pending
step_model: ""
step_timestamp: ""
---

# 第X章 最终修正

> 待执行「最终修正」步骤后生成
`,
    emotionPlan: `---
tags: [情绪规划, nw/步骤/情绪规划]
卷: ""
章: ""
step_status: pending
step_model: ""
step_timestamp: ""
---

# 第X章 情绪规划

> 待执行「情绪规划」步骤后生成
`,
    sceneExpand: `---
tags: [Scene展开, nw/步骤/Scene展开]
卷: ""
章: ""
step_status: pending
step_model: ""
step_timestamp: ""
---

# 第X章 Scene展开

> 待执行「Scene展开」步骤后生成
`,
    characterSoul: `---
tags: [角色灵魂, nw/步骤/角色灵魂]
卷: ""
章: ""
step_status: pending
step_model: ""
step_timestamp: ""
---

# 第X章 角色灵魂

> 待执行「角色灵魂」步骤后生成
`,
    qualityControl: `---
tags: [质量控制, nw/步骤/质量控制]
卷: ""
章: ""
step_status: pending
step_model: ""
step_timestamp: ""
---

# 第X章 质量控制

> 待执行「质量控制」步骤后生成
`,
    volumeOutline: `---
tags: [分卷大纲, nw/步骤/分卷大纲]
卷数: ""
卷名: ""
状态: draft
---

# 第X卷 分卷大纲

## 卷概要
- 本卷核心冲突：
- 本卷情感弧线：
- 本卷结局：

## 章节规划

| # | 章节 | 核心冲突 | 一句话概要 | 字数预估 |
|---|---|---|---|---|
| 1 | | | | |

## 跨章伏笔
- 埋设：
- 揭示：
`,
    worldview: `---
tags: [世界观, nw/设定/世界观]
世界名称: ""
项目名称: ""
---

# 世界观总览

## 世界层级体系
- 层级数量：
- 各层级概要：

## 力量体系
- 修炼体系名称：
- 境界划分：
- 力量来源：

## 地理格局
- 地理概要：
- 重要区域：

## 特殊规则
- 世界法则：
- 禁忌/限制：
`,
    character: `---
tags: [人物, nw/实体/人物]
姓名: ""
年龄: ""
身份: ""
性别: ""
首次出场: ""
entity_status: active
entity_created_at: ""
entity_last_changed_at: ""
entity_last_changed_reason: ""
外貌特征: ""
性格标签: ""
核心动机: ""
当前状态: ""
当前位置: ""
---

# {{Name}}

## 确定性设定
- 外貌：
- 核心性格：
- 关键背景：

## 不确定性
- 内心矛盾：
- 成长弧光：

## 关系网

## 变更记录
`,
    location: `---
tags: [地点, nw/实体/地点]
名称: ""
别称: ""
类型: ""
描述: ""
重要程度: ""
地理特征: ""
主要居民/势力: ""
所在世界/区域: ""
entity_status: active
entity_created_at: ""
entity_last_changed_at: ""
entity_last_changed_reason: ""
---

# {{Name}}

## 确定性设定
- 地理特征：
- 气候：
- 主要居民/势力：

## 不确定性
- 隐藏秘密：
- 潜在危机：
`,
    faction: `---
tags: [势力, nw/实体/势力]
名称: ""
别称: ""
类型: ""
描述: ""
领袖: ""
地位/排名: ""
entity_status: active
entity_created_at: ""
entity_last_changed_at: ""
entity_last_changed_reason: ""
---

# {{Name}}

## 确定性设定
- 领袖：
- 核心成员：
- 层级体系：

## 不确定性
- 隐藏目的：
- 潜在冲突：
`,
    item: `---
tags: [物品功法, nw/实体/物品]
名称: ""
类型: ""
描述: ""
效果: ""
品阶/等级: ""
所属/归属: ""
entity_status: active
entity_created_at: ""
entity_last_changed_at: ""
entity_last_changed_reason: ""
---

# {{Name}}

## 确定性设定
- 外观/形态：
- 特性：
- 主要用途：

## 不确定性
- 隐藏能力：
- 来历：
`,
};

const TEMPLATE_PATH_MAP: Record<string, () => string> = {
    body: pjBodyTemplate,
    infoPlan: pjInfoPlanTemplate,
    plotDistill: pjPlotDistillTemplate,
    outline: pjOutlineTemplate,
    volumeOutline: pjVolumeOutlineTemplate,
    worldview: pjWorldviewTemplate,
    analysisReport: pjAnalysisTemplate,
    settlement: pjSettlementTemplate,
    character: pjCharTemplate,
    location: pjLocTemplate,
    faction: pjFactionTemplate,
    item: pjItemTemplate,
    continuityReview: pjContinuityReviewTemplate,
    selfCheck: pjSelfCheckTemplate,
    fix: pjFixTemplate,
    finalFix: pjFinalFixTemplate,
    qualityControl: pjQualityControlTemplate,
    emotionPlan: pjEmotionPlanTemplate,
    sceneExpand: pjSceneExpandTemplate,
    characterSoul: pjCharacterSoulTemplate,
};

/**
 * 模板服务（步骤/正文/世界观等）。
 */
export class TemplateService {
    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * 按类型取模板。
     *
     * @param type - 参数
     * @param vars - 参数
     * @returns 模板文本
     */
    async getTemplate(type: string, vars: TemplateVariables = {}): Promise<string> {
        const templatePathFn = TEMPLATE_PATH_MAP[type];
        let content = DEFAULT_TEMPLATES[type] || '';

        if (templatePathFn) {
            const path = templatePathFn();
            const templateFile = this.app.vault.getAbstractFileByPath(path);
            if (templateFile instanceof TFile) {
                try {
                    content = await this.app.vault.read(templateFile);
                } catch (e) {
                    this.warnOnce(path, '[TemplateService] 读取模板失败，使用默认模板:', e);
                }
            } else {
                this.warnOnce(path, '[TemplateService] 模板文件不存在，使用默认模板:');
            }
        }

        return this.replaceVariables(content, vars);
    }

    /** 同一路径只告警一次，避免缺模板时日志刷屏 */
    private warnOnce(path: string, message: string, error?: unknown): void {
        if (warnedTemplatePaths.has(path)) return;
        warnedTemplatePaths.add(path);
        if (error !== undefined) {
            log.warn(message, path, error);
        } else {
            log.warn(message, path);
        }
    }

    private replaceVariables(content: string, vars: TemplateVariables): string {
        let result = content;

        const chapterName = vars.chapterName || `第${vars.chapterNumber || 'X'}章`;
        const chapterNumber = vars.chapterNumber;

        result = result.replace(/第X章/g, chapterName);
        result = result.replace(/卷: ""/g, `卷: "${vars.volume || ''}"`);
        result = result.replace(/章: ""/g, `章: "${chapterName}"`);
        result = result.replace(/标题: ""/g, `标题: "${vars.title || ''}"`);

        if (chapterNumber !== undefined) {
            result = result.replace(/章节编号:/g, `章节编号: ${chapterNumber}`);
            result = result.replace(/本卷章:/g, `本卷章: ${vars.volume || ''}${chapterName}`);
        }

        return result;
    }

    /**
     * 取正文模板。
     *
     * @param vars - 参数
     * @returns 模板文本
     */
    async getBodyTemplate(vars: TemplateVariables): Promise<string> {
        const mode = vars.creationMode || 'long';
        if (mode === 'short' || mode === 'script') {
            const unit = mode === 'script' ? '集' : '节';
            const displayName = (vars.chapterName || `第${vars.chapterNumber || 'X'}章`)
                .replace(/第(\d+)章/, (_m, n) => `第${n}${unit}`);
            if (mode === 'script') {
                return `---
tags: [剧本, nw/正文]
卷: "${vars.volume || '第1卷'}"
章: "${vars.chapterName || ''}"
标题: ""
status: pending
word_count: 0
writing_mode: pipeline
涉及人物: []
涉及地点: []
涉及势力: []
涉及物品功法: []
---

# ${displayName}

## 基本信息
- 类型：
- 单集时长：
- 本集核心冲突：
- 本集爽点/反转：
- 结尾钩子：

## 场次

### 1-1 日/内 场景名
人物：
△动作/画面：

角色：（情绪）对白

（VO/字幕：）
`;
            }
            return `---
tags: [短篇正文, nw/正文]
卷: "${vars.volume || '第1卷'}"
章: "${vars.chapterName || ''}"
标题: ""
status: pending
word_count: 0
writing_mode: pipeline
涉及人物: []
涉及地点: []
涉及势力: []
涉及物品功法: []
---

# ${displayName}

## 本节目标
- 核心冲突：
- 信息推进：
- 情绪转折：
- 结尾钩子：

正文：
`;
        }
        return this.getTemplate('body', vars);
    }

    /**
     * 取信息规划模板。
     *
     * @param vars - 参数
     * @returns 模板文本
     */
    async getInfoPlanTemplate(vars: TemplateVariables): Promise<string> {
        return this.getTemplate('infoPlan', vars);
    }

    /**
     * 取情节提炼模板。
     *
     * @param vars - 参数
     * @returns 模板文本
     */
    async getPlotDistillTemplate(vars: TemplateVariables): Promise<string> {
        return this.getTemplate('plotDistill', vars);
    }

    /**
     * 取章纲模板。
     *
     * @param vars - 参数
     * @returns 模板文本
     */
    async getOutlineTemplate(vars: TemplateVariables): Promise<string> {
        return this.getTemplate('outline', vars);
    }

    /**
     * 按步骤类型取模板。
     *
     * @param stepType - 参数
     * @param vars - 参数
     * @returns 模板文本
     */
    async getStepTemplate(stepType: string, vars: TemplateVariables): Promise<string> {
        return this.getTemplate(stepType, vars);
    }

    /**
     * 取分卷大纲模板。
     *
     * @param vars - 参数
     * @returns 模板文本
     */
    async getVolumeOutlineTemplate(vars: TemplateVariables): Promise<string> {
        return this.getTemplate('volumeOutline', vars);
    }

    /**
     * 取世界观模板。
     *
     * @param vars - 参数
     * @returns 模板文本
     */
    async getWorldviewTemplate(vars: TemplateVariables): Promise<string> {
        return this.getTemplate('worldview', vars);
    }

    /**
     * 取步骤提示词。
     *
     * @param stepKey - 参数
     * @returns 模板或 null
     */
    async getStepPrompt(stepKey: string): Promise<PromptTemplate | null> {
        const systemPath = pjPromptSystemTemplate(stepKey);
        const userPath = pjPromptUserTemplate(stepKey);

        const defaultTemplate = getStepTemplate(stepKey);
        let systemPrompt = defaultTemplate?.systemPrompt || '';
        let userPrompt = defaultTemplate?.userPrompt || '';
        const description = defaultTemplate?.description || '';

        const systemFile = this.app.vault.getAbstractFileByPath(systemPath);
        if (systemFile instanceof TFile) {
            try {
                systemPrompt = await this.app.vault.read(systemFile);
            } catch (e) {
                log.warn('[TemplateService] 读取 system prompt 模板失败，使用默认模板:', systemPath, e);
            }
        }

        const userFile = this.app.vault.getAbstractFileByPath(userPath);
        if (userFile instanceof TFile) {
            try {
                userPrompt = await this.app.vault.read(userFile);
            } catch (e) {
                log.warn('[TemplateService] 读取 user prompt 模板失败，使用默认模板:', userPath, e);
            }
        }

        if (!systemPrompt && !userPrompt) {
            return null;
        }

        return { description, systemPrompt, userPrompt };
    }

    /**
     * 取写作规则文本。
     * @returns 规则文本
     */
    async getWritingRules(): Promise<string> {
        return RulesService.getInstance(this.app).getWritingRules();
    }

    /**
     * 是否有自定义提示词。
     *
     * @param stepKey - 参数
     * @returns 布尔值
     */
    async hasCustomPrompt(stepKey: string): Promise<boolean> {
        const systemPath = pjPromptSystemTemplate(stepKey);
        const userPath = pjPromptUserTemplate(stepKey);
        return !!(this.app.vault.getAbstractFileByPath(systemPath) ||
                   this.app.vault.getAbstractFileByPath(userPath));
    }

    /**
     * 获取任意类型的自定义 prompt 模板（世界观/实体/DEAI 等）
     * @param promptKey prompt 类型标识（如 worldviewSkeleton, character, deaiCheck 等）
     * @param fallback 默认值（当无自定义模板时使用）
     * @returns 自定义模板内容，如果不存在则返回 fallback
     */
    async getCustomPrompt(promptKey: string, fallback: { system?: string; user?: string } = {}): Promise<{ system: string; user: string }> {
        const systemPath = pjPromptSystemTemplate(promptKey);
        const userPath = pjPromptUserTemplate(promptKey);

        let systemPrompt = fallback.system || '';
        let userPrompt = fallback.user || '';

        const systemFile = this.app.vault.getAbstractFileByPath(systemPath);
        if (systemFile instanceof TFile) {
            try {
                systemPrompt = await this.app.vault.read(systemFile);
            } catch (e) {
                log.warn('[TemplateService] 读取自定义 prompt 失败:', systemPath, e);
            }
        }

        const userFile = this.app.vault.getAbstractFileByPath(userPath);
        if (userFile instanceof TFile) {
            try {
                userPrompt = await this.app.vault.read(userFile);
            } catch (e) {
                log.warn('[TemplateService] 读取自定义 prompt 失败:', userPath, e);
            }
        }

        return { system: systemPrompt, user: userPrompt };
    }
}