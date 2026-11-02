/**
 * Relationship Engine — V2 关系系统
 * 
 * 管理角色间信任度/吸引力/恐惧度/怨恨度/依赖性等关系数值。
 * 数据存储于 01-世界架构/关系状态.md（单文件集中管理）。
 * 
 * 关系数值范围: 0-100
 */

import { App, TFile } from 'obsidian';
import { SUBDIR_WORLD_ARCH } from '../shared/paths';
import type { Notifier } from '../shared/types';
import { NOOP_NOTIFIER } from '../shared/types';
import { FileSystemPort, VaultMetaPort, ObsidianFileSystem, ObsidianVaultMeta } from '../shared/file-system-port';

/** 关系维度 */
export interface RelationshipState {
    trust: number;       // 信任度 0-100
    attraction: number;  // 吸引力 0-100
    fear: number;        // 恐惧度 0-100
    resentment: number;  // 怨恨度 0-100
    dependence: number;  // 依赖性 0-100
    status: string;      // 文字描述
    history: string;     // 变更历史
}

/** 角色对关系 */
export interface CharacterPairRelation {
    charA: string;       // 角色A名
    charB: string;       // 角色B名
    state: RelationshipState;
    lastUpdatedChapter: string;
}

/**
 * 关系状态文件路径
 *
 * @param project - 项目（路径或对象）
 * @returns 文本结果
 */
export function getRelationshipFilePath(project: string): string {
    return `${project}/${SUBDIR_WORLD_ARCH}/关系状态.md`;
}

/**
 * 读取所有关系状态
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @returns 结果数组
 */
export async function loadRelationshipStates(app: App, project: string): Promise<CharacterPairRelation[]> {
    const path = getRelationshipFilePath(project);
    const vaultMeta = new ObsidianVaultMeta(app);
    const fs = new ObsidianFileSystem(app);
    const file = vaultMeta.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return [];

    try {
        const content = await fs.read(path);
        return parseRelationshipFile(content);
    } catch {
        return [];
    }
}

/**
 * 解析关系状态.md文件
 * @param content - 内容
 * @returns 结果数组
 */
function parseRelationshipFile(content: string): CharacterPairRelation[] {
    const relations: CharacterPairRelation[] = [];
    const sections = content.split(/^## /gm);

    for (const section of sections) {
        const headerMatch = section.match(/^(.+?)\n/);
        if (!headerMatch) continue;
        const pairHeader = headerMatch[1].trim();
        const pairMatch = pairHeader.match(/^(.+?)\s*↔\s*(.+)$/);
        if (!pairMatch) continue;

        const charA = pairMatch[1].trim();
        const charB = pairMatch[2].trim();

        const state: RelationshipState = {
            trust: extractNumber(section, 'trust'),
            attraction: extractNumber(section, 'attraction'),
            fear: extractNumber(section, 'fear'),
            resentment: extractNumber(section, 'resentment'),
            dependence: extractNumber(section, 'dependence'),
            status: extractString(section, 'status'),
            history: extractMultiline(section, 'history'),
        };

        const chapterMatch = section.match(/last_updated_chapter:\s*(.+)/);
        relations.push({
            charA, charB,
            state,
            lastUpdatedChapter: chapterMatch?.[1]?.trim() || '?',
        });
    }

    return relations;
}

function extractNumber(text: string, key: string): number {
    const re = new RegExp(`${key}:\\s*(\\d+)`);
    const m = text.match(re);
    // v4.20：读取即 clamp——文件被手改出 999/异常值时不污染后续计算
    return m ? Math.max(0, Math.min(100, parseInt(m[1], 10) || 0)) : 50;
}

function extractString(text: string, key: string): string {
    const re = new RegExp(`${key}:\\s*(.+)`);
    const m = text.match(re);
    return m ? m[1].trim() : '未知';
}

function extractMultiline(text: string, key: string): string {
    const re = new RegExp(`${key}:\\s*\\|?\\s*\\n((?:  .+\\n?)*)`);
    const m = text.match(re);
    return m ? m[1].replace(/^  /gm, '').trim() : '';
}

/**
 * 获取或创建两个角色间的关系
 * @param relations - 关系
 * @param charA - 字符 A
 * @param charB - 字符 B
  * @returns CharacterPairRelation 实例
 */
function getOrCreateRelation(
    relations: CharacterPairRelation[],
    charA: string,
    charB: string,
): CharacterPairRelation {
    let rel = relations.find(r =>
        (r.charA === charA && r.charB === charB) ||
        (r.charA === charB && r.charB === charA)
    );
    if (!rel) {
        rel = {
            charA, charB,
            state: {
                trust: 50, attraction: 50, fear: 50,
                resentment: 50, dependence: 50,
                status: '陌生',
                history: '',
            },
            lastUpdatedChapter: '?',
        };
        relations.push(rel);
    }
    return rel;
}

/**
 * 应用关系变化（限制在 0-100 范围内）
 * @param value - 值
 * @param delta - 增量
 * @returns 数值结果
 */
function applyDelta(value: number, delta: number): number {
    return Math.max(0, Math.min(100, value + delta));
}

/**
 * 从分析报告中提取关系变化并应用
 * 匹配格式:
 *   RELATION: 林砚|苏晴|信任|+5
 *   EMOTION: [[林砚]] | 当前情绪 | 对苏晴 fear +10
 *   RELATION: 墨渊|守御者联盟|敌对|resentment +5
 * @param reportContent - 报告内容
 * @returns 结果数组
 */
export function extractRelationshipChanges(reportContent: string): Array<{
    charA: string; charB: string; dimension: string; delta: number; reason: string;
}> {
    const changes: Array<{
        charA: string; charB: string; dimension: string; delta: number; reason: string;
    }> = [];

    // RELATION: 实体A|实体B|关系类型|关系描述
    const relRegex = /^RELATION:\s*(.+?)\|(.+?)\|(.+?)\|(.+)$/gm;
    for (const m of reportContent.matchAll(relRegex)) {
        const [_, charA, charB, relType, desc] = m;
        const deltaMatch = desc.match(/(trust|attraction|fear|resentment|dependence)\s*([+-]\d+)/i);
        if (deltaMatch) {
            changes.push({
                charA: charA.trim(), charB: charB.trim(),
                dimension: deltaMatch[1].toLowerCase(),
                delta: parseInt(deltaMatch[2]),
                reason: `${relType.trim()}: ${desc.trim()}`,
            });
        }
    }

    // EMOTION: 中也可能含关系变化
    const emoRegex = /^EMOTION:\s*\[\[(.+?)\]\]\s*\|\s*.+?\|\s*(.+)$/gm;
    for (const m of reportContent.matchAll(emoRegex)) {
        const [_, char, desc] = m;
        // 检查是否包含关系变化描述
        const relChange = desc.match(/对(.+?)\s*(trust|attraction|fear|resentment|dependence)\s*([+-]\d+)/i);
        if (relChange) {
            changes.push({
                charA: char.trim(), charB: relChange[1].trim(),
                dimension: relChange[2].toLowerCase(),
                delta: parseInt(relChange[3]),
                reason: desc.trim(),
            });
        }
    }

    return changes;
}

/**
 * 应用关系变化到关系状态列表
 *
 * 幂等（v4.25）：history 以「章名: 原因」为行。重跑同一章结算时，原因相同的变更
 * 直接跳过——旧实现会二次累加 delta 并堆叠重复历史行，数值随重跑次数漂移。
 * @param relations - 关系
 * @param changes - 变更
 * @param chapterName - 章节名
  * @returns number } 结果
 */
export function applyRelationshipChanges(
    relations: CharacterPairRelation[],
    changes: Array<{ charA: string; charB: string; dimension: string; delta: number; reason: string }>,
    chapterName: string,
): { relations: CharacterPairRelation[]; applied: number; skipped: number } {
    let applied = 0;
    let skipped = 0;
    for (const change of changes) {
        const rel = getOrCreateRelation(relations, change.charA, change.charB);
        const marker = `${chapterName}: ${change.reason}`;
        if (rel.state.history.includes(marker)) {
            skipped++;
            continue;
        }

        switch (change.dimension) {
            case 'trust': rel.state.trust = applyDelta(rel.state.trust, change.delta); break;
            case 'attraction': rel.state.attraction = applyDelta(rel.state.attraction, change.delta); break;
            case 'fear': rel.state.fear = applyDelta(rel.state.fear, change.delta); break;
            case 'resentment': rel.state.resentment = applyDelta(rel.state.resentment, change.delta); break;
            case 'dependence': rel.state.dependence = applyDelta(rel.state.dependence, change.delta); break;
        }

        applied++;
        rel.lastUpdatedChapter = chapterName;
        rel.state.history += `\n${marker}`;
        if (rel.state.history.length > 2000) {
            rel.state.history = rel.state.history.slice(-1500); // 截断旧历史
        }

        // 更新状态文字
        rel.state.status = describeRelationshipStatus(rel.state);
    }
    return { relations, applied, skipped };
}

/**
 * 根据数值生成关系状态描述
 * @param state - 状态
 * @returns 文本结果
 */
function describeRelationshipStatus(state: RelationshipState): string {
    if (state.trust >= 80) return '深厚信任';
    if (state.trust >= 60) return '基本信任';
    if (state.trust <= 20) return '完全不信任';
    if (state.resentment >= 80) return '深仇大恨';
    if (state.fear >= 80) return '极度恐惧';
    if (state.attraction >= 80) return '强烈吸引';
    if (state.dependence >= 80) return '高度依赖';
    if (state.trust <= 30 && state.fear >= 60) return '警惕/防范';
    return '普通';
}

/**
 * 将关系状态格式化为 Markdown 文件内容
 * @param relations - 关系
 * @param chapterName - 章节名
 * @returns 文本结果
 */
export function formatRelationshipFile(
    relations: CharacterPairRelation[],
    chapterName: string,
): string {
    const frontmatter = `---
tags: [关系状态]
last_updated_chapter: ${chapterName}
---

# 角色关系状态
`;

    const sections = relations.map(rel => {
        const s = rel.state;
        const header = `## ${rel.charA} ↔ ${rel.charB}`;
        const body = [
            `trust: ${s.trust}`,
            `attraction: ${s.attraction}`,
            `fear: ${s.fear}`,
            `resentment: ${s.resentment}`,
            `dependence: ${s.dependence}`,
            `status: ${s.status}`,
            `last_updated_chapter: ${rel.lastUpdatedChapter}`,
            `history: |`,
            ...s.history.split('\n').filter(Boolean).map(h => `  ${h}`),
        ].join('\n');
        return `${header}\n${body}`;
    });

    return frontmatter + sections.join('\n\n');
}

/**
 * 保存关系状态文件
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @param relations - 关系
 * @param chapterName - 章节名
 * @param notifier - 通知器
 */
export async function saveRelationshipStates(
    app: App,
    project: string,
    relations: CharacterPairRelation[],
    chapterName: string,
    notifier: Notifier = NOOP_NOTIFIER,
): Promise<void> {
    const path = getRelationshipFilePath(project);
    const content = formatRelationshipFile(relations, chapterName);
    const vaultMeta = new ObsidianVaultMeta(app);
    const fs = new ObsidianFileSystem(app);
    const existing = vaultMeta.getAbstractFileByPath(path);
    if (existing) {
        await fs.write(path, content);
    } else {
        // 确保目录存在
        const dir = path.split('/').slice(0, -1).join('/');
        const dirFolder = vaultMeta.getAbstractFileByPath(dir);
        if (!dirFolder) {
            await fs.mkdir(dir);
        }
        await fs.write(path, content);
    }
    notifier.showNotice('💞 关系状态已更新');
}
