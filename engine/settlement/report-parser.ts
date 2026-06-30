/**
 * engine/settlement/report-parser.ts
 * AI 分析报告解析器 — 纯函数，无副作用，可单测。
 *
 * 从 settlement-engine.ts 提取（2026-06-30 P1-2 拆分阶段一）。
 */
import type { Instructions } from './settlement-types';

/**
 * 解析 AI 分析报告文本，提取所有 UPDATE/NEW/RELATION/GROWTH/EMOTION/DELETE 指令。
 *
 * 指令格式见 settlement-types.ts 中 Instructions 接口注释。
 */
export function parseReport(report: string): Instructions {
    const instr: Instructions = {
        uc: [], uf: [], ufa: [], uloc: [], uitem: [],
        nc: [], nl: [], nf: [], ni: [], nfs: [], nt: [],
        rel: [], growth: [], emotion: [], del: [],
    };
    for (const line of report.split('\n')) {
        const t = line.trim();
        let m: RegExpMatchArray | null;

        // UPDATE_CHARACTER: [[角色]] | 字段名 | 新值
        m = t.match(/UPDATE_CHARACTER:\s*\[\[(.*?)\]\]\s*\|\s*(.*?)\s*\|\s*(.*)/);
        if (m) { instr.uc.push({ name: m[1].trim(), field: m[2].trim(), value: m[3].trim() }); continue; }

        // UPDATE_FACTION: [[势力]] | 字段名 | 新值（v1.3.0 新增）
        m = t.match(/UPDATE_FACTION:\s*\[\[(.*?)\]\]\s*\|\s*(.*?)\s*\|\s*(.*)/);
        if (m) { instr.ufa.push({ name: m[1].trim(), field: m[2].trim(), value: m[3].trim() }); continue; }

        // UPDATE_LOCATION: [[地点]] | 字段名 | 新值（v1.3.0 新增）
        m = t.match(/UPDATE_LOCATION:\s*\[\[(.*?)\]\]\s*\|\s*(.*?)\s*\|\s*(.*)/);
        if (m) { instr.uloc.push({ name: m[1].trim(), field: m[2].trim(), value: m[3].trim() }); continue; }

        // UPDATE_ITEM: [[物品功法]] | 字段名 | 新值（v1.3.0 新增）
        m = t.match(/UPDATE_ITEM:\s*\[\[(.*?)\]\]\s*\|\s*(.*?)\s*\|\s*(.*)/);
        if (m) { instr.uitem.push({ name: m[1].trim(), field: m[2].trim(), value: m[3].trim() }); continue; }

        // UPDATE_FORESHADOW: [[伏笔]] | 字段 | 新值
        m = t.match(/UPDATE_FORESHADOW:\s*\[\[(.*?)\]\]\s*\|\s*(.*?)\s*\|\s*(.*)/);
        if (m) { instr.uf.push({ name: m[1].trim(), field: m[2].trim(), value: m[3].trim() }); continue; }

        // NEW_CHARACTER: 角色名 | 角色描述
        m = t.match(/NEW_CHARACTER:\s*(.*?)\s*\|\s*(.*)/);
        if (m) { instr.nc.push({ name: m[1].trim(), description: m[2].trim() }); continue; }

        // NEW_LOCATION: 地名 | 地点描述
        m = t.match(/NEW_LOCATION:\s*(.*?)\s*\|\s*(.*)/);
        if (m) { instr.nl.push({ name: m[1].trim(), description: m[2].trim() }); continue; }

        // NEW_FACTION: 势力名 | 势力描述
        m = t.match(/NEW_FACTION:\s*(.*?)\s*\|\s*(.*)/);
        if (m) { instr.nf.push({ name: m[1].trim(), description: m[2].trim() }); continue; }

        // NEW_ITEM: 物品/功法/法宝名 | 简要描述
        m = t.match(/NEW_ITEM:\s*(.*?)\s*\|\s*(.*)/);
        if (m) { instr.ni.push({ name: m[1].trim(), description: m[2].trim() }); continue; }

        // NEW_FORESHADOW: 内容 | 埋设章节 | 预期揭示 | 相关人物(可选) | 关联主线(可选)（v1.3.0 统一为 5 字段）
        m = t.match(/NEW_FORESHADOW:\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*)/);
        if (m) { instr.nfs.push({ name: m[1].trim(), chapter: m[2].trim(), reveal: m[3].trim(), relatedChars: m[4]?.trim() || '', relatedPlotline: m[5]?.trim() || '' }); continue; }
        // 兼容旧格式 3 字段（fallback）
        m = t.match(/NEW_FORESHADOW:\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*)/);
        if (m && !instr.nfs.some(n => n.name === m![1].trim())) {
            instr.nfs.push({ name: m[1].trim(), chapter: m[2].trim(), reveal: m[3].trim() });
            continue;
        }

        // NEW_TIMELINE: 时间点 | 事件描述
        m = t.match(/NEW_TIMELINE:\s*(.*?)\s*\|\s*(.*)/);
        if (m) { instr.nt.push({ desc: m[1].trim(), event: m[2].trim() }); continue; }

        // RELATION: 实体A|实体B|关系类型|关系描述（v1.3.0 新增）
        m = t.match(/RELATION:\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*)/);
        if (m) { instr.rel.push({ entityA: m[1].trim(), entityB: m[2].trim(), relType: m[3].trim(), desc: m[4].trim() }); continue; }

        // GROWTH: 人物名|成长类型|新值|描述（v1.3.0 新增）
        m = t.match(/GROWTH:\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*)/);
        if (m) { instr.growth.push({ name: m[1].trim(), type: m[2].trim(), value: m[3].trim(), desc: m[4].trim() }); continue; }

        // EMOTION: [[角色]] | 当前情绪 | 情绪描述（v1.3.0 新增）
        m = t.match(/EMOTION:\s*\[\[(.*?)\]\]\s*\|\s*(.*?)\s*\|\s*(.*)/);
        if (m) { instr.emotion.push({ name: m[1].trim(), emotion: m[2].trim(), desc: m[3].trim() }); continue; }

        // DELETE_ENTITY: 实体类型|实体名称（v1.4.0 新增，对齐 shared_utils.js）
        m = t.match(/DELETE_ENTITY:\s*(.+?)\s*\|\s*(.+)/);
        if (m) { instr.del.push({ entityType: m[1].trim(), entityName: m[2].trim() }); continue; }
    }
    return instr;
}

/**
 * 从纯文本中解析 frontmatter 段（不依赖 Obsidian metadataCache）。
 * 用于 settleLight 等需要在文件读取后立即解析的场景。
 */
export function parseFrontmatterFromText(content: string): Record<string, string> {
    const fm = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) return {};
    const result: Record<string, string> = {};
    const lines = fm[1].split('\n');
    for (const line of lines) {
        const match = line.match(/^([^:]+):\s*(.*)$/);
        if (match) {
            const key = match[1].trim();
            let value = match[2].trim();
            if (value.startsWith('"') && value.endsWith('"')) {
                value = value.slice(1, -1);
            }
            result[key] = value;
        }
    }
    return result;
}

/**
 * 将 frontmatter 中数组/逗号分隔字符串规范化为 string[]。
 * 支持：JSON 数组、中英文逗号、顿号、未填空值。
 */
export function parseFmList(value: string | undefined): string[] {
    if (!value) return [];
    if (Array.isArray(value)) return value as unknown as string[];
    if (typeof value === 'string') {
        if (value.startsWith('[') && value.endsWith(']')) {
            try {
                const arr = JSON.parse(value);
                if (Array.isArray(arr)) return arr;
            } catch {
                /* 忽略 JSON 解析失败，回退到分隔符 */
            }
        }
        return value.split(/[,，、]/).map(s => s.trim()).filter(Boolean);
    }
    return [];
}
