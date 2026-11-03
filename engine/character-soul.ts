/**
 * Character Soul Engine — V2 角色灵魂层
 * 
 * 从角色MD文件的 character_core YAML嵌套字段中提取灵魂层，
 * 压缩为 prompt 友好的文本注入正文生成。
 * 
 * soul 层包含9个字段：desire/fear/obsession/shame/trauma/weakness/soft_spot/rage_trigger/moral_boundary
 */

import { TFile, Vault } from 'obsidian';
import { CHARACTER_SOUL_FIELDS } from '@/shared/format-constants';

/** 角色灵魂层数据 */
export interface CharacterSoul {
    name: string;        // 角色名
    desire: string;      // 最想得到什么
    fear: string;        // 最害怕什么
    obsession: string;   // 最执着什么
    shame: string;       // 最羞耻经历
    trauma: string;      // 最大创伤
    weakness: string;    // 致命弱点
    soft_spot: string;   // 最容易被触动的对象
    rage_trigger: string;// 什么事情会让其失控
    moral_boundary: string; // 底线
    hasSoul: boolean;    // 是否成功提取到完整soul（9字段全有值）
}

/** 压缩后的角色灵魂层文本（用于注入prompt） */
export interface CharacterSoulSummary {
    protagonist: CharacterSoul | null;  // 主角灵魂层
    allSouls: string;                   // 全量灵魂层压缩文本（≤300 tokens/人）
    hasSoulData: boolean;               // 是否至少有一个角色有完整soul
}

/**
 * 从 Markdown 文本中提取 character_core YAML 嵌套字段
 * 支持两种格式：
 *   1. YAML 嵌套（推荐）：character_core:\n  desire: xxx\n  fear: xxx
 *   2. 顶级扁平（回退）：desire: xxx（从 frontmatter 中独立提取）
 * @param content - 内容
  * @returns Partial<CharacterSoul> 实例
 */
function parseCharacterCore(content: string): Partial<CharacterSoul> {
    const soul: Record<string, string> = {};

    // 提取 YAML frontmatter 区块
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return soul as Partial<CharacterSoul>;

    const fm = fmMatch[1];

    // 方案1：YAML 嵌套格式 character_core: desire: xxx
    const coreBlock = fm.match(/character_core:\s*\n([\s\S]*?)(?=\n\S|$)/);
    if (coreBlock) {
        for (const field of CHARACTER_SOUL_FIELDS) {
            const re = new RegExp(`^\\s{2}${field}:\\s*(.+)$`, 'm');
            const m = coreBlock[1].match(re);
            if (m) soul[field] = m[1].trim();
        }
    }

    // 方案2：回退——顶级扁平字段（旧格式兼容）
    for (const field of CHARACTER_SOUL_FIELDS) {
        if (!soul[field]) {
            const re = new RegExp(`^${field}:\\s*(.+)$`, 'm');
            const m = fm.match(re);
            if (m) soul[field] = m[1].trim();
        }
    }

    return soul as Partial<CharacterSoul>;
}

/** 灵魂字段的占位值（模板骨架常见写法，不能算「已提取」） */
const PLACEHOLDER_SOUL_VALUE_RE = /^(?:（待补充）|（待定）|>-|—|-{2,}|暂无|无|略|待补充|待定|未设置|未知|n\/a|\.{3,}|…+)$/i;

function isSoulValueMeaningful(value: string): boolean {
    const v = (value || '').trim().replace(/^["'「」]|["'「」]$/g, '').trim();
    if (!v) return false;
    if (PLACEHOLDER_SOUL_VALUE_RE.test(v)) return false;
    return v.length >= 2;
}

/**
 * 从角色文件构建完整 CharacterSoul
 * @param name - 名称
 * @param content - 内容
  * @returns CharacterSoul 实例
 */
function buildSoul(name: string, content: string): CharacterSoul {
    const core = parseCharacterCore(content);
    const soul: CharacterSoul = {
        name,
        desire: core.desire || '',
        fear: core.fear || '',
        obsession: core.obsession || '',
        shame: core.shame || '',
        trauma: core.trauma || '',
        weakness: core.weakness || '',
        soft_spot: core.soft_spot || '',
        rage_trigger: core.rage_trigger || '',
        moral_boundary: core.moral_boundary || '',
        hasSoul: false,
    };
    // 9个字段全部有实质值才算完整soul（Rev 185：旧实现只判 length > 0，「>-」也算有灵魂）
    soul.hasSoul = CHARACTER_SOUL_FIELDS.every(
        (f) => isSoulValueMeaningful(String(soul[f as keyof CharacterSoul] ?? '')),
    );
    return soul;
}

/**
 * 从角色文件提取 CharacterSoul
 * @param file - 文件
 * @param vault - 仓库（Vault）
  * @returns CharacterSoul 或 null
 */
export async function extractCharacterCore(file: TFile, vault: Vault): Promise<CharacterSoul | null> {
    const name = file.name.replace(/\.md$/, '');
    try {
        const content = await vault.cachedRead(file);
        if (!content) return null;
        return buildSoul(name, content);
    } catch {
        return null;
    }
}

/**
 * 从文件内容文本中提取角色灵魂层（异步版本使用）
 * @param name - 名称
 * @param content - 内容
  * @returns CharacterSoul 实例
 */
export function extractCharacterCoreFromContent(name: string, content: string): CharacterSoul {
    return buildSoul(name, content);
}

/**
 * 批量提取所有角色灵魂层
 * @param charFiles - 角色文件列表
 * @param vault - 仓库（Vault）
 * @returns 结果数组
 */
export async function gatherAllCharacterCores(
    charFiles: TFile[],
    vault: Vault,
): Promise<CharacterSoul[]> {
    const souls: CharacterSoul[] = [];
    for (const file of charFiles) {
        try {
            const content = await vault.read(file);
            const name = file.name.replace(/\.md$/, '');
            souls.push(buildSoul(name, content));
        } catch {
            // 跳过不可读的文件
        }
    }
    return souls;
}

/**
 * 将角色灵魂层格式化为 prompt 友好文本（≤300 tokens/人）
 * @param soul - 灵魂
 * @returns 文本结果
 */
export function formatSoulForPrompt(soul: CharacterSoul): string {
    if (!soul.hasSoul) {
        return `【${soul.name}】无灵魂层数据。`;
    }
    return [
        `【${soul.name}】`,
        `欲望：${soul.desire}`,
        `恐惧：${soul.fear}`,
        `执念：${soul.obsession}`,
        `创伤：${soul.trauma}`,
        `弱点：${soul.weakness}`,
        `软处：${soul.soft_spot}`,
        `暴走红线：${soul.rage_trigger}`,
        `底线：${soul.moral_boundary}`,
    ].join('\n');
}

/** 全量灵魂层注入的默认人数上限：避免几十个角色把正文 prompt 顶爆 */
export const MAX_SOULS_IN_PROMPT = 8;

/**
 * 角色灵魂摘要选项列表结构定义。
 */
export interface CharacterSoulSummaryOptions {
    /** 本章相关角色名；为空时退回前 N 个角色 */
    relevantNames?: Set<string>;
    /** 最多注入几个角色（默认 8） */
    maxSouls?: number;
}

/**
 * 构建全量灵魂层压缩文本（含主角标记）。
 * 只注入本章相关角色：全部角色都塞进去会稀释 prompt，并在超预算时把关键约束挤掉。
 * @param souls - 角色灵魂
 * @param protagonistName - 主角名称
 * @param options - 配置项
  * @returns CharacterSoulSummary 实例
 */
export function buildCharacterSoulSummary(
    souls: CharacterSoul[],
    protagonistName: string,
    options: CharacterSoulSummaryOptions = {},
): CharacterSoulSummary {
    const protagonist = souls.find(s => s.name === protagonistName) || null;
    const relevant = options.relevantNames;
    const maxSouls = Math.max(1, options.maxSouls ?? MAX_SOULS_IN_PROMPT);

    let selected = souls;
    if (relevant && relevant.size > 0) {
        selected = souls.filter(s => s.name === protagonistName || relevant.has(s.name));
        // 相关角色一个都没命中时不能空手而归：至少保留主角 + 前 N 个
        if (selected.length === 0) {
            selected = protagonist ? [protagonist, ...souls.filter(s => s !== protagonist)] : souls;
        }
    }
    selected = selected.slice(0, maxSouls);

    const parts: string[] = [];
    for (const soul of selected) {
        const mark = soul.name === protagonistName ? '【★主角】' : '';
        const label = mark ? `${mark} ${soul.name}` : soul.name;
        if (soul.hasSoul) {
            // v4.25：9 字段全带。旧版只给 6 字段，情绪规划却要求按 soft_spot/obsession/shame
            // 反应——模型被要求使用它看不见的字段。配角也该有完整灵魂层。
            parts.push(
                `【${label}】欲>${soul.desire} | 惧>${soul.fear} | ` +
                `执>${soul.obsession} | 耻>${soul.shame} | ` +
                `创>${soul.trauma} | 弱>${soul.weakness} | ` +
                `软>${soul.soft_spot} | 怒>${soul.rage_trigger} | 底>${soul.moral_boundary}`
            );
        } else {
            parts.push(`【${label}】（灵魂层未配置）`);
        }
    }

    return {
        protagonist,
        allSouls: parts.join('\n'),
        hasSoulData: selected.some(s => s.hasSoul),
    };
}

/**
 * 获取主角灵魂层的详细描述（用于正文生成 system prompt）
 * @param soul - 灵魂
 * @returns 文本结果
 */
export function getProtagonistSoulDetail(soul: CharacterSoul): string {
    if (!soul.hasSoul) return '';
    return [
        `他/她最渴望的是：${soul.desire}`,
        `他/她最恐惧的是：${soul.fear}`,
        `他/她最执着的是：${soul.obsession}`,
        `他/她有一段最不想回忆的经历：${soul.shame}`,
        `他/她身上有一道无法愈合的伤：${soul.trauma}`,
        `他/她的致命弱点是：${soul.weakness}`,
        `他/她对某些人/物毫无抵抗力：${soul.soft_spot}`,
        `让他/她失控的是：${soul.rage_trigger}`,
        `他/她的底线是：${soul.moral_boundary}`,
    ].join('\n');
}
