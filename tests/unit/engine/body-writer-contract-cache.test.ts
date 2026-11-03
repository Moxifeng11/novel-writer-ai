/**
 * BodyWriter 格式契约缓存（P1-6）
 *
 * 规则文件是用户直接编辑的 vault 文件，没有任何「保存」回调可以挂。
 * 这里验证 resolveContract 用 mtime+size 指纹自愈：
 * 规则一改，任何持有缓存的 BodyWriter 实例下次解析都会重新推导。
 */
import { describe, it, expect } from 'vitest';
import { BodyWriter } from '../../../engine/body-writer';
import { MockFileSystem } from '../../../shared/file-system-port';
import { INDENT_TWO_FULL_WIDTH } from '../../../shared/body-format';
import { VAULT_RULES_PATH } from '../../../services/rules-registry';

const PROJECT = '长篇小说/缓存测试';
const RULES = VAULT_RULES_PATH;

class StampFileSystem extends MockFileSystem {
    mtime = 1;

    async getFileStamp(path: string): Promise<{ mtime: number; size: number } | null> {
        if (!(await this.exists(path))) return null;
        return { mtime: this.mtime, size: (await this.read(path)).length };
    }
}

describe('BodyWriter.resolveContract — 规则文件指纹', () => {
    it('规则内容变化（mtime 变化）后重新推导契约', async () => {
        const fs = new StampFileSystem();
        const writer = new BodyWriter({ fs });

        await fs.write(RULES, '每段开头空两格。');
        const first = await writer.resolveContract(PROJECT);
        expect(first.source).toBe('writing-rules');
        expect(first.indent).toBe(INDENT_TWO_FULL_WIDTH);
        expect(first.separator).toBe('\n');

        // 用户改了规则：段落之间空一行
        fs.mtime = 2;
        await fs.write(RULES, '每段之间空一行。');
        const second = await writer.resolveContract(PROJECT);
        expect(second.separator).toBe('\n\n');
    });

    it('规则未变时命中缓存（同一对象）', async () => {
        const fs = new StampFileSystem();
        const writer = new BodyWriter({ fs });

        await fs.write(RULES, '每段开头空两格。');
        const a = await writer.resolveContract(PROJECT);
        const b = await writer.resolveContract(PROJECT);
        expect(b).toBe(a);
    });

    it('invalidateContractCache 仍可强制清除实例缓存', async () => {
        const fs = new StampFileSystem();
        const writer = new BodyWriter({ fs });

        await fs.write(RULES, '每段开头空两格。');
        const a = await writer.resolveContract(PROJECT);
        writer.invalidateContractCache(PROJECT);
        const b = await writer.resolveContract(PROJECT);
        expect(b).not.toBe(a);
        expect(b.source).toBe('writing-rules');
    });

    it('规则文件被删掉后回落到默认契约', async () => {
        const fs = new StampFileSystem();
        const writer = new BodyWriter({ fs });

        await fs.write(RULES, '每段开头空两格。');
        await writer.resolveContract(PROJECT);

        await fs.delete(RULES);
        const after = await writer.resolveContract(PROJECT);        expect(after.source).toBe('default');
    });
});
