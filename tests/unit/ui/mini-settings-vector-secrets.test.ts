/**
 * 迷你设置的向量密钥展示（B1）
 *
 * 三个向量密钥曾直接把 settings 里的值塞进输入框：
 * 加密锁定态会把密文露出来；用户误编辑/清空后会把已保存密钥写坏。
 * 现在与主 API Key 同口径：密文留空 + 解锁提示，空值不写回。
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.resolve(__dirname, '../../..');
// v4.27：向量密钥字段随设置分区收敛到 knowledge-section
const source = fs.readFileSync(path.join(root, 'ui/settings/knowledge-section.ts'), 'utf8');

describe('向量密钥字段', () => {
    it('三个 provider 都走 describeSecretForInput', () => {
        expect(source).toContain("describeSecretForInput(this.plugin.settings.vectorOpenaiApiKey || '')");
        expect(source).toContain("describeSecretForInput(this.plugin.settings.vectorDoubaoApiKey || '')");
        expect(source).toContain("describeSecretForInput(this.plugin.settings.vectorQwenApiKey || '')");
    });

    it('不再把 settings 值直接 setValue 到输入框', () => {
        expect(source).not.toContain("setValue(this.plugin.settings.vectorOpenaiApiKey");
        expect(source).not.toContain("setValue(this.plugin.settings.vectorDoubaoApiKey");
        expect(source).not.toContain("setValue(this.plugin.settings.vectorQwenApiKey");
    });

    it('空输入不覆盖已保存密钥（密文锁定态）', () => {
        expect(source).toContain('if (!next) return;');
        expect(source).toContain('this.plugin.settings.vectorOpenaiApiKey = next');
        expect(source).toContain('this.plugin.settings.vectorDoubaoApiKey = next');
        expect(source).toContain('this.plugin.settings.vectorQwenApiKey = next');
    });
});
