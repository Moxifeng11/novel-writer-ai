/**
 * step-validator.ts — 步骤完整性结构化校验
 *
 * v6.0: 替代字节数模糊匹配，基于内容结构判断步骤是否完整。
 * 每个步骤对应一个校验函数，返回四级状态。
 *
 * 四级状态：
 *   empty     — 空/无内容
 *   skeleton  — 只有模板骨架，未实际生成
 *   partial   — 有部分内容，但缺少必填模块（进行中）
 *   complete  — 所有必填模块齐全（已走完）
 */

import { validateEmotionPlan } from './emotion-planner';
import { validateSceneExpansion } from './scene-expander';

export type StepLevel = 'empty' | 'skeleton' | 'partial' | 'complete';

export type StepValidationResult = {
    valid: boolean;       // 是否达到"走完"标准（= complete）
    missing: string[];    // 缺失的必填模块
    score: number;        // 完整度 0-100
    level: StepLevel;
};

type StepValidator = (content: string) => StepValidationResult;

// ============================================================
// v6.1: 内容实质校验工具函数
// ============================================================

/**
 * 提取指定标题（Markdown ## 或 ### 级）后的内容块，直到下一个同级或更高级标题。
 * 返回空字符串表示没找到标题或标题后无内容。
 */
function extractSectionAfterHeading(content: string, headingPattern: RegExp): string {
    const lines = content.split('\n');
    let startIdx = -1;
    let headingLevel = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (headingPattern.test(line)) {
            const m = line.match(/^(#{1,6})\s+/);
            headingLevel = m ? m[1].length : 2;
            startIdx = i + 1;
            break;
        }
    }

    if (startIdx < 0) return '';

    const levelPrefix = '#'.repeat(headingLevel);
    const sectionLines: string[] = [];
    for (let i = startIdx; i < lines.length; i++) {
        const line = lines[i];
        if (new RegExp(`^${levelPrefix}[#]*\\s+`).test(line.trim())) break;
        sectionLines.push(line);
    }

    return sectionLines.join('\n').trim();
}

/**
 * 判断文本是否有实质性内容：
 * - 去除空白后长度 >= minChars
 * - 不是纯占位符（待补充、待定、省略号等）
 * - 键值对格式时，值不能为空
 */
function hasMeaningfulContent(text: string, minChars = 15): boolean {
    const clean = text.replace(/\s+/g, '').trim();
    if (clean.length < minChars) return false;
    if (/^(待补充|待定|暂无|无|略|\.\.\.|…)+$/.test(clean)) return false;
    if (clean.replace(/[-*:：#\s|]/g, '').length < minChars * 0.3) return false;
    return true;
}

/**
 * 检查某个标题下是否有实质内容（组合版，一步到位）
 */
function sectionContentValid(content: string, headingPattern: RegExp, minChars = 20): boolean {
    const section = extractSectionAfterHeading(content, headingPattern);
    return hasMeaningfulContent(section, minChars);
}

/**
 * 构造校验结果
 * @param found 已满足的必填项数量
 * @param total 必填项总数
 * @param missing 缺失的必填项名称
 * @param extraBonus 额外加分（可选加分项）
 */
function makeResult(
    found: number,
    total: number,
    missing: string[],
    extraBonus = 0,
): StepValidationResult {
    const baseScore = total > 0 ? Math.round((found / total) * 70) : 0;
    const score = Math.min(100, baseScore + extraBonus);

    let level: StepLevel = 'empty';
    if (found === total && score >= 85) {
        level = 'complete';
    } else if (found > 0 || score >= 30) {
        level = 'partial';
    } else if (score > 0) {
        level = 'skeleton';
    }

    return {
        valid: level === 'complete',
        missing,
        score,
        level,
    };
}

// ============================================================
// 各步骤校验器
// ============================================================

/**
 * 信息规划校验
 * 必填：章名与核心冲突 / 情感温度+冲突强度 / 熵预算与自信息 / 伏笔操作
 * v6.1: 从标题存在校验升级为内容实质校验
 */
function validateInfoPlan(content: string): StepValidationResult {
    const required = [
        { key: '章名与核心冲突', check: () => sectionContentValid(content, /##\s*(章名与核心冲突|核心冲突)/, 20) || /核心冲突[：:].{10,}/.test(content) },
        { key: '情感温度', check: () => sectionContentValid(content, /##\s*(情感温度|情感与冲突量化)/, 15) || /情感温度[：:].{5,}/.test(content) },
        { key: '冲突强度', check: () => /冲突强度[：:].{5,}/.test(content) || /冲突强度阶梯[：:].{5,}/.test(content) },
        { key: '熵预算与自信息', check: () => sectionContentValid(content, /##\s*(熵预算|熵预算与自信息|自信息)/, 20) || /(熵预算|自信息)[：:].{10,}/.test(content) },
        { key: '伏笔操作', check: () => sectionContentValid(content, /##\s*伏笔操作/, 15) || /伏笔操作[：:].{5,}/.test(content) },
    ];

    const missing: string[] = [];
    let found = 0;
    for (const r of required) {
        if (r.check()) found++;
        else missing.push(r.key);
    }

    const sceneCount = (content.match(/第[一二三四五六七八九十\d]+[场景幕]|##\s+scene|场景\s*\d/gi) || []).length;
    const extra = sceneCount >= 3 ? 15 : sceneCount * 5;

    return makeResult(found, required.length, missing, extra);
}

/**
 * 情节蒸馏校验
 * 必填：主线情节 / 关键转折 / 情感线 / 至少3个场景
 * v6.1: 从标题存在校验升级为内容实质校验
 */
function validatePlotDistill(content: string): StepValidationResult {
    const required = [
        { key: '主线情节', check: () => sectionContentValid(content, /##\s*(主线|主要情节|情节(脉络|线))/, 30) || /主线(情节)?[：:].{20,}/.test(content) },
        { key: '关键转折', check: () => sectionContentValid(content, /##\s*(转折|关键(事件|节点))/, 20) || /(关键转折|转折点)[：:].{15,}/.test(content) },
        { key: '情感线', check: () => sectionContentValid(content, /##\s*(情感|情绪|心理)/, 20) || /情感(线)?[：:].{15,}/.test(content) },
    ];

    const missing: string[] = [];
    let found = 0;
    for (const r of required) {
        if (r.check()) found++;
        else missing.push(r.key);
    }

    const sceneCount = (content.match(/第[一二三四五六七八九十\d]+[场景幕]|##\s+scene|场景\s*\d/gi) || []).length;
    const extra = sceneCount >= 3 ? 20 : sceneCount * 6;

    return makeResult(found, required.length, missing, extra);
}

/**
 * 大纲摘要校验
 * 必填：全书定位 / 至少3个场景 / 结尾钩子
 * v6.1: 从标题存在校验升级为内容实质校验
 */
function validateOutline(content: string): StepValidationResult {
    const required = [
        { key: '全书定位', check: () => sectionContentValid(content, /##\s*全书定位/, 20) || /全书定位[：:].{15,}/.test(content) },
        { key: '关键场景', check: () => sectionContentValid(content, /##\s*(关键场景|场景)/, 30) || /(关键场景|场景列表)[：:].{20,}/.test(content) },
        { key: '结尾钩子', check: () => sectionContentValid(content, /##\s*(钩子|结尾(钩子)?|悬念|反转|结尾悬念)/, 15) || /(结尾钩子|悬念|反转)[：:].{10,}/.test(content) },
    ];

    const missing: string[] = [];
    let found = 0;
    for (const r of required) {
        if (r.check()) found++;
        else missing.push(r.key);
    }

    const sceneCount = (content.match(/##\s+scene|第[一二三四五六七八九十\d]+[场景幕]|场景\s*\d/gi) || []).length;
    const hasLocations = /地点|场景.+地点/.test(content);
    const hasChars = /人物|出场人物/.test(content);
    const extra = (sceneCount >= 3 ? 10 : 0) + (hasLocations ? 5 : 0) + (hasChars ? 5 : 0);

    return makeResult(found, required.length, missing, extra);
}

/**
 * 角色灵魂提取校验
 * 必填：主角欲望/动机 / 主角恐惧/创伤 / 主角道德边界 / 至少1个配角核心
 * v6.1: 从标题存在校验升级为内容实质校验
 */
function validateCharacterSoul(content: string): StepValidationResult {
    const required = [
        { key: '主角欲望/动机', check: () => /(欲望|核心动机|核心驱动力)[：:].{5,}/.test(content) || sectionContentValid(content, /##\s*(欲望|动机|核心驱动力)/, 15) },
        { key: '主角恐惧/创伤', check: () => /(恐惧|创伤|软肋|心理阴影)[：:].{5,}/.test(content) || sectionContentValid(content, /##\s*(恐惧|创伤|软肋)/, 15) },
        { key: '主角道德边界', check: () => /(道德|底线|原则)[：:].{5,}/.test(content) || sectionContentValid(content, /##\s*(道德|底线|原则)/, 15) },
    ];

    const missing: string[] = [];
    let found = 0;
    for (const r of required) {
        if (r.check()) found++;
        else missing.push(r.key);
    }

    const charCount = (content.match(/[-:：]\s*\S+[：:]/g) || []).length;
    const extra = charCount >= 2 ? 10 : 0;

    return makeResult(found, required.length, missing, extra);
}

/**
 * 情绪规划校验（复用引擎层校验）
 */
function validateEmotionPlanWrapper(content: string): StepValidationResult {
    const result = validateEmotionPlan(content);
    if (result.valid) {
        return { valid: true, missing: [], score: 92, level: 'complete' };
    }

    const sceneCount = (content.match(/###\s+scene\d+:/gi) || []).length;
    const hasOverall = /总体情绪曲线|开篇情绪/.test(content);
    const found = (hasOverall ? 1 : 0) + Math.min(sceneCount, 2);
    const total = 3;

    return makeResult(found, total, result.errors);
}

/**
 * Scene展开校验（复用引擎层校验）
 */
function validateSceneExpandWrapper(content: string): StepValidationResult {
    const result = validateSceneExpansion(content);
    if (result.valid) {
        return { valid: true, missing: [], score: 92, level: 'complete' };
    }

    const sceneCount = (content.match(/##\s+scene\d+:/gi) || []).length;
    const total = 3;
    const found = Math.min(sceneCount, total);

    return makeResult(found, total, result.errors);
}

/**
 * 正文生成校验
 * 必填：字数达标（>=70%目标）/ 有开头 / 有对话 / 有结尾
 */
function validateBodyGeneration(content: string, minWords = 2100): StepValidationResult {
    const pureText = content.replace(/^---[\s\S]*?---/, '').trim();
    const wordCount = pureText.length;

    const required = [
        { key: '字数达标', pattern: wordCount >= minWords ? /./ : /^$/, desc: `${wordCount}/${minWords}字` },
        { key: '章节开头', pattern: /^#|^第.+章|^\s*第.+节/ },
        { key: '对话描写', pattern: /[""「」].+[""」」]/ },
        { key: '完整结尾', pattern: /。\s*$|…\s*$|！\s*$|？\s*$/ },
    ];

    const missing: string[] = [];
    let found = 0;
    for (const r of required) {
        if (r.pattern.test(pureText)) found++;
        else missing.push(r.key);
    }

    const wordRatio = Math.min(1, wordCount / minWords);
    const score = Math.round(wordRatio * 50) + Math.round((found / required.length) * 40) + 5;

    let level: StepLevel = 'empty';
    if (found === required.length && wordCount >= minWords) {
        level = 'complete';
    } else if (wordCount > 500 || found >= 2) {
        level = 'partial';
    } else if (wordCount > 0) {
        level = 'skeleton';
    }

    return {
        valid: level === 'complete',
        missing,
        score: Math.min(100, score),
        level,
    };
}

/**
 * 审查类步骤校验（分析报告等）
 * 必填：问题列表（至少1个问题或明确无问题）/ 总结评价
 */
function validateAuditStep(content: string): StepValidationResult {
    const hasIssues = /问题|缺陷|不足|错误|❌|⚠️|需修正/.test(content);
    const hasNoIssueConfirm = /无问题|合格|通过|整体良好|未发现/.test(content);
    const hasConclusion = /总结|结论|评价|整体|建议|改进方向/.test(content);
    const hasDetail = /第.+节|场景\d|问题\s*\d|#/.test(content);

    const required = [
        { key: '问题分析', found: hasIssues || hasNoIssueConfirm },
        { key: '总结评价', found: hasConclusion },
        { key: '具体细节', found: hasDetail },
    ];

    const missing: string[] = [];
    let found = 0;
    for (const r of required) {
        if (r.found) found++;
        else missing.push(r.key);
    }

    return makeResult(found, required.length, missing, hasIssues ? 10 : 0);
}

/**
 * v6.0: 三合一质量控制校验（写作技法检查 + 连贯性审查 + 质量评估）
 * 必填：三大板块标题 / 修改建议汇总 / 检查项结论
 * v6.1: 从标题存在校验升级为内容实质校验
 */
function validateQualityControlMerged(content: string): StepValidationResult {
    const sections = [
        { key: '写作技法检查', check: () => sectionContentValid(content, /##\s*(写作技法|AI自检|技法检查)/, 40) },
        { key: '连贯性审查', check: () => sectionContentValid(content, /##\s*(连贯性审查|连贯性|设定冲突|人物OOC)/, 40) },
        { key: '质量评估', check: () => sectionContentValid(content, /##\s*(质量评估|质量控制|大纲偏离|信息密度)/, 40) },
    ];
    const hasSuggestions = /(修改建议|建议汇总|改进建议)[：:].{10,}/.test(content) || sectionContentValid(content, /##\s*(修改建议|改进建议)/, 20);
    const hasCheckmarks = /[✅❌⚠️]/.test(content) || /(通过|问题|待改进)[：:]/.test(content);

    let found = 0;
    const missing: string[] = [];
    for (const s of sections) {
        if (s.check()) found++;
        else missing.push(s.key);
    }

    const extra = (hasSuggestions ? 10 : 0) + (hasCheckmarks ? 10 : 0);
    return makeResult(found, sections.length, missing, extra);
}

/**
 * 修正类步骤校验（fix / finalFix）
 * 必填：字数达标 / 有对话 / 结构完整
 */
function validateFixStep(content: string): StepValidationResult {
    const pureText = content.replace(/^---[\s\S]*?---/, '').trim();
    const wordCount = pureText.length;

    const required = [
        { key: '字数达标（>=2000）', pattern: wordCount >= 2000 ? /./ : /^$/ },
        { key: '对话描写', pattern: /[""「」]/.test(pureText) },
        { key: '叙事完整', pattern: /。/.test(pureText) && pureText.length > 500 },
    ];

    const missing: string[] = [];
    let found = 0;
    for (const r of required) {
        if (r.pattern) found++;
        else missing.push(r.key);
    }

    const score = Math.min(100, Math.round((wordCount / 3000) * 60) + (found / required.length) * 35);

    let level: StepLevel = 'empty';
    if (found === required.length) {
        level = 'complete';
    } else if (wordCount > 500 || found >= 1) {
        level = 'partial';
    } else if (wordCount > 0) {
        level = 'skeleton';
    }

    return { valid: level === 'complete', missing, score, level };
}

// ============================================================
// 校验器注册表
// ============================================================

// v6.0: selfCheck / continuityCheck 已合并入 qualityControl，不再作为独立步骤
const STEP_VALIDATORS: Record<string, StepValidator> = {
    infoPlan: validateInfoPlan,
    plotDistill: validatePlotDistill,
    outline: validateOutline,
    characterSoul: validateCharacterSoul,
    emotionPlan: validateEmotionPlanWrapper,
    sceneExpand: validateSceneExpandWrapper,
    bodyGeneration: (c) => validateBodyGeneration(c, 2100),
    fix: validateFixStep,
    finalFix: validateFixStep,
    qualityControl: validateQualityControlMerged,
    analysisReport: validateAuditStep,
};

/**
 * 校验步骤内容完整性
 * @param stepKey 步骤 key
 * @param content 步骤内容（纯正文，不含 frontmatter）
 */
export function validateStepResult(stepKey: string, content: string): StepValidationResult {
    const validator = STEP_VALIDATORS[stepKey];
    if (!validator) {
        const len = content.trim().length;
        if (len > 500) {
            return { valid: true, missing: [], score: 80, level: 'complete' };
        }
        if (len > 100) {
            return { valid: false, missing: ['内容不足'], score: 40, level: 'partial' };
        }
        if (len > 0) {
            return { valid: false, missing: ['内容过短'], score: 15, level: 'skeleton' };
        }
        return { valid: false, missing: ['无内容'], score: 0, level: 'empty' };
    }
    return validator(content);
}

/**
 * 判断是否为模板骨架（未实际生成内容）
 */
export function isTemplateSkeleton(content: string, stepKey?: string): boolean {
    if (!content || content.trim().length < 30) return true;
    if (content.includes('（待 auto_writer') || content.includes('（待定）')) return true;
    if (stepKey === 'outline' && content.trim().length < 80) return true;
    return false;
}
