/**
 * settlement-artifacts.ts — 结算表的唯一生成器（E2/Wave B 第一步）
 *
 * 完整结算表此前有两份实现：
 *   - ui/chapter-settlement-modal.buildSettlementSummary（带 settlement_mode / partial）
 *   - ui/write-chapter-modal 内联模板（字段名相近但缺部分元数据）
 * 同一章经不同入口结算，产出的表格 frontmatter/字段会漂移。
 * 这里收敛为纯函数；落盘与「标记正文 settled」仍由各入口负责（副作用不跨层）。
 */

export interface SettlementTableResult {
    updatedChars: number;
    updatedForeshadows: number;
    createdChars: number;
    createdLocs: number;
    createdFactions: number;
    createdItems: number;
    createdForeshadows: number;
    createdTimelines: number;
    /** 回滚统计（存在即本次结算未成功，不得写「已完成」产物） */
    rollback?: { reverted: number; failed: number };
    /** 回滚不完整时写入，后续步骤/用户可见 */
    settlementPartial?: boolean;
    /** 回滚终态之后的附加写入失败（关系/承诺/角色弧线）；存在即不得写「已完成」产物 */
    partialFailure?: string[];
}

/**
 * SettlementTableInput 类型定义。
 */
export interface SettlementTableInput {
    chapterName: string;
    /** 卷名（第N卷）；从路径取不到时传空串 */
    volume: string;
    result: SettlementTableResult;
    /** ISO 时间；缺省用当前时间 */
    timestamp?: string;
    /** 写入 step_model（旧内联模板会带当前模型） */
    model?: string;
}

/**
 * 结算表 frontmatter（与 元文件/00-系统模板/结算表模板.md 对齐）
 *
 * @param input - 输入
 * @returns 文本结果
 */
export function buildSettlementTableFrontmatter(input: {
    chapterName: string;
    volume: string;
    timestamp: string;
    model?: string;
    partial?: boolean;
}): string {
    const model = input.model ? input.model : '';
    return [
        '---',
        'tags: [结算表]',
        `卷: "${input.volume}"`,
        `章: "${input.chapterName}"`,
        'step_status: generated',
        `step_model: "${model}"`,
        `step_timestamp: ${input.timestamp}`,
        `结算时间: ${input.timestamp}`,
        '结算状态: completed',
        'settlement_mode: full',
        ...(input.partial ? ['settlement_partial: true'] : []),
        '---',
        '',
        '',
    ].join('\n');
}

/**
 * 完整结算表正文（字段顺序固定，便于表格消费方与人工核对）
 *
 * @param input - 输入
 * @returns 文本结果
 */
export function buildSettlementTable(input: SettlementTableInput): string {
    const timestamp = input.timestamp ?? new Date().toISOString();
    const fm = buildSettlementTableFrontmatter({
        chapterName: input.chapterName,
        volume: input.volume,
        timestamp,
        model: input.model,
        partial: input.result.settlementPartial === true,
    });
    // 计数字段缺省按 0 处理：调用方（含测试桩）只传部分字段时不产出 undefined 行
    const n = (value: number | undefined): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
    const r = {
        updatedChars: n(input.result.updatedChars),
        updatedForeshadows: n(input.result.updatedForeshadows),
        createdChars: n(input.result.createdChars),
        createdLocs: n(input.result.createdLocs),
        createdFactions: n(input.result.createdFactions),
        createdItems: n(input.result.createdItems),
        createdForeshadows: n(input.result.createdForeshadows),
        createdTimelines: n(input.result.createdTimelines),
    };
    return `${fm}# ${input.chapterName} 结算表

## 更新状态
- 人物状态更新：${r.updatedChars} 人
- 伏笔状态更新：${r.updatedForeshadows} 个

## 新建元素
- 新建人物：${r.createdChars} 个
- 新建地点：${r.createdLocs} 个
- 新建势力：${r.createdFactions} 个
- 新建物品功法：${r.createdItems} 个
- 新建伏笔：${r.createdForeshadows} 个
- 新建时间线事件：${r.createdTimelines} 个
`;
}

/**
 * 跨入口统一口径的「更新/新建」总数（Notice 与账本共用）
 *
 * @param result - 结果
  * @returns number } 结果
 */
export function countSettlementChanges(result: SettlementTableResult): { updated: number; created: number } {
    return {
        updated: result.updatedChars + result.updatedForeshadows,
        created: result.createdChars + result.createdLocs + result.createdFactions
            + result.createdItems + result.createdForeshadows + result.createdTimelines,
    };
}
