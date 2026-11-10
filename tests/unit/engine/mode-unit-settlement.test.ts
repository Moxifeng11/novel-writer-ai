import { describe, expect, it, vi } from 'vitest';
import { App, TFile } from '../../__mocks__/obsidian';
import type { App as ObsidianApp } from 'obsidian';
import { settleModeUnit } from '../../../engine/mode-unit-settlement';
import type { SettlementResult } from '../../../engine/settlement-engine';

/**
 * CV-3（2026-11-10 覆盖率审计）：短篇/剧本单元结算此前 0/22 statements、
 * 0/16 branches——这是「把单元标成 settled 并写出结算报告」的唯一写盘路径，
 * 假 settled 无处可查。本文件锁住：
 *  - 出场实体过滤（≥2 字、仅正文出现、排除模板）；
 *  - settleLight 参数与返回值聚合；
 *  - 单元 frontmatter（status/settlement_at/mode/updated/partial）；
 *  - 报告路径（短篇 04-质检 / 剧本 05-质检）与报告字段/失败提示；
 *  - 单元文件不存在时不抛错、仍写报告。
 */

const PROJECT = '短篇小说/测试书';

function detail(overrides: Partial<SettlementResult> = {}): SettlementResult {
    return {
        updated: 0,
        created: 0,
        updatedChars: 2,
        updatedLocations: 1,
        updatedFactions: 0,
        updatedItems: 1,
        updatedForeshadows: 3,
        lightPartial: false,
        ...overrides,
    } as SettlementResult;
}

function makeHarness(entityNames: string[] = ['林玄', '苏晚']) {
    const app = new App();
    const folders = new Map<string, unknown>();
    const putFiles = (dir: string, names: string[]): void => {
        folders.set(dir, {
            path: dir,
            name: dir.split('/').pop(),
            children: names.map((name) => {
                const file = new TFile();
                file.path = `${dir}/${name}.md`;
                file.name = `${name}.md`;
                file.basename = name;
                file.extension = 'md';
                return file;
            }),
        });
    };
    putFiles(`${PROJECT}/01-世界架构/人物`, entityNames);
    putFiles(`${PROJECT}/01-世界架构/地点`, ['青云山']);
    putFiles(`${PROJECT}/01-世界架构/势力`, ['青云宗']);
    putFiles(`${PROJECT}/01-世界架构/物品功法`, ['玉佩']);

    (app.vault as unknown as { getAbstractFileByPath: (path: string) => unknown }).getAbstractFileByPath =
        (path: string) => folders.get(path.replace(/\/+$/, '')) ?? null;

    const fmState = new Map<string, Record<string, unknown>>();
    (app as unknown as { fileManager: unknown }).fileManager = {
        processFrontMatter: async (file: TFile, updater: (fm: Record<string, unknown>) => void) => {
            const fm = { ...(fmState.get(file.path) ?? {}) };
            updater(fm);
            fmState.set(file.path, fm);
        },
    };

    const settleLight = vi.fn(async () => detail());
    return { app, folders, fmState, settleLight };
}

function seedUnit(app: App, unitPath: string): TFile {
    const file = new TFile();
    file.path = unitPath;
    file.name = unitPath.split('/').pop()!;
    file.basename = file.name.replace(/\.md$/, '');
    file.extension = 'md';
    const vault = app.vault as unknown as { getAbstractFileByPath: (path: string) => unknown };
    const original = vault.getAbstractFileByPath.bind(vault);
    vault.getAbstractFileByPath = (path: string) => (path === unitPath ? file : original(path));
    return file;
}

const SHORT_UNIT = `${PROJECT}/短篇创作/03-正文/第1节.md`;

describe('settleModeUnit — 短篇单元结算（CV-3）', () => {
    it('出场实体过滤：≥2 字、仅正文出现、排除模板；参数与聚合正确', async () => {
        const { app, settleLight } = makeHarness(['林玄', '林', '苏晚', '人物模板']);
        seedUnit(app, SHORT_UNIT);

        const result = await settleModeUnit(
            app as unknown as ObsidianApp, { settleLight }, PROJECT, SHORT_UNIT, '第1节', 'short', '林玄与苏晚在青云山遇见青云宗弟子，握着玉佩。',
        );

        expect(settleLight).toHaveBeenCalledTimes(1);
        const [projectArg, dirArg, unitArg, bodyArg, involved] = settleLight.mock.calls[0] as unknown as [
            string, string, string, string, Record<string, string[]>,
        ];
        expect(projectArg).toBe(PROJECT);
        expect(dirArg).toBe(`${PROJECT}/短篇创作/03-正文`);
        expect(unitArg).toBe('第1节');
        expect(bodyArg).toContain('林玄');
        expect(involved.involvedChars).toEqual(['林玄', '苏晚']); // 1 字名与模板均被排除
        expect(involved.involvedLocs).toEqual(['青云山']);
        expect(involved.involvedFactions).toEqual(['青云宗']);
        expect(involved.involvedItems).toEqual(['玉佩']);

        // updated 聚合 = 人物+地点+势力+物品（不含伏笔）
        expect(result.updated).toBe(4);
        expect(result.detail.updatedForeshadows).toBe(3);
    });

    it('单元 frontmatter 标记 settled，报告落 04-质检 且字段完整', async () => {
        const { app, fmState } = makeHarness();
        seedUnit(app, SHORT_UNIT);

        const result = await settleModeUnit(app as unknown as ObsidianApp, { settleLight: vi.fn(async () => detail()) }, PROJECT, SHORT_UNIT, '第1节', 'short', '林玄出场。');

        const fm = fmState.get(SHORT_UNIT)!;
        expect(fm['status']).toBe('settled');
        expect(fm['settlement_mode']).toBe('light');
        expect(fm['settlement_updated']).toBe(4);
        expect(String(fm['settlement_at'])).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        expect(fm['settlement_partial']).toBeUndefined();

        expect(result.reportPath).toBe(`${PROJECT}/短篇创作/04-质检/第1节_结算.md`);
        const report = await app.vault.readByPath(result.reportPath);
        expect(report).toContain('tags: [结算]');
        expect(report).toContain('mode: short');
        expect(report).toContain('unit: "第1节"');
        expect(report).toContain('settlement_mode: light');
        expect(report).toContain('updated_entities: 4');
        expect(report).toContain('# 第1节 · 单元结算');
        expect(report).toContain('- 人物更新：2');
        expect(report).toContain('- 伏笔更新：3');
        expect(report).toContain('单元级出场确认');
    });

    it('剧本模式报告落 05-质检', async () => {
        const { app } = makeHarness();
        const unit = `${PROJECT}/剧本创作/03-剧本/第1集.md`;
        seedUnit(app, unit);

        const result = await settleModeUnit(app as unknown as ObsidianApp, { settleLight: vi.fn(async () => detail()) }, PROJECT, unit, '第1集', 'script', '林玄出场。');
        expect(result.reportPath).toBe(`${PROJECT}/剧本创作/05-质检/第1集_结算.md`);
        expect(await app.vault.readByPath(result.reportPath)).toContain('mode: script');
    });

    it('单元文件不存在：不写 frontmatter、不抛错、仍写报告', async () => {
        const { app, fmState } = makeHarness();

        const result = await settleModeUnit(app as unknown as ObsidianApp, { settleLight: vi.fn(async () => detail()) }, PROJECT, SHORT_UNIT, '第1节', 'short', '林玄出场。');

        expect(fmState.size).toBe(0);
        expect(await app.vault.readByPath(result.reportPath)).toContain('# 第1节 · 单元结算');
    });
});

describe('settleModeUnit — 部分失败可见性', () => {
    it('lightPartial + lightFailures：frontmatter 标 partial，报告写失败明细', async () => {
        const { app, fmState } = makeHarness();
        seedUnit(app, SHORT_UNIT);
        const partial = detail({
            lightPartial: true,
            lightFailures: { entities: ['林玄', '苏晚'], foreshadow: true, bodyFrontmatter: true },
        });

        const result = await settleModeUnit(app as unknown as ObsidianApp, { settleLight: vi.fn(async () => partial) }, PROJECT, SHORT_UNIT, '第1节', 'short', '林玄出场。');

        expect(fmState.get(SHORT_UNIT)!['settlement_partial']).toBe(true);
        const report = await app.vault.readByPath(result.reportPath);
        expect(report).toContain('部分更新失败（实体 2 个；伏笔库；正文状态）');
    });

    it('lightPartial 但无 lightFailures：不写失败提示行', async () => {
        const { app } = makeHarness();
        seedUnit(app, SHORT_UNIT);
        const partial = detail({ lightPartial: true });

        const result = await settleModeUnit(app as unknown as ObsidianApp, { settleLight: vi.fn(async () => partial) }, PROJECT, SHORT_UNIT, '第1节', 'short', '林玄出场。');
        expect(await app.vault.readByPath(result.reportPath)).not.toContain('部分更新失败');
    });
});
