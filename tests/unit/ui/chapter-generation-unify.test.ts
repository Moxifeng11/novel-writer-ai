import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Rev 184 源码契约：三个旧版章节生成工具必须统一到
 * `WriteChapterModal.doWriteChapter`（= 工作台 buildChapterPrompts + BodyWriter），
 * 不再自造 prompt；章范围以「已建骨架」为准；关闭弹窗可中止在途调用。
 *
 * 只做文本对账，不 import 这些 UI 模块（会拉起 main.js / obsidian）。
 */

const ROOT = path.resolve(__dirname, '../../..');
function read(rel: string): string {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const writeModal = read('ui/write-chapter-modal.ts');
const autoModal = read('ui/auto-writer-modal.ts');
const batchModal = read('ui/batch-chapters-modal.ts');

describe('章节生成三工具统一到工作台流水线', () => {
    it('doWriteChapter 公共化并支持中止信号', () => {
        expect(writeModal).toContain('public static async doWriteChapter');
        expect(writeModal).toContain('opts?.signal');
        expect(writeModal).toContain('generateChapterStream(');
    });

    it('整章生成复用工作台章节目标解析', () => {
        expect(writeModal).toContain('getActiveChapterTarget()');
    });

    it('自动写作器与批量写正文统一调用 doWriteChapter', () => {
        expect(autoModal).toContain('WriteChapterModal.doWriteChapter');
        expect(batchModal).toContain('WriteChapterModal.doWriteChapter');
    });

    it('不再自造正文 / 信息规划 / 分析报告 prompt', () => {
        expect(autoModal).not.toContain('generateInfoPlan');
        expect(autoModal).not.toContain('generateBody');
        expect(autoModal).not.toContain('generateAnalysis');
        expect(batchModal).not.toContain('reportSys');
        // 原批量写正文里硬编码的《雪中悍刀行》范文必须消失
        expect(batchModal).not.toContain('徐凤年');
        expect(batchModal).not.toContain('老黄');
    });

    it('章范围以骨架并集为准（不再只取已有正文）', () => {
        expect(autoModal).toContain('listChapterNumbers');
        expect(batchModal).toContain('listChapterNumbers');
    });

    it('关闭弹窗即中止在途调用', () => {
        expect(autoModal).toContain('this.abortController?.abort()');
        expect(batchModal).toContain('this.abortController?.abort()');
    });

    it('弹窗使用自适应表单尺寸与内边距容器', () => {
        for (const src of [writeModal, autoModal, batchModal]) {
            expect(src).toContain('nw-modal-form');
            expect(src).toContain('nw-form-stack');
        }
    });
});

describe('步骤结果查看弹窗缩小', () => {
    const src = read('ui/step-result-viewer-modal.ts');

    it('不再使用全局 96vw / 90vh 上限', () => {
        expect(src).not.toContain('--nw-modal-max-w');
        expect(src).not.toContain('--nw-modal-max-h');
    });

    it('使用专用小尺寸类', () => {
        expect(src).toContain("addClass('nw-step-viewer')");
    });

    it('窄屏隐藏模型与时间列', () => {
        expect(src).toContain('nw-step-viewer-meta');
    });
});

const ENTITY_MODALS = [
    'ui/unified-entity-manager-modal.ts',
    'ui/unified-entity-generate-modal.ts',
    'ui/existing-entity-manager.ts',
    'ui/generate-character-modal.ts',
    'ui/generate-faction-modal.ts',
    'ui/generate-location-modal.ts',
    'ui/generate-item-modal.ts',
    'ui/generate-worldview-modal.ts',
];

describe('设定与实体模块前端规范', () => {
    for (const rel of ENTITY_MODALS) {
        it(`${rel} 使用实体作用域类`, () => {
            expect(read(rel)).toContain('nw-entity-scope');
        });
    }

    const SIZE_EM = /font-size:0\.\d+em/;
    for (const rel of ENTITY_MODALS) {
        it(`${rel} 不再使用 em 相对字号`, () => {
            expect(read(rel)).not.toMatch(SIZE_EM);
        });
    }

    it('统一生成实体使用 900px 档并自适应字段网格', () => {
        const src = read('ui/unified-entity-generate-modal.ts');
        expect(src).toContain("addClass('nw-modal-lg')");
        // v4.80.0 批次 B3b：网格规则从内联样式迁到 styles-src，源码只留类名
        expect(src).toContain('nw-ue-type-grid');
        expect(read('styles-src/24-unified-entity.css')).toContain('repeat(auto-fit, minmax(220px, 1fr))');
        expect(src).not.toContain('grid-template-columns:repeat(2, 1fr)');
    });

    it('实体管理左栏可收缩', () => {
        const src = read('ui/unified-entity-manager-modal.ts');
        expect(src).toContain('nw-entity-manager-body');
        expect(src).toContain('nw-entity-manager-side');
        expect(src).not.toContain('width:240px; min-width:240px');
    });

    it('AI 构建器不再强制 96vw × 96vh', () => {
        const src = read('ui/ai-builder-modal.ts');
        expect(src).not.toContain("style.width = '96vw'");
        expect(src).not.toContain("style.height = '96vh'");
    });
});

describe('styles.css 补齐控件与实体规范', () => {
    const css = read('styles.css');

    it('按钮与输入框同高（32px）', () => {
        expect(css).toMatch(/\.nw-btn\s*\{\s*height:\s*32px;\s*min-height:\s*32px;\s*\}/);
    });

    it('新增表单弹窗与实体作用域规则', () => {
        expect(css).toContain('.modal.nw-scope.nw-modal-form');
        expect(css).toContain('.nw-form-grid');
        expect(css).toContain('.nw-entity-scope');
        expect(css).toContain('.nw-step-viewer');
    });

    it('补齐此前缺失的实体进度条类', () => {
        expect(css).toContain('.nw-gen-modal-progress-bar');
        expect(css).toContain('.nw-gen-modal-progress-fill');
        expect(css).toContain('.nw-gen-modal-prompt-label');
    });
});
