/**
 * Character Soul Engine — V2 角色灵魂层
 * 
 * 从角色MD文件的 character_core YAML嵌套字段中提取灵魂层，
 * 压缩为 prompt 友好的文本注入正文生成。
 * 
 * soul 层包含9个字段：desire/fear/obsession/shame/trauma/weakness/soft_spot/rage_trigger/moral_boundary
 */

import { TFile, Vault } from 'obsidian';
import { CHARACTER_SOUL_FIELDS } from '../shared/format-constants';

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

/**
 * 从角色文件构建完整 CharacterSoul
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
    // 9个字段全部有值才算完整soul
    soul.hasSoul = CHARACTER_SOUL_FIELDS.every(f => !!soul[f as keyof CharacterSoul] && String(soul[f as keyof CharacterSoul]).length > 0);
    return soul;
}

/**
 * 从角色文件提取 CharacterSoul
 */
export function extractCharacterCore(file: TFile, vault: Vault): CharacterSoul | null {
    // 从文件名提取角色名（去掉.md后缀）
    const name = file.name.replace(/\.md$/, '');
    try {
        // 同步读取（Obsidian vault API 支持同步缓存读取）
        const content = vault.cachedRead(file);
        // cachedRead 返回 string | null（TypeScript 类型），实际在文件存在时总是返回 string
        return null; // 由外部通过异步读取后调用 extractCharacterCoreFromContent
    } catch {
        return null;
    }
}

/**
 * 从文件内容文本中提取角色灵魂层（异步版本使用）
 */
export function extractCharacterCoreFromContent(name: string, content: string): CharacterSoul {
    return buildSoul(name, content);
}

/**
 * 批量提取所有角色灵魂层
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

/**
 * 构建全量灵魂层压缩文本（含主角标记）
 */
export function buildCharacterSoulSummary(
    souls: CharacterSoul[],
    protagonistName: string,
): CharacterSoulSummary {
    const protagonist = souls.find(s => s.name === protagonistName) || null;

    const parts: string[] = [];
    for (const soul of souls) {
        const mark = soul.name === protagonistName ? '【★主角】' : '';
        const label = mark ? `${mark} ${soul.name}` : soul.name;
        if (soul.hasSoul) {
            parts.push(
                `【${label}】欲>${soul.desire} | 惧>${soul.fear} | ` +
                `创>${soul.trauma} | 弱>${soul.weakness} | ` +
                `怒>${soul.rage_trigger} | 底>${soul.moral_boundary}`
            );
        } else {
            parts.push(`【${label}】（灵魂层未配置）`);
        }
    }

    return {
        protagonist,
        allSouls: parts.join('\n'),
        hasSoulData: souls.some(s => s.hasSoul),
    };
}

/**
 * 获取主角灵魂层的详细描述（用于正文生成 system prompt）
 */
export function getProtagonistSoulDetail(soul: CharacterSoul): string {
    if (!soul.hasSoul) return '';
    return [
        `你知道自己最想得到什么：${soul.desire}`,
        `你知道自己最怕什么：${soul.fear}`,
        `你知道自己最执着什么：${soul.obsession}`,
        `你有一段最不想回忆的经历：${soul.shame}`,
        `你身上有一道无法愈合的伤：${soul.trauma}`,
        `你知道自己的致命弱点：${soul.weakness}`,
        `你对某些人/物毫无抵抗力：${soul.soft_spot}`,
        `你知道什么会让你失控：${soul.rage_trigger}`,
        `你知道自己的底线在哪里：${soul.moral_boundary}`,
    ].join('\n');
}
