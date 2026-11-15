/**
 * voice-sample-model.ts — 角色口吻样本（纯函数）
 *
 * OOC 保障缺口：原实现只有灵魂层字段 + 词表检查，没有「角色怎么说话」的样本。
 * 这里定义口吻样本的解析、筛选与渲染，供场景级注入（只在角色在场时注入其样本）。
 */

import type { ProjectIndexEntry } from './project-index-model';

/** 角色口吻样本 */
export interface VoiceSample {
    /** 角色 ID */
    id: string;
    /** 角色名 */
    name: string;
    /** 台词样本（2–3 句） */
    samples: string[];
    /** 说话特征（语速/用词/称呼习惯等） */
    traits: string[];
}

/** frontmatter 中口吻样本的键 */
const VOICE_KEYS = ['voice_samples', '口吻样本', '台词样本', '语气样本'];
/** frontmatter 中说话特征的键 */
const TRAIT_KEYS = ['voice_traits', '说话特征', '口癖', '语言风格'];

/**
 * 从 frontmatter 解析口吻样本。
 *
 * @param frontmatter - 角色卡 frontmatter
 * @param id - 角色 ID
 * @param name - 角色名
 * @returns 口吻样本；无样本返回 null
 */
export function parseVoiceSample(
    frontmatter: Record<string, unknown> | undefined,
    id: string,
    name: string,
): VoiceSample | null {
    const fm = frontmatter ?? {};
    const samples = collect(fm, VOICE_KEYS);
    const traits = collect(fm, TRAIT_KEYS);
    if (samples.length === 0 && traits.length === 0) return null;
    return { id, name, samples, traits };
}

/**
 * 筛选在场角色的口吻样本。
 *
 * @param entries - 项目索引条目（含 id/name）
 * @param frontmatters - 路径 → frontmatter
 * @param inSceneIds - 在场角色 ID
 * @returns 口吻样本
 */
export function selectVoiceSamples(
    entries: readonly ProjectIndexEntry[],
    frontmatters: Readonly<Record<string, Record<string, unknown> | undefined>>,
    inSceneIds: readonly string[],
): VoiceSample[] {
    const ids = new Set(inSceneIds);
    const samples: VoiceSample[] = [];
    for (const entry of entries) {
        if (!entry.id || !ids.has(entry.id)) continue;
        if (entry.type !== 'character') continue;
        const sample = parseVoiceSample(frontmatters[entry.path], entry.id, entry.name);
        if (sample) samples.push(sample);
    }
    return samples;
}

/**
 * 渲染口吻样本段（只含在场角色）。
 *
 * @param samples - 口吻样本
 * @returns 段落；空返回空串
 */
export function renderVoiceSampleSection(samples: readonly VoiceSample[]): string {
    if (samples.length === 0) return '';
    const lines = ['【在场角色口吻（写对白时对齐）】'];
    for (const sample of samples) {
        lines.push(`- ${sample.name}（${sample.id}）`);
        if (sample.traits.length > 0) lines.push(`  特征：${sample.traits.join('、')}`);
        for (const quote of sample.samples) lines.push(`  台词：${quote}`);
    }
    return lines.join('\n');
}

/** 从 frontmatter 收集字符串数组 */
function collect(fm: Record<string, unknown>, keys: readonly string[]): string[] {
    const values: string[] = [];
    for (const key of keys) {
        const value = fm[key];
        if (typeof value === 'string' && value.trim()) {
            values.push(...value.split(/[|｜]/).map(item => item.trim()).filter(Boolean));
        } else if (Array.isArray(value)) {
            values.push(...value.map(item => String(item).trim()).filter(Boolean));
        }
    }
    return [...new Set(values)];
}
