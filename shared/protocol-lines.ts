/**
 * protocol-lines.ts — 正文末尾的结构化协议行（2026-11-26）
 *
 * ## 为什么有它
 *
 * 本仓现在靠 distill 再调一次 LLM 从正文里抽「关系/物品/境界变化」。
 * 两个问题：
 * 1. 多一次 LLM 调用（成本 + 延迟）
 * 2. 抽取时模型已经「忘了」自己刚写了什么细节，准确率低
 *
 * 云笔的做法：在正文末尾要求模型顺手输出几行结构化变更。
 * 模型最清楚自己改了什么，趁热输出准确率更高。
 *
 * ## 格式（学云笔，字段用半角竖线分隔）
 *
 * ```
 * CR|关系方A|关系方B|本章关系变化|触发事件
 * CI|物品名|变动类型|数量
 * BT|角色名|原境界|新境界|突破契机
 * NE|名称|类型|为何必须出现
 * ```
 *
 * ## 保守设计（本仓特有）
 *
 * 本仓**不直接拿协议行改数据表**——AI 可能编造。
 * 协议行只产出「待确认清单」，由结算流程或用户决定是否采纳。
 * 这样即使模型乱写，也不会污染数据。
 */

/** 协议行类型 */
export type ProtocolKind = 'CR' | 'CI' | 'BT' | 'NE';

/** 一条协议行 */
export interface ProtocolLine {
    kind: ProtocolKind;
    /** 按 `|` 分割的原始字段 */
    fields: string[];
}

/** 四类协议行的字段约定 */
export const PROTOCOL_SCHEMA: Record<ProtocolKind, { name: string; fields: string[] }> = {
    CR: { name: '角色关系变化', fields: ['关系方A', '关系方B', '关系变化', '触发事件'] },
    CI: { name: '物品变动', fields: ['物品名', '变动类型', '数量'] },
    BT: { name: '境界突破', fields: ['角色名', '原境界', '新境界', '突破契机'] },
    NE: { name: '新实体', fields: ['名称', '类型', '理由'] },
};

/** 物品变动类型白名单（防止模型乱造） */
export const ITEM_CHANGE_TYPES = ['获得', '消耗', '失去', '损坏', '赠与', '转移'] as const;

/**
 * 追加到正文提示词末尾的指令块。
 *
 * 放在最末（利用 LLM 尾部注意力），且明确「不写 = 本章无此类变更」，
 * 避免模型为了凑数编造变更。
 */
export const PROTOCOL_LINES_INSTRUCTION = `---

## 正文写完后，追加结构化变更行（没有变更就不写该行，不要编造）

格式（每行一个，字段用半角竖线 | 分隔；字段值内部不能含竖线）：

CR|关系方A|关系方B|本章关系变化（如"师徒反目"/"信任加深"）|触发事件（≤20字）
CI|物品名|变动类型（获得/消耗/失去/损坏/赠与/转移）|数量
BT|角色名|原境界|新境界|突破契机（≤20字）
NE|名称|类型（角色/物品/地点/势力/功法）|为何必须出现

规则：
1. 只写**本章正文中确实发生**的变更，不要写计划或预期
2. 没有变更就不写该行（宁可少写，不要编造）
3. NE 行只在本章引入新实体时写，同时说明"为什么非新实体不可"
4. 这几行是给程序解析的，不要写解释、不要加标题、不要加代码块包裹`;

/**
 * 从模型输出中分离正文与协议行。
 *
 * 容错：
 * - 容忍行首尾空白
 * - 容忍 `CR | a | b`（竖线两侧有空格）
 * - 不匹配的行原样留在正文里
 *
 * @param raw - 模型完整输出
 * @returns 分离后的正文与协议行
 * @example
 * const { body, lines } = splitProtocolLines('他把剑收起来。\nCI|霜寒剑|损坏|1');
 * // body = '他把剑收起来。'
 * // lines = [{ kind: 'CI', fields: ['霜寒剑', '损坏', '1'] }]
 */
export function splitProtocolLines(raw: string): { body: string; lines: ProtocolLine[] } {
    const lines: ProtocolLine[] = [];
    const kept: string[] = [];
    for (const line of raw.split('\n')) {
        const t = line.trim();
        const m = /^(CR|CI|BT|NE)\s*\|\s*(.+)$/.exec(t);
        if (m) {
            lines.push({
                kind: m[1] as ProtocolKind,
                fields: m[2].split('|').map(x => x.trim()).filter(x => x.length > 0),
            });
        } else {
            kept.push(line);
        }
    }
    return { body: kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd(), lines };
}

/**
 * 校验协议行的字段数与取值合法性。
 *
 * 不合格的行被丢弃并在 warnings 里说明——**绝不带着脏数据进结算**。
 *
 * @param lines - 原始协议行
 * @returns 合法行 + 告警
 * @example
 * const { valid, warnings } = validateProtocolLines(parsed.lines);
 */
export function validateProtocolLines(lines: ProtocolLine[]): {
    valid: ProtocolLine[];
    warnings: string[];
} {
    const valid: ProtocolLine[] = [];
    const warnings: string[] = [];
    for (const line of lines) {
        const schema = PROTOCOL_SCHEMA[line.kind];
        if (!schema) {
            warnings.push(`未知协议行类型 ${line.kind}，已忽略`);
            continue;
        }
        // CR/CI/BT 要求字段数达标；NE 允许 2-3 个（理由可选）
        const min = line.kind === 'NE' ? 2 : schema.fields.length;
        if (line.fields.length < min) {
            warnings.push(`${line.kind} 字段不足（${line.fields.length} < ${min}），已忽略：${line.fields.join('|')}`);
            continue;
        }
        // CI 的变动类型必须在白名单里
        if (line.kind === 'CI') {
            const type = line.fields[1];
            if (!ITEM_CHANGE_TYPES.includes(type as typeof ITEM_CHANGE_TYPES[number])) {
                warnings.push(`CI 变动类型「${type}」不在白名单，已忽略`);
                continue;
            }
        }
        valid.push(line);
    }
    return { valid, warnings };
}

/**
 * 把协议行渲染成人类可读的待确认清单（Markdown）。
 *
 * 本仓**不自动采纳**协议行——生成一份清单让结算流程/用户决定。
 * 理由：AI 可能编造变更，直接改数据表会污染。
 *
 * @param lines - 已校验的协议行
 * @param chapterName - 章节名（用于标题）
 * @returns Markdown 文本
 * @example
 * renderProtocolChecklist(valid, '第12章') // '## 第12章 协议行待确认\n\n- ...'
 */
export function renderProtocolChecklist(lines: ProtocolLine[], chapterName: string): string {
    if (lines.length === 0) return '';
    const out: string[] = [`## ${chapterName} 协议行待确认`, '', '> AI 在正文末尾输出的结构化变更。**需人工确认后才写入数据表**。', ''];
    const byKind = new Map<ProtocolKind, ProtocolLine[]>();
    for (const l of lines) {
        const list = byKind.get(l.kind) || [];
        list.push(l);
        byKind.set(l.kind, list);
    }
    for (const [kind, list] of byKind) {
        const schema = PROTOCOL_SCHEMA[kind];
        out.push(`### ${schema.name}（${kind}）`, '');
        for (const l of list) {
            const pairs = schema.fields.map((f, i) => `${f}=${l.fields[i] ?? '—'}`).join('　');
            out.push(`- ${pairs}`);
        }
        out.push('');
    }
    out.push('---', '', '- [ ] 全部采纳', '- [ ] 部分采纳（在下方勾选）', '');
    return out.join('\n');
}
