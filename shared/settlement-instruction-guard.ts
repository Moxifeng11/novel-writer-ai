/**
 * settlement-instruction-guard.ts — 结算指令写入前校验（M12 写入切换）
 *
 * 现状：解析器把「字段/值不合法」的指令也交给写入步骤，导致脏值落盘。
 * 本模块在写入前做**最小必要校验**并剔除非法条目（不是字段级改写，整条丢弃并记录原因），
 * 由 `SettlementOptions.strictWrites` 控制是否启用（默认关）。
 */

/** 被丢弃的指令 */
export interface DroppedInstruction {
    /** 指令类别（uc/uf/nc/rel…） */
    kind: string;
    /** 目标名 */
    name: string;
    /** 字段（可空） */
    field?: string;
    /** 原值（可空） */
    value?: string;
    /** 丢弃原因 */
    reason: string;
}

/** 校验结果 */
export interface InstructionGuardResult<T> {
    /** 过滤后的指令 */
    instructions: T;
    /** 被丢弃条目 */
    dropped: DroppedInstruction[];
}

/** 伏笔状态规范词（含中文别名） */
const FORESHADOW_STATUS_ALIASES: Record<string, string> = {
    planted: 'planted',
    progressing: 'progressing',
    resolved: 'resolved',
    abandoned: 'abandoned',
    未回收: 'planted',
    已埋设: 'planted',
    进行中: 'progressing',
    推进中: 'progressing',
    已回收: 'resolved',
    已兑现: 'resolved',
    已废弃: 'abandoned',
    放弃: 'abandoned',
};

/** 形如 {name, field, value} 的更新类字段 */
type FieldItem = { name?: string; field?: string; value?: string };
/** 形如 {name} 的新建类条目 */
type NamedItem = { name?: string; description?: string };

/**
 * 校验并剔除非法结算指令。
 *
 * @param instructions - parseReport 结果（结构松散）
 * @returns 过滤结果与被丢弃条目
 */
export function sanitizeInstructions<T extends Record<string, unknown>>(instructions: T): InstructionGuardResult<T> {
    const dropped: DroppedInstruction[] = [];
    const output: Record<string, unknown> = { ...instructions };

    const updateKeys = ['uc', 'uf', 'ufa', 'uloc', 'uitem'] as const;
    for (const key of updateKeys) {
        const list = output[key];
        if (!Array.isArray(list)) continue;
        output[key] = (list as FieldItem[]).filter(item => {
            const reason = validateFieldItem(key, item);
            if (reason) {
                dropped.push({ kind: key, name: item?.name ?? '', field: item?.field, value: item?.value, reason });
                return false;
            }
            return true;
        });
    }

    const namedKeys = ['nc', 'nl', 'nf', 'ni', 'growth', 'emotion'] as const;
    for (const key of namedKeys) {
        const list = output[key];
        if (!Array.isArray(list)) continue;
        output[key] = (list as NamedItem[]).filter(item => {
            if (!item?.name || !String(item.name).trim()) {
                dropped.push({ kind: key, name: '', reason: '缺少名称' });
                return false;
            }
            return true;
        });
    }

    if (Array.isArray(output['rel'])) {
        output['rel'] = (output['rel'] as Array<{ entityA?: string; entityB?: string }>).filter(item => {
            if (!item?.entityA || !item?.entityB) {
                dropped.push({ kind: 'rel', name: item?.entityA ?? '', reason: '关系缺少两端实体' });
                return false;
            }
            return true;
        });
    }

    return { instructions: output as T, dropped };
}

/** 单条更新类校验（返回原因；空串表示合法） */
function validateFieldItem(kind: string, item: FieldItem | undefined): string {
    if (!item) return '空条目';
    const name = String(item.name ?? '').trim();
    const field = String(item.field ?? '').trim();
    const value = String(item.value ?? '').trim();
    if (!name) return '缺少目标名';
    if (!field) return '缺少字段名';
    if (!value) return '字段值为空';
    if (kind === 'uf' && field.includes('状态')) {
        const canonical = FORESHADOW_STATUS_ALIASES[value.toLowerCase()] ?? FORESHADOW_STATUS_ALIASES[value];
        if (!canonical) return `伏笔状态非法：${value}`;
    }
    return '';
}

/**
 * 把中文/别名伏笔状态规范为 canonical（供调用方统一写入口径）。
 *
 * @param status - 原始状态
 * @returns canonical 状态；无法识别返回 null
 */
export function normalizeForeshadowStatus(status: string): string | null {
    const value = String(status ?? '').trim();
    return FORESHADOW_STATUS_ALIASES[value.toLowerCase()] ?? FORESHADOW_STATUS_ALIASES[value] ?? null;
}

/**
 * 渲染丢弃摘要（日志/审查记录）。
 *
 * @param dropped - 被丢弃条目
 * @returns 文本
 */
export function renderDroppedSummary(dropped: readonly DroppedInstruction[]): string {
    if (dropped.length === 0) return '';
    return `已丢弃 ${dropped.length} 条非法指令：${dropped.slice(0, 8).map(item => `${item.kind}:${item.name}${item.field ? `.${item.field}` : ''}（${item.reason}）`).join('；')}`;
}
