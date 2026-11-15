/**
 * report-instructions-adapter.ts — 结算指令（Instructions）→ 回写审查输入（纯函数）
 *
 * 把 `parseReport` 产出的分组指令转成 `ParsedWritebackInput[]`，
 * 交给适配器/校验器做 ID 精确匹配与字段校验。**不改变现有写入行为**。
 */

import type { ParsedWritebackInput } from './writeback-adapter';

/** 结算指令分组（与 settlement-types 的 Instructions 对齐的最小形状） */
export interface ReportInstructions {
    uc?: Array<{ name: string; field: string; value: string }>;
    uf?: Array<{ name: string; field: string; value: string }>;
    ufa?: Array<{ name: string; field: string; value: string }>;
    uloc?: Array<{ name: string; field: string; value: string }>;
    uitem?: Array<{ name: string; field: string; value: string }>;
    nc?: Array<{ name: string; description: string }>;
    nl?: Array<{ name: string; description: string }>;
    nf?: Array<{ name: string; description: string }>;
    ni?: Array<{ name: string; description: string }>;
    nfs?: Array<{ chapter: string; reveal: string; relatedChars?: string }>;
    nt?: Array<{ desc: string; event: string }>;
    rel?: Array<{ entityA: string; entityB: string; relType: string; desc: string }>;
    growth?: Array<{ name: string; type: string; value: string; desc: string }>;
    emotion?: Array<{ name: string; emotion: string; desc: string }>;
    del?: Array<{ entityType: string; entityName: string }>;
}

/**
 * 把结算指令转成审查输入。
 *
 * @param instructions - parseReport 结果
 * @returns 审查输入
 */
export function instructionsToWritebackInputs(instructions: ReportInstructions | undefined): ParsedWritebackInput[] {
    const instr = instructions ?? {};
    const inputs: ParsedWritebackInput[] = [];

    for (const item of instr.uc ?? []) {
        inputs.push({ marker: 'UPDATE_CHARACTER', name: item.name, fields: { [item.field]: item.value }, raw: `UPDATE_CHARACTER ${item.name} ${item.field}=${item.value}` });
    }
    for (const item of instr.ufa ?? []) {
        inputs.push({ marker: 'UPDATE_FACTION', name: item.name, fields: { [item.field]: item.value } });
    }
    for (const item of instr.uloc ?? []) {
        inputs.push({ marker: 'UPDATE_LOCATION', name: item.name, fields: { [item.field]: item.value } });
    }
    for (const item of instr.uitem ?? []) {
        inputs.push({ marker: 'UPDATE_ITEM', name: item.name, fields: { [item.field]: item.value } });
    }
    for (const item of instr.uf ?? []) {
        inputs.push({ marker: 'UPDATE_FORESHADOW', name: item.name, fields: { [item.field]: item.value } });
    }
    for (const item of instr.nc ?? []) {
        inputs.push({ marker: 'NEW_CHARACTER', name: item.name, fields: { 描述: item.description } });
    }
    for (const item of instr.nl ?? []) {
        inputs.push({ marker: 'NEW_LOCATION', name: item.name, fields: { 描述: item.description } });
    }
    for (const item of instr.nf ?? []) {
        inputs.push({ marker: 'NEW_FACTION', name: item.name, fields: { 描述: item.description } });
    }
    for (const item of instr.ni ?? []) {
        inputs.push({ marker: 'NEW_ITEM', name: item.name, fields: { 描述: item.description } });
    }
    for (const item of instr.nfs ?? []) {
        inputs.push({
            marker: 'NEW_FORESHADOW',
            name: item.reveal || '未命名伏笔',
            fields: { 埋设章节: item.chapter, ...(item.relatedChars ? { 相关人物: item.relatedChars } : {}) },
        });
    }
    for (const item of instr.nt ?? []) {
        inputs.push({ marker: 'NEW_TIMELINE', name: item.event || item.desc, fields: { 描述: item.desc } });
    }
    for (const item of instr.rel ?? []) {
        // 关系以「A」作为解析目标名（关系卡需按两端 ID 定位，未命中即进待确认）
        inputs.push({ marker: 'RELATION', name: item.entityA, fields: { 关系类型: item.relType, 描述: item.desc, 对方: item.entityB } });
    }
    for (const item of instr.growth ?? []) {
        inputs.push({ marker: 'GROWTH', name: item.name, fields: { 成长节点: item.type, 变化: item.value } });
    }
    for (const item of instr.emotion ?? []) {
        inputs.push({ marker: 'EMOTION', name: item.name, fields: { 情绪: item.emotion, 原因: item.desc } });
    }

    return inputs;
}
