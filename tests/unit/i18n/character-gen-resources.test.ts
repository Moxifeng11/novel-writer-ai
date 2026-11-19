/**
 * character-gen-resources.test.ts — 人物生成弹窗（characterGen.*）双语资源
 *
 * 第33片把 ui/generate-character-modal.ts 的界面文案迁到 characterGen 组。
 * 这里锁两件事：中文文案与迁移前逐字一致（含 emoji），英文占位符插值可用。
 */
import { describe, expect, it } from 'vitest';
import { t, translate } from '../../../i18n';

describe('characterGen 中文文案（逐字保留）', () => {
    it('表单与按钮', () => {
        expect(t('characterGen.title')).toBe('👤 生成人物');
        expect(t('characterGen.manage')).toBe('📂 管理人物');
        expect(t('characterGen.generate')).toBe('🚀 批量生成人物');
        expect(t('characterGen.promptLabel')).toBe('✍️ 提示词（描述你想要的人物特点，AI 将据此生成名字和设定）');
        expect(t('characterGen.countHint')).toBe('（AI 自动命名，1-20 个）');
    });

    it('结果管理面板', () => {
        expect(t('characterGen.managementTitle')).toBe('📋 生成结果管理');
        expect(t('characterGen.rename')).toBe('✏️ 改名');
        expect(t('characterGen.editIdle')).toBe('📝 编辑');
        expect(t('characterGen.empty')).toBe('(空)');
        expect(t('characterGen.saveCount', { count: 3, label: '人物' })).toBe('💾 保存 3 个人物');
        expect(t('characterGen.savedCount', { count: 3, label: '人物' })).toBe('已保存 3 个人物');
    });

    it('进度与失败提示', () => {
        expect(t('characterGen.generating', { count: 2, model: 'doubao' })).toBe('⏳ 正在生成 2 个人物（模型：doubao）...');
        expect(t('characterGen.aiFailed', { message: 'boom' })).toBe('AI调用失败: boom');
        expect(t('characterGen.pendingSave', { active: 4 })).toBe('4 待保存');
        expect(t('characterGen.deletedSuffix', { count: 1 })).toBe(' / 1 已删除');
    });
});

describe('characterGen 英文资源', () => {
    it('核心标签与插值', () => {
        expect(translate('en-US', 'characterGen.title')).toBe('👤 Generate characters');
        expect(translate('en-US', 'characterGen.generate')).toBe('🚀 Batch generate characters');
        expect(translate('en-US', 'characterGen.generating', { count: 2, model: 'doubao' })).toBe(
            '⏳ Generating 2 characters (model: doubao)...'
        );
        expect(translate('en-US', 'characterGen.saveCount', { count: 3, label: 'characters' })).toBe('💾 Save 3 characters');
        expect(translate('en-US', 'characterGen.pendingSave', { active: 4 })).toBe('4 to save');
        expect(translate('en-US', 'characterGen.deletedSuffix', { count: 1 })).toBe(' / 1 deleted');
    });

    it('多行占位符与完整性提示', () => {
        const placeholder = translate('en-US', 'characterGen.promptPlaceholder');
        expect(placeholder.startsWith('For example:')).toBe(true);
        expect(placeholder).toContain('Leave blank');
        expect(translate('en-US', 'characterGen.integrityDropped', { count: 2, list: 'A\nB' })).toBe(
            '2 character(s) failed the integrity check and were discarded (not saved):\nA\nB'
        );
        expect(translate('en-US', 'characterGen.droppedAfterComplete', { name: 'A', fields: 'identity, motive' })).toBe(
            'A (still missing: identity, motive)'
        );
    });
});
