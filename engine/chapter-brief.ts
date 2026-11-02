/**
 * Chapter Brief — 章节写作简报
 *
 * 作用：把「规划阶段」的成果（大纲摘要 / Scene展开 / 情绪规划 / 信息规划）
 * 收敛成协同写作可直接消费的结构化输入，解决两个问题：
 * 1. 进入协同写作后界面看不到规划成果；
 * 2. 提示词把 Scene 展开整段截断，AI 拿不到当前场景的 8 要素。
 *
 * 纯函数模块：不依赖 Obsidian / AI，可直接单测。
 */

import { splitSceneSections } from './scene-expander';
import { countWords } from '../shared/diff-utils';

/** 单个场景的写作简报 */
export interface BriefScene {
    index: number;
    name: string;
    objective: string;
    conflict: string;
    sensoryHook: string;
    memoryTrigger: string;
    bodyReaction: string;
    subtext: string;
    relationshipShift: string;
    keyScene: string;
    dialogueFunction: string;
    cliffhanger: string;
    /** 情绪起点（来自情绪规划） */
    emotionStart: string;
    /** 情绪终点（来自情绪规划） */
    emotionEnd: string;
    /** 情绪变化量（来自情绪规划） */
    emotionDelta: string;
    /** 预估字数（来自 Scene 展开） */
    wordCountEstimate: number;
}

/** 章节写作简报 */
export interface ChapterBrief {
    scenes: BriefScene[];
    /** 当前应写的场景下标（0-based）；无场景时为 -1 */
    currentIndex: number;
    currentScene: BriefScene | null;
    /** 后续场景（不含当前） */
    otherScenes: BriefScene[];
    /** 本章大纲摘要 */
    outlineSummary: string;
    /** 信息释放计划 */
    infoRelease: string;
    /** 已写正文字数 */
    writtenWords: number;
}

/** 章节简报的原始输入 */
export interface ChapterBriefInput {
    sceneExpansion?: string;
    emotionPlan?: string;
    infoPlan?: string;
    outline?: string;
    bodyText?: string;
}

/**
 * 读取场景块中的单行字段（兼容 `字段：值`、`**字段**：值`、`- **字段**：值`）
 *
 * @param block - 文本块
 * @param keys - 键列表
 * @returns 文本结果
 */
function readField(block: string, keys: string[]): string {
    for (const key of keys) {
        const m = block.match(new RegExp(`^\\s*(?:[-*]\\s*)?\\*{0,2}\\s*${key}\\s*\\*{0,2}\\s*[：:]\\s*(.+)$`, 'im'));
        if (m) return m[1].trim();
    }
    return '';
}

/**
 * 情绪值只保留主句，避免把整段描述塞进简报
 *
 * @param value - 值
 * @returns 文本结果
 */
function shortEmotion(value: string): string {
    if (!value) return '';
    const head = value.split(/[—-]/)[0].trim();
    return (head || value.trim()).slice(0, 40);
}

/**
 * 解析 Scene 展开（8 要素 + 预估字数）
 *
 * @param sceneExpansion - 场景扩写
 * @returns 结果数组
 */
function parseBriefScenes(sceneExpansion: string): BriefScene[] {
    const scenes: BriefScene[] = [];
    for (const { heading, body } of splitSceneSections(sceneExpansion)) {
        const wordRaw = readField(body, ['word_count', '预估字数']);
        // Scene 展开通常带 emotion_arc（起点 → 终点），情绪规划缺失时作为兜底
        const arc = readField(body, ['emotion_arc']);
        const [arcStart = '', arcEnd = ''] = arc.split('→').map(s => s.trim());
        scenes.push({
            index: heading.index,
            name: heading.name,
            objective: readField(body, ['objective']),
            conflict: readField(body, ['conflict']),
            sensoryHook: readField(body, ['sensory_hook']),
            memoryTrigger: readField(body, ['memory_trigger']),
            bodyReaction: readField(body, ['body_reaction']),
            subtext: readField(body, ['subtext']),
            relationshipShift: readField(body, ['relationship_shift']),
            keyScene: readField(body, ['key_scene']),
            dialogueFunction: readField(body, ['dialogue_function']),
            cliffhanger: readField(body, ['cliffhanger', 'chapter_hook']),
            emotionStart: shortEmotion(arcStart),
            emotionEnd: shortEmotion(arcEnd),
            emotionDelta: '',
            wordCountEstimate: parseInt(wordRaw, 10) || 0,
        });
    }
    return scenes;
}

/**
 * 把情绪规划合并进场景（按场景序号对齐；缺失字段不覆盖已有值）
 *
 * @param scenes - 场景列表
 * @param emotionPlan - 情绪规划
 */
function mergeEmotionPlan(scenes: BriefScene[], emotionPlan: string): void {
    if (!emotionPlan || scenes.length === 0) return;
    const byIndex = new Map<number, BriefScene>();
    scenes.forEach(s => byIndex.set(s.index, s));

    for (const { heading, body } of splitSceneSections(emotionPlan)) {
        const target = byIndex.get(heading.index) ?? scenes[heading.index - 1];
        if (!target) continue;
        const start = readField(body, ['emotion_start']);
        const end = readField(body, ['emotion_end']);
        const delta = readField(body, ['emotion_delta']);
        if (start) target.emotionStart = shortEmotion(start);
        if (end) target.emotionEnd = shortEmotion(end);
        if (delta) target.emotionDelta = delta;
    }
}

/**
 * 提取信息规划中的「信息释放计划」，缺失时退回正文前 800 字
 *
 * @param infoPlan - 信息计划
 * @returns 文本结果
 */
function extractInfoRelease(infoPlan: string): string {
    if (!infoPlan) return '';
    const start = infoPlan.search(/^##\s*(?:信息释放计划|信息释放)/m);
    if (start >= 0) {
        const rest = infoPlan.slice(start).replace(/^##[^\n]*\n?/, '');
        const next = rest.search(/^##\s/m);
        const text = (next >= 0 ? rest.slice(0, next) : rest).trim();
        if (text) return text.slice(0, 800);
    }
    return infoPlan.trim().slice(0, 800);
}

/**
 * 根据已写字数推断当前场景。
 * 有预估字数时按累计预算定位；没有预算时按 1500 字/场 粗略推进。
 * @param scenes - 场景列表
 * @param writtenWords - 已写字数
 * @returns 数值结果
 */
export function resolveSceneIndex(scenes: BriefScene[], writtenWords: number): number {
    if (scenes.length === 0) return -1;
    if (writtenWords <= 0) return 0;

    const totalBudget = scenes.reduce((sum, s) => sum + Math.max(0, s.wordCountEstimate), 0);
    if (totalBudget > 0) {
        let acc = 0;
        for (let i = 0; i < scenes.length; i++) {
            acc += Math.max(0, scenes[i].wordCountEstimate);
            if (writtenWords < acc) return i;
        }
        return scenes.length - 1;
    }

    return Math.min(scenes.length - 1, Math.floor(writtenWords / 1500));
}

/**
 * 去掉 YAML frontmatter；未闭合时原样返回，避免吞掉正文
 *
 * @param text - 文本内容
 * @returns 文本结果
 */
function stripFrontmatter(text: string): string {
    if (!text) return '';
    const m = text.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    return m ? text.slice(m[0].length).trim() : text.trim();
}

/**
 * 构建章节写作简报（纯函数）
 *
 * @param input - 输入
  * @returns ChapterBrief 实例
 */
export function buildChapterBrief(input: ChapterBriefInput): ChapterBrief {
    const bodyText = input.bodyText || '';
    const writtenWords = countWords(bodyText);
    const scenes = parseBriefScenes(stripFrontmatter(input.sceneExpansion || ''));
    mergeEmotionPlan(scenes, stripFrontmatter(input.emotionPlan || ''));

    const currentIndex = resolveSceneIndex(scenes, writtenWords);
    const currentScene = currentIndex >= 0 ? scenes[currentIndex] : null;

    return {
        scenes,
        currentIndex,
        currentScene,
        otherScenes: scenes.filter((_, i) => i !== currentIndex),
        outlineSummary: stripFrontmatter(input.outline || '').slice(0, 1200),
        infoRelease: extractInfoRelease(stripFrontmatter(input.infoPlan || '')),
        writtenWords,
    };
}

/**
 * 是否存在可用于冷启动的规划成果
 *
 * @param brief - 简报
 * @returns 是否成功
 */
export function hasUsablePlanning(brief: ChapterBrief | null): boolean {
    if (!brief) return false;
    return brief.scenes.length > 0 || brief.outlineSummary.length > 0;
}

/**
 * 未写正文时，是否能从规划直接开始（空正文冷启动）
 *
 * @param brief - 简报
 * @param hasText - 是否含文本
 * @returns 是否成功
 */
export function canStartFromBrief(brief: ChapterBrief | null, hasText: boolean): boolean {
    if (hasText) return true;
    return hasUsablePlanning(brief);
}

/**
 * 生成注入提示词的「本章简报」片段。
 * 当前场景完整注入（8 要素 + 情绪），其余场景只给一行方向，避免整段截断。
 * @param brief - 简报
 * @returns 结果数组
 */
export function buildBriefPromptParts(brief: ChapterBrief | null): string[] {
    if (!brief || !brief.currentScene) return [];
    const s = brief.currentScene;
    const parts: string[] = [];

    parts.push(`【本章写作简报】共 ${brief.scenes.length} 场，当前写第 ${brief.currentIndex + 1} 场（${s.name || '未命名'}）`);
    if (brief.outlineSummary) {
        parts.push('【本章大纲】', brief.outlineSummary, '');
    }

    parts.push('【当前场景设计——必须落地，不得跳过】');
    parts.push(`场景：${s.name || '未命名'}`);
    if (s.objective) parts.push(`objective（角色目的）：${s.objective}`);
    if (s.conflict) parts.push(`conflict（核心冲突）：${s.conflict}`);
    if (s.sensoryHook) parts.push(`sensory_hook（感官钩子）：${s.sensoryHook}`);
    if (s.memoryTrigger) parts.push(`memory_trigger（记忆触发）：${s.memoryTrigger}`);
    if (s.bodyReaction) parts.push(`body_reaction（身体反应）：${s.bodyReaction}`);
    if (s.subtext) parts.push(`subtext（潜台词）：${s.subtext}`);
    if (s.relationshipShift) parts.push(`relationship_shift（关系变化）：${s.relationshipShift}`);
    if (s.keyScene) parts.push(`key_scene（名场面）：${s.keyScene}`);
    if (s.dialogueFunction) parts.push(`dialogue_function（对话功能）：${s.dialogueFunction}`);
    if (s.emotionStart || s.emotionEnd) {
        parts.push(`情绪曲线：${s.emotionStart || '—'} → ${s.emotionEnd || '—'}${s.emotionDelta ? `（${s.emotionDelta}）` : ''}`);
    }
    if (s.cliffhanger) parts.push(`chapter_hook（本章结尾钩子）：${s.cliffhanger}`);
    parts.push('');

    if (brief.infoRelease) {
        parts.push('【本章信息释放计划（只释放这里列出的信息，不要提前剧透）】', brief.infoRelease, '');
    }

    if (brief.otherScenes.length > 0) {
        parts.push('【后续场景（只作方向，不要把后面的内容提前写完）】');
        for (const o of brief.otherScenes) {
            const hint = o.objective || o.conflict || '';
            parts.push(`第${o.index}场 ${o.name}${hint ? `：${hint.slice(0, 80)}` : ''}`);
        }
        parts.push('');
    }

    return parts;
}

/**
 * 实体摘要格式化（人物 / 势力 / 地点 / 物品共用）。
 *
 * 实体文件使用中文字段（姓名/名称、人物背景/描述、当前状态），
 * 旧实现只读 name/description/state，导致提示词里的实体总览几乎为空。
 * @param list - 列表
 * @param options - 配置项
 * @returns 文本结果
 */
export function formatEntityBrief(
    list: unknown,
    options: { maxItems?: number; maxChars?: number } = {}
): string {
    if (!Array.isArray(list) || list.length === 0) return '';
    const maxItems = options.maxItems ?? 12;
    const maxChars = options.maxChars ?? 3000;

    const lines: string[] = [];
    for (const raw of list.slice(0, maxItems)) {
        if (!raw || typeof raw !== 'object') continue;
        const e = raw as Record<string, unknown>;
        const pick = (...keys: string[]): string => {
            for (const key of keys) {
                const v = e[key];
                if (typeof v === 'string' && v.trim()) return v.trim();
            }
            return '';
        };
        const name = pick('姓名', '名称', 'name', '标题', 'title');
        if (!name) continue;

        const identity = pick('身份', '类型', '别称');
        const background = pick('人物背景', '描述', '简介', 'description');
        const state = pick('当前状态', 'status', 'state');
        const tags = Array.isArray(e.tags) ? e.tags.filter(t => typeof t === 'string').join('、') : '';

        const detail = [identity, background, state].filter(Boolean).join('；');
        lines.push(`${name}${tags ? `（${tags}）` : ''}：${detail}`);
    }

    return lines.join('\n').slice(0, maxChars);
}
