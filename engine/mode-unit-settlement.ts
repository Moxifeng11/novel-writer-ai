/**
 * mode-unit-settlement.ts — 短篇「节」/剧本「集」的单元结算
 *
 * 复用 SettlementEngine.settleLight：按单元 frontmatter 的 `涉及人物/地点/势力/物品功法`
 * 更新实体最后出场与状态，再把单元标记为 settled，并写一份可追溯的结算记录。
 *
 * 不使用完整 `settle()`：它依赖长篇分析报告（UPDATE_/NEW_ 指令）与章节路径；
 * 短篇/剧本的单元级结算只做“出场确认 + 状态标记”，完整图谱结算等 M4。
 */
import { App, TFile } from 'obsidian';
import type { CreationMode } from '@/shared/creation-mode';
import { modeContentDir, SHORT_DIRS, SCRIPT_DIRS } from '@/shared/mode-content';
import { ObsidianFrontmatter, writeVaultText } from '@/shared/file-system-port';
import type { SettlementEngine, SettlementResult } from './settlement-engine';
import { listEntityFiles } from '@/shared/entity-reader';

/** 单元结算结果。 */
export interface ModeUnitSettlementResult {
    updated: number;
    reportPath: string;
    detail: SettlementResult;
}

/**
 * 结算一个模式单元。
 *
 * @param app - Obsidian 应用实例
 * @param settlement - 结算引擎（只需 settleLight）
 * @param project - 项目 ID
 * @param unitPath - 单元文件路径
 * @param unitName - 单元显示名
 * @param mode - 创作模式
 * @param body - 单元正文
 * @returns 结算结果
 */
export async function settleModeUnit(
    app: App,
    settlement: Pick<SettlementEngine, 'settleLight'>,
    project: string,
    unitPath: string,
    unitName: string,
    mode: CreationMode,
    body: string,
): Promise<ModeUnitSettlementResult> {
    const unitDir = unitPath.substring(0, unitPath.lastIndexOf('/'));
    // 单元编辑器不含 frontmatter：从正文里匹配项目实体名，补足 settleLight 的出场清单。
    const namesInBody = (kind: 'characters' | 'locations' | 'factions' | 'items'): string[] =>
        listEntityFiles(app, project, kind)
            .map(file => file.basename)
            .filter(name => name.length >= 2 && body.includes(name));
    const detail = await settlement.settleLight(project, unitDir, unitName, body, {
        involvedChars: namesInBody('characters'),
        involvedLocs: namesInBody('locations'),
        involvedFactions: namesInBody('factions'),
        involvedItems: namesInBody('items'),
    });
    const updated = detail.updatedChars + detail.updatedLocations + detail.updatedFactions + detail.updatedItems;
    const settledAt = new Date().toISOString();

    const file = app.vault.getAbstractFileByPath(unitPath);
    if (file instanceof TFile) {
        await new ObsidianFrontmatter(app).processFrontmatter(file, fm => {
            fm['status'] = 'settled';
            fm['settlement_at'] = settledAt;
            fm['settlement_mode'] = 'light';
            fm['settlement_updated'] = updated;
        });
    }

    const reviewDir = mode === 'short' ? SHORT_DIRS.review : SCRIPT_DIRS.review;
    const reportPath = `${modeContentDir(project, mode)}/${reviewDir}/${unitName}_结算.md`;
    const lines = [
        '---',
        'tags: [结算]',
        `mode: ${mode}`,
        `unit: "${unitName}"`,
        'settlement_mode: light',
        `settlement_at: ${settledAt}`,
        `updated_entities: ${updated}`,
        '---',
        '',
        `# ${unitName} · 单元结算`,
        '',
        '- 类型：轻量结算（出场确认 + 单元状态）',
        `- 人物更新：${detail.updatedChars}`,
        `- 地点更新：${detail.updatedLocations}`,
        `- 势力更新：${detail.updatedFactions}`,
        `- 物品更新：${detail.updatedItems}`,
        `- 伏笔更新：${detail.updatedForeshadows}`,
        '',
        '> 完整实体图谱/时间线结算仍由长篇流水线处理；短篇/剧本当前只做单元级出场确认。',
    ];
    await writeVaultText(app, reportPath, `${lines.join('\n')}\n`);
    return { updated, reportPath, detail };
}
