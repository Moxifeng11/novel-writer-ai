/**
 * template-scaffold.test.ts — P0 分发自举：全新安装的模板树初始化
 *
 * 覆盖：
 * - 空 vault 首次自举（关键模板齐全、内容非空）
 * - 幂等性与用户修改保护
 * - 部分缺失补齐
 * - 单文件失败不阻断其余文件
 * - 内置模板不含第三方作品原文
 */
import { describe, it, expect } from 'vitest';
import { ensureTemplateScaffold, TEMPLATE_ROOT } from '../../../shared/template-scaffold';
import { TEMPLATE_SCAFFOLD_FILES } from '../../../shared/template-scaffold-assets.generated';

const TOTAL = Object.keys(TEMPLATE_SCAFFOLD_FILES).length;

class FakeAdapter {
    files = new Map<string, string>();
    dirs = new Set<string>();
    failWrites = new Set<string>();

    async exists(path: string): Promise<boolean> {
        return this.files.has(path) || this.dirs.has(path);
    }

    async mkdir(path: string): Promise<void> {
        this.dirs.add(path);
    }

    async write(path: string, data: string): Promise<void> {
        if (this.failWrites.has(path)) {
            throw new Error('simulated write failure');
        }
        this.files.set(path, data);
    }
}

/**
 * 模板自举写入走 `writeVaultText`（vault 索引写入，新装用户才能在文件浏览器看到模板），
 * 因此 App 替身需要覆盖 ObsidianFileSystem.write 用到的 vault 方法，而不只是 adapter。
 *
 * `getAbstractFileByPath` 恒返回 null：本用例只对「缺失文件」走写分支，新建文件在
 * 真实 Obsidian 里同样落到 `vault.create`；已存在文件在 exists 阶段就被 skipped。
 */
function makeApp(adapter: FakeAdapter) {
    return {
        vault: {
            adapter,
            configDir: '.obsidian',
            getAbstractFileByPath: () => null,
            createFolder: async (path: string): Promise<void> => {
                adapter.dirs.add(path);
            },
            create: async (path: string, data: string): Promise<void> => {
                // failWrites 命中时抛错，用于覆盖「单文件失败不阻断其余文件」
                if (adapter.failWrites.has(path)) throw new Error('simulated write failure');
                adapter.files.set(path, data);
            },
            modify: async (): Promise<void> => {
                throw new Error('unexpected vault.modify: 缺失文件不应走 modify 分支');
            },
        },
    } as unknown as Parameters<typeof ensureTemplateScaffold>[0];
}

describe('ensureTemplateScaffold（P0 模板自举）', () => {
    it('空 vault 首次自举：生成全部模板且关键文件非空', async () => {
        const adapter = new FakeAdapter();
        const result = await ensureTemplateScaffold(makeApp(adapter));

        expect(result).toEqual({ created: TOTAL, skipped: 0, failed: 0 });
        expect(adapter.files.size).toBe(TOTAL);
        expect(adapter.dirs.has(TEMPLATE_ROOT)).toBe(true);
        expect(adapter.dirs.has(`${TEMPLATE_ROOT}/00-系统模板`)).toBe(true);

        const critical = [
            '00-系统模板/写作规则.md',
            '00-系统模板/世界观模板.md',
            '00-系统模板/设定库模板.md',
            '00-系统模板/文笔风格模板.md',
            '00-系统模板/正文模板.md',
            '01-世界架构/世界观总览.md',
            '02-时间线与伏笔/伏笔库.md',
            '作品信息.md',
        ];
        for (const path of critical) {
            const content = adapter.files.get(`${TEMPLATE_ROOT}/${path}`);
            expect(content, `缺少关键模板: ${path}`).toBeTruthy();
            expect(content!.trim().length).toBeGreaterThan(0);
        }
    });

    it('幂等：重复调用不重复写入，也不覆盖用户修改', async () => {
        const adapter = new FakeAdapter();
        await ensureTemplateScaffold(makeApp(adapter));

        const target = `${TEMPLATE_ROOT}/00-系统模板/正文模板.md`;
        adapter.files.set(target, '用户自定义正文模板');

        const second = await ensureTemplateScaffold(makeApp(adapter));
        expect(second).toEqual({ created: 0, skipped: TOTAL, failed: 0 });
        expect(adapter.files.get(target)).toBe('用户自定义正文模板');
    });

    it('部分缺失：只补齐缺失文件', async () => {
        const adapter = new FakeAdapter();
        const existing = `${TEMPLATE_ROOT}/00-系统模板/正文模板.md`;
        adapter.dirs.add(TEMPLATE_ROOT);
        adapter.files.set(existing, '已存在');

        const result = await ensureTemplateScaffold(makeApp(adapter));
        expect(result.created).toBe(TOTAL - 1);
        expect(result.skipped).toBe(1);
        expect(adapter.files.get(existing)).toBe('已存在');
    });

    it('单文件写入失败不阻断其余文件', async () => {
        const adapter = new FakeAdapter();
        const failing = `${TEMPLATE_ROOT}/00-系统模板/写作规则.md`;
        adapter.failWrites.add(failing);

        const result = await ensureTemplateScaffold(makeApp(adapter));
        expect(result.failed).toBe(1);
        expect(result.created).toBe(TOTAL - 1);
        expect(adapter.files.has(failing)).toBe(false);
        expect(adapter.files.has(`${TEMPLATE_ROOT}/00-系统模板/正文模板.md`)).toBe(true);
    });
});

describe('内置模板内容边界', () => {
    it('不包含第三方作品原文或示例项目名', () => {
        const forbidden = ['徐凤年', '雪中悍刀行', '斗罗大陆', '哈利波特', '霓虹悬城'];
        for (const [path, content] of Object.entries(TEMPLATE_SCAFFOLD_FILES)) {
            for (const word of forbidden) {
                expect(content.includes(word), `${path} 含受限内容: ${word}`).toBe(false);
            }
        }
    });
});
