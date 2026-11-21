/**
 * ModalDirtyGuard 接线不变量（ZC-20261120-27 回归）。
 *
 * 组件本身的行为由 modal-dirty-guard.test.ts 覆盖；这里锁的是**接线**——
 * 组件写对了但没接上（或接了却漏了 markClean），用户侧问题依旧存在：
 * - plan-book：生成成功已落盘，关闭前必须 markClean，否则成功后被问「丢弃修改」；
 * - add-fanfic：所有主动完成（草稿/绑定/生成）的关闭都要 markClean，且不许重复插桩。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function source(file: string): string {
    return readFileSync(resolve(process.cwd(), file), 'utf8');
}

function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('plan-book 成功关闭前解除脏标记', () => {
    it('生成成功写盘后先 markClean 再 close，再打开大纲树', () => {
        const src = stripComments(source('ui/plan-book-modal.ts'));
        expect(src).toMatch(/writeVolumeOutlines[\s\S]{0,1500}markClean\(\);\s*\n\s*this\.close\(\);\s*\n\s*new ChapterOutlineTreeModal/);
    });
});

describe('add-fanfic 关闭路径逐条 markClean', () => {
    const src = stripComments(source('ui/add-fanfic-setting-modal.ts'));
    const lines = src.split('\n');

    it('每个 this.close() 之前都有 markClean', () => {
        const closeLines = lines
            .map((text, index) => ({ text, index }))
            .filter((entry) => entry.text.includes('this.close();'));
        expect(closeLines.length).toBeGreaterThanOrEqual(4);
        for (const entry of closeLines) {
            const preceding = lines.slice(Math.max(0, entry.index - 4), entry.index).join('\n');
            expect(preceding, `第 ${entry.index + 1} 行的 close 缺少 markClean`).toContain('markClean();');
        }
    });

    it('没有重复插桩（曾经连插三次）', () => {
        expect(src).not.toMatch(/markClean\(\);\s*\n\s*markClean\(\);/);
    });
});

/** 逐个文件断言：装了 guard 且真的 attach 到本 Modal（漏 attach = 装了没用）。 */
const GUARDED_FILES = [
    'ui/golden-opening-modal.ts',
    'ui/views/knowledge-base-modals.ts',
    'ui/template-manager.ts',
    'ui/style-distiller-modal.ts',
    'ui/create-project-modal.ts',
    'ui/ai-builder-modal.ts',
    'ui/outline-expand-modal.ts',
    'ui/unified-entity-generate-modal.ts',
    'ui/pre-research-modal.ts',
    'ui/fingerprint-library-modal.ts',
    'ui/ideation-modal.ts',
    'ui/generate-worldview-modal.ts',
    'ui/generate-character-modal.ts',
    'ui/generate-faction-modal.ts',
    'ui/generate-item-modal.ts',
    'ui/generate-location-modal.ts',
];

describe('高危表单弹窗的 ModalDirtyGuard 接线（第一百三十一轮 + A-5 扩面）', () => {
    for (const file of GUARDED_FILES) {
        const src = stripComments(source(file));
        it(`${file} 安装并 attach guard，且至少一处 markClean`, () => {
            expect(src).toContain('new ModalDirtyGuard()');
            expect(src).toMatch(/dirtyGuard\.attach\(this, this\.app\)/);
            expect(src).toContain('dirtyGuard.markClean()');
        });
    }

    it('知识库两个编辑弹窗的成功/取消出口都有 markClean（≥8 处）', () => {
        const src = stripComments(source('ui/views/knowledge-base-modals.ts'));
        const count = src.match(/markClean\(\)/g)?.length ?? 0;
        expect(count).toBeGreaterThanOrEqual(8);
        // 两个 Modal 各一份 guard
        expect(src.match(/new ModalDirtyGuard\(\)/g)?.length).toBe(2);
    });

    it('文笔蒸馏三个出口（自动存库 / 写入项目 / 存入风格库）都不再询问', () => {
        const src = stripComments(source('ui/style-distiller-modal.ts'));
        expect(src.match(/markClean\(\)/g)?.length).toBeGreaterThanOrEqual(3);
        expect(src).toMatch(/saveToProject[\s\S]{0,200}markClean\(\);\s*\n\s*this\.close\(\);/);
        expect(src).toMatch(/saveToStyleLib[\s\S]{0,200}markClean\(\);\s*\n\s*this\.close\(\);/);
    });

    it('模板编辑弹窗取消与保存/删除都 markClean（保留弹窗仍可正常关闭）', () => {
        const src = stripComments(source('ui/template-manager.ts'));
        expect(src.match(/markClean\(\)/g)?.length).toBeGreaterThanOrEqual(3);
    });

    it('创建项目：取消与创建成功都先 markClean 再 close', () => {
        const src = stripComments(source('ui/create-project-modal.ts'));
        expect(src).toMatch(/cancelBtn\.onclick = \(\) => \{\s*\n\s*this\.dirtyGuard\.markClean\(\);\s*\n\s*this\.close\(\);/);
        expect(src).toMatch(/showWarningNotice\(t\('createProject\.prefillFailed'\)[\s\S]{0,200}markClean\(\);\s*\n\s*this\.close\(\);/);
    });

    it('大纲扩写：头部关闭、底部取消、写入/复制成功后都 markClean', () => {
        const src = stripComments(source('ui/outline-expand-modal.ts'));
        expect(src.match(/markClean\(\)/g)?.length).toBeGreaterThanOrEqual(4);
    });

    it('预研：取消、写盘成功、创建项目收尾都 markClean', () => {
        const src = stripComments(source('ui/pre-research-modal.ts'));
        expect(src).toMatch(/cancel\.onclick = \(\) => \{\s*\n\s*this\.dirtyGuard\.markClean\(\);/);
        expect(src.match(/markClean\(\)/g)?.length).toBeGreaterThanOrEqual(4);
    });

    it('添加指纹：取消与提取成功都先 markClean 再 close', () => {
        const src = stripComments(source('ui/fingerprint-library-modal.ts'));
        expect(src).toMatch(/addEventListener\('click', \(\) => \{\s*\n\s*this\.dirtyGuard\.markClean\(\);\s*\n\s*this\.close\(\);/);
        expect(src).toMatch(/指纹提取完成[\s\S]{0,120}markClean\(\);[\s\n]*this\.close\(\);/);
    });

    it('脑洞构思：保存到项目成功后 markClean（弹窗只有成功出口会关闭）', () => {
        const src = stripComments(source('ui/ideation-modal.ts'));
        expect(src).toMatch(/markClean\(\);\s*\n\s*this\.close\(\);/);
    });

    it('生成世界观：写入完成后先 markClean 再 close', () => {
        const src = stripComments(source('ui/generate-worldview-modal.ts'));
        expect(src).toMatch(/markClean\(\);\s*\n\s*this\.close\(\);/);
    });

    for (const [file, label] of [
        ['ui/generate-faction-modal.ts', 'factions'],
        ['ui/generate-item-modal.ts', 'items'],
        ['ui/generate-location-modal.ts', 'locations'],
    ] as const) {
        it(`${file}：保存成功与管理入口都不再询问`, () => {
            const src = stripComments(source(file));
            // 这些文件是 CRLF，按 \r?\n 匹配，否则静默不命中
            expect(src).toMatch(new RegExp(`markClean\\(\\);\\r?\\n\\s*showSuccess\\(formatSaveOutcome\\(outcome, '${label}'\\)\\)`));
            expect(src).toMatch(/markClean\(\);\s*\n\s*this\.close\(\);\s*\n\s*new ExistingEntityManagerModal/);
        });
    }

    it('生成角色：保存成功页出现前 markClean，管理入口跳转也不询问', () => {
        const src = stripComments(source('ui/generate-character-modal.ts'));
        expect(src).toMatch(/markClean\(\);\s*\n\s*await this\.ensureProtagonistMarked/);
        expect(src).toMatch(/markClean\(\);\s*\n\s*this\.close\(\);\s*\n\s*new ExistingEntityManagerModal/);
    });

    it('全书简介弹窗不需要 guard：onClose 先落草稿再清空，关闭不丢内容', () => {
        const src = stripComments(source('ui/volume-intro-modal.ts'));
        expect(src).toMatch(/onClose\(\): void \{\s*\n\s*void this\.flushDraftAndClear\(\);/);
        expect(src).not.toContain('new ModalDirtyGuard()');
    });
});

describe('世界观生成按钮防重复提交（A-1 复核补漏）', () => {
    const src = stripComments(source('ui/generate-worldview-modal.ts'));

    it('用 withButtonBusy 包裹 generateWorldview，忙碌文案复用 planBook.generating', () => {
        expect(src).toContain('withButtonBusy');
        expect(src).toMatch(/withButtonBusy\(\s*generateButton,\s*t\('planBook\.generating'\)/);
        expect(src).toMatch(/withButtonBusy\([\s\S]{0,300}generateWorldview\(/);
    });

    it('不再存在裸的 onclick 直接 await generateWorldview', () => {
        expect(src).not.toMatch(/onclick = async \(\) => \{\s*\n\s*await this\.generateWorldview\(/);
    });
});
