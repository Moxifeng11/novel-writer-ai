/**
 * world-state-snapshot.ts — 每章结束状态快照
 *
 * 目标：把“人物在哪、状态如何、知道什么、关系如何”固化成一张可读表，
 * 下一章以它为准，而不是只依赖前章结尾的叙事摘要。
 *
 * 注意：每卷的“状态快照”是卷级聚合，本文件是相邻章节连续性快照，二者互补。
 */
import type { SceneTask } from './scene-generation-loop';

export interface CharacterWorldState {
    name: string;
    status: string;
    emotion: string;
    location: string;
    goal: string;
    knows: string[];
    injuries: string;
    items: string;
}

export interface RelationshipWorldState {
    a: string;
    b: string;
    trust: number;
    attraction: number;
    fear: number;
    resentment: number;
    dependence: number;
    status: string;
}

export interface ChapterWorldStateSnapshot {
    chapterNum: number;
    chapterName: string;
    time: string;
    pov: string;
    locations: string[];
    characters: CharacterWorldState[];
    relationships: RelationshipWorldState[];
    openPromises: string[];
    unresolvedForeshadows: string[];
}

export interface BuildWorldStateSnapshotInput {
    chapterNum: number;
    chapterName: string;
    scenes?: SceneTask[];
    entityStates: CharacterWorldState[];
    relationships?: RelationshipWorldState[];
    openPromises?: string[];
    unresolvedForeshadows?: string[];
    /** 结算明确更新过的角色，必须进入快照 */
    updatedChars?: string[];
    maxCharacters?: number;
}

function splitNames(raw: string | undefined): string[] {
    return (raw || '')
        .split(/[,，、;；/\s]+/)
        .map(s => s.trim())
        .filter(Boolean);
}

function trimCell(value: string, max = 80): string {
    const text = (value || '').replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function buildChapterWorldStateSnapshot(input: BuildWorldStateSnapshotInput): ChapterWorldStateSnapshot {
    const scenes = input.scenes || [];
    const lastScene = scenes[scenes.length - 1];
    const locations = Array.from(new Set(
        scenes.map(s => (s.location || '').trim()).filter(Boolean),
    )).slice(0, 12);

    const involved = new Set<string>();
    for (const scene of scenes) {
        for (const name of splitNames(scene.characters)) involved.add(name);
    }
    for (const name of input.updatedChars || []) {
        if (name?.trim()) involved.add(name.trim());
    }

    const allEntities = input.entityStates || [];
    let selected = involved.size > 0
        ? allEntities.filter(c => involved.has(c.name))
        : allEntities;
    // 结算更新但实体表暂无记录的角色，保留一行，避免快照漏人
    const knownNames = new Set(selected.map(c => c.name));
    for (const name of involved) {
        if (!knownNames.has(name)) {
            selected.push({
                name,
                status: '未知',
                emotion: '',
                location: '',
                goal: '',
                knows: [],
                injuries: '',
                items: '',
            });
        }
    }
    const maxCharacters = Math.max(1, input.maxCharacters ?? 16);
    selected = selected.slice(0, maxCharacters);

    const names = new Set(selected.map(c => c.name));
    const relationships = (input.relationships || [])
        .filter(r => names.size === 0 || (names.has(r.a) && names.has(r.b)))
        .slice(0, 12);

    return {
        chapterNum: input.chapterNum,
        chapterName: input.chapterName,
        time: lastScene?.time || '',
        pov: lastScene?.pov || selected[0]?.name || '',
        locations,
        characters: selected,
        relationships,
        openPromises: (input.openPromises || []).slice(0, 10),
        unresolvedForeshadows: (input.unresolvedForeshadows || []).slice(0, 15),
    };
}

export function formatChapterStateSnapshot(snapshot: ChapterWorldStateSnapshot): string {
    const lines: string[] = [];
    lines.push('---');
    lines.push('tags: [章节状态快照]');
    lines.push(`章: ${snapshot.chapterName}`);
    lines.push(`章节号: ${snapshot.chapterNum}`);
    lines.push(`生成时间: ${new Date().toISOString()}`);
    lines.push('---');
    lines.push('');
    lines.push(`# ${snapshot.chapterName} 状态快照`);
    lines.push('');
    lines.push('## 章节结束状态');
    lines.push('');
    lines.push('| 时间 | 视角 | 地点 |');
    lines.push('|---|---|---|');
    lines.push(`| ${trimCell(snapshot.time) || '-'} | ${trimCell(snapshot.pov) || '-'} | ${trimCell(snapshot.locations.join('、')) || '-'} |`);
    lines.push('');
    lines.push('## 人物状态');
    lines.push('');
    lines.push('| 角色 | 状态 | 情绪 | 位置 | 当前目标 | 已知信息 | 伤势/物品 |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const c of snapshot.characters) {
        const extra = [c.injuries, c.items].filter(Boolean).join('；');
        lines.push(`| ${trimCell(c.name, 24)} | ${trimCell(c.status)} | ${trimCell(c.emotion)} | ${trimCell(c.location)} | ${trimCell(c.goal)} | ${trimCell(c.knows.join('；'), 120)} | ${trimCell(extra, 100)} |`);
    }
    lines.push('');
    lines.push('## 关系状态');
    lines.push('');
    if (snapshot.relationships.length === 0) {
        lines.push('（本章无关系数值更新）');
    } else {
        lines.push('| A | B | 信任 | 吸引 | 恐惧 | 怨恨 | 依赖 | 状态 |');
        lines.push('|---|---|---|---|---|---|---|---|');
        for (const r of snapshot.relationships) {
            lines.push(`| ${trimCell(r.a, 20)} | ${trimCell(r.b, 20)} | ${r.trust} | ${r.attraction} | ${r.fear} | ${r.resentment} | ${r.dependence} | ${trimCell(r.status)} |`);
        }
    }
    lines.push('');
    lines.push('## 未兑现承诺');
    lines.push('');
    if (snapshot.openPromises.length === 0) lines.push('（暂无记录）');
    else for (const p of snapshot.openPromises) lines.push(`- ${trimCell(p, 120)}`);
    lines.push('');
    lines.push('## 未回收伏笔');
    lines.push('');
    if (snapshot.unresolvedForeshadows.length === 0) lines.push('（暂无记录）');
    else for (const f of snapshot.unresolvedForeshadows) lines.push(`- ${trimCell(f, 120)}`);
    lines.push('');
    return lines.join('\n');
}

/** 供下一章 prompt 使用的紧凑摘要（≤1800 字）。 */
export function formatSnapshotForPrompt(snapshot: ChapterWorldStateSnapshot, maxChars = 1800): string {
    const lines: string[] = [];
    lines.push(`【上一章结束状态（硬约束）】`);
    lines.push(`时间：${snapshot.time || '未记录'}；视角：${snapshot.pov || '未记录'}；地点：${snapshot.locations.join('、') || '未记录'}`);
    for (const c of snapshot.characters.slice(0, 10)) {
        const knows = c.knows.length > 0 ? `；已知：${c.knows.join('、')}` : '';
        lines.push(`- ${c.name}：${c.status || '状态未记录'}；${c.location || '位置未记录'}；${c.emotion || '情绪未记录'}${knows}`);
    }
    if (snapshot.relationships.length > 0) {
        const rel = snapshot.relationships.slice(0, 6).map(r =>
            `${r.a}↔${r.b}(${r.status || '关系未记录'}，信任${r.trust}/恐惧${r.fear}/怨恨${r.resentment})`,
        );
        lines.push(`关系：${rel.join('；')}`);
    }
    if (snapshot.openPromises.length > 0) lines.push(`未兑现承诺：${snapshot.openPromises.join('；')}`);
    if (snapshot.unresolvedForeshadows.length > 0) lines.push(`未回收伏笔：${snapshot.unresolvedForeshadows.slice(0, 8).join('；')}`);
    lines.push('本章开头必须与此状态一致；如要改变，正文必须写出过渡。');
    const text = lines.join('\n');
    return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}
