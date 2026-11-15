/**
 * M2 标签写入回归：幂等追加、不覆盖 nw/* 与用户标签
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('M2 标签写入', () => {
    it('step-result-saver 不再整数组覆盖 tags', () => {
        const source = read('engine/step-result-saver.ts');
        expect(source).not.toMatch(/fm\['tags'\] = \['(信息规划|大纲摘要|分析报告|审查报告|自检报告|修正记录|最终修正|情节蒸馏|质量控制)'\]/);
        expect(source).toContain('STEP_TAGS');
        expect(source).toContain('Array.from(new Set([...existing, stepTag]))');
    });

    it('body-writer 同时写 legacy 与 nw/正文', () => {
        const source = read('engine/body-writer.ts');
        expect(source).toContain("'正文', 'nw/正文'");
    });

    it('标签映射表覆盖全部步骤', () => {
        const source = read('engine/step-result-saver.ts');
        for (const key of ['infoPlan', 'outline', 'analysisReport', 'continuityCheck', 'selfCheck', 'fix', 'finalFix', 'plotDistill', 'qualityControl']) {
            expect(source, key).toContain(`${key}:`);
        }
    });
});
