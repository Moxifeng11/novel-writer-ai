/**
 * 工作台首页接线测试（2026-11-16，A3/B1/C1/D2/E1）
 *
 * 这些是结构约束，跑真实渲染代价高（要 Obsidian 视图 + 项目文件）：
 * 1. 项目网格按最近使用排序并记录打开时间（B1）；
 * 2. 右栏有「下一步」主操作卡，且与流程快照同源（D2）；
 * 3. 低频卡片动作收进「⋯」菜单，删除不再裸露（E1）；
 * 4. 旧版工具默认折叠（C1）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

describe('B1 最近排序', () => {
    const controller = read('ui/full-writer/project-selector-controller.ts');

    it('项目网格按最近使用排序', () => {
        expect(controller).toContain('sortProjectsByRecent(');
        expect(controller).toContain('this.plugin.settings.projectLastOpened');
    });

    it('打开项目时记录时间并落盘', () => {
        expect(controller).toContain('noteProjectOpened(');
        expect(controller).toContain('recordProjectOpened(');
        expect(controller).toContain('void this.plugin.saveSettings()');
    });

    it('卡片显示最近使用标签（排序可解释）', () => {
        expect(controller).toContain('formatRecentLabel(');
        expect(controller).toContain('novel-writer-fw-card-recent');
    });
});

describe('D2 下一步主操作卡', () => {
    const controller = read('ui/full-writer/project-selector-controller.ts');

    it('右栏先渲染主操作卡，再渲染详情与流程摘要', () => {
        const nextIdx = controller.indexOf('this.renderNextStepCard(');
        const detailIdx = controller.indexOf('await this.renderProjectDetail(');
        expect(nextIdx).toBeGreaterThan(0);
        expect(detailIdx).toBeGreaterThan(nextIdx);
    });

    it('流程快照只采集一次（主操作卡与摘要共用）', () => {
        expect(controller).toContain('collectSnapshotSafe(');
        const calls = controller.match(/await this\.collectSnapshotSafe\(/g) ?? [];
        expect(calls).toHaveLength(1);
    });

    it('动作分发覆盖流程动作全集', () => {
        for (const action of ['wizard', 'research', 'document', 'create-units', 'write-unit', 'settle', 'export']) {
            expect(controller).toContain(`case '${action}':`);
        }
    });
});

describe('E1 卡片动作收纳', () => {
    const controller = read('ui/full-writer/project-selector-controller.ts');

    it('有「⋯」更多操作按钮', () => {
        expect(controller).toContain('novel-writer-fw-card-more-btn');
        expect(controller).toContain("text: '⋯'");
    });

    it('删除与重命名改由菜单触发，不再有裸露的删除按钮类', () => {
        expect(controller).not.toContain('novel-writer-fw-card-delete-btn');
        // i18n 第二期第18片：源码断言改键 + 读 zh 资源确认原文
        expect(controller).toContain("setTitle(t('fullwriter.selector.menuDelete'))");
        expect(controller).toContain("setTitle(t('fullwriter.selector.menuRename'))");
        expect(read('i18n/messages/zh-CN.ts')).toContain('🗑️ 删除项目');
        expect(read('i18n/messages/zh-CN.ts')).toContain('✏️ 重命名项目');
    });
});

describe('C1 旧版工具折叠（2026-11-19 起改为整组删除）', () => {
    const catalog = read('domains/long/tool-catalog.ts');

    it('旧版工具组已随命令一并删除，目录里不再有「（旧）」入口', () => {
        // C1 最初把三个旧生成工具折进默认收起的分组；4 条 internalOnly 命令删除后，
        // 分组里的按钮已无执行体，整组删除（见 docs/planning/2026-11-19-legacy-modal-retirement.md §八）。
        expect(catalog).not.toContain('📦 旧版工具');
        expect(catalog).not.toContain('（旧）');
        expect(catalog).not.toContain('novel-writer-write-chapter');
        expect(catalog).not.toContain('novel-writer-auto-writer');
        expect(catalog).not.toContain('novel-writer-batch-chapters');
    });

    it('章节生成组只保留批量建章', () => {
        const chapterGroupIdx = catalog.indexOf("label: '📝 章节生成'");
        const nextGroupIdx = catalog.indexOf("label: '🌍 设定与实体'");
        const chapterGroup = catalog.slice(chapterGroupIdx, nextGroupIdx);
        expect(chapterGroup).toContain('批量建章');
        expect(chapterGroup).not.toContain('（旧）');
    });
});
