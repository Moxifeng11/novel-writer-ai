/**
 * 模板流转单源约束：
 * - 所有步骤执行器必须经 `engine/prompt-resolver.ts#resolveStepPrompt`；
 * - 不允许在执行器里直接 `getStepTemplateAuto` 另拼一份；
 * - 缺模板兜底必须用构建期 assets，而不是手写第二份模板正文。
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('模板流转单源', () => {
    it('执行器统一走 resolveStepPrompt', () => {
        for (const rel of [
            'engine/step-runner.ts',
            'engine/step-specials.ts',
            'ui/full-writer-view.ts',
            'ui/full-writer/batch-pipeline-runner.ts',
        ]) {
            const source = read(rel);
            expect(source, rel).toContain('resolveStepPrompt');
            expect(source, rel).not.toContain('getStepTemplateAuto(');
        }
    });

    it('缺模板兜底使用 assets 生成物', () => {
        const source = read('engine/template-service.ts');
        expect(source).toContain("TEMPLATE_SCAFFOLD_FILES");
        expect(source).toContain('defaultTemplateContent');
    });

    it('渲染器支持 ${var} 与 {{var}}，并返回未解析变量', () => {
        const source = read('engine/prompt-resolver.ts');
        expect(source).toContain('export function renderTemplate');
        expect(source).toContain('unresolved');
    });

    it('写作规则契约只读 vault 唯一来源', () => {
        const source = read('engine/body-writer.ts');
        expect(source).toContain('VAULT_RULES_PATH');
        expect(source).not.toContain('pjWritingRules(project)');
    });
});
