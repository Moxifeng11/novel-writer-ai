/**
 * 同人设定审核闸门：向导保存路径（v4.83.1）
 *
 * 排查发现的真缺陷：11 步向导**没有审核步骤**，而 `executeFanficStep` 此前
 * 只做字段完整性校验，就把内容**直接写入正式目录并绑定** `.project`。
 * 于是「AI 生成 → 向导保存」绕过了「生成 → _待审核 → 人工审核 → 正式目录」这条闸门，
 * 未核实设定会被后续步骤当作原作约束消费。
 *
 * 修复口径（复用既有 `isFanficApproved`）：
 * - `approved` → 正式目录
 * - `legacy`（旧文件无审核记录）→ 正式目录（兼容，提示建议重新审核）
 * - `pending` / `rejected` → `_待审核`，且**不绑定**
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { isFanficApproved } from '../../../ui/full-writer/fanfic-settings-utils';
import { parseFanficReviewStatus } from '../../../shared/fanfic-rules';

const ROOT = path.resolve(__dirname, '../../..');

/** 构造带审核 meta 的设定内容 */
function draftWith(reviewStatus: 'approved' | 'pending' | 'rejected' | 'legacy'): string {
    const meta = reviewStatus === 'legacy'
        ? ''
        : `审核状态: ${reviewStatus}\n`;
    return `---
作品名称: 测试作品
作品类型: 长篇
作者: 某人
${meta}---

# 测试作品 同人设定

## 原作核心设定
- **世界观类型**：修真
- **力量体系**：练气筑基金丹
- **核心规则**：不可越级挑战
`;
}

describe('isFanficApproved — 向导放行口径', () => {
    it('approved 放行', () => {
        expect(isFanficApproved(draftWith('approved'))).toBe(true);
    });

    it('legacy（旧文件无审核记录）放行，避免阻塞历史项目', () => {
        expect(isFanficApproved(draftWith('legacy'))).toBe(true);
    });

    it('pending 拦截（AI 新生成的草稿默认就是 pending）', () => {
        expect(isFanficApproved(draftWith('pending'))).toBe(false);
    });

    it('rejected 拦截', () => {
        expect(isFanficApproved(draftWith('rejected'))).toBe(false);
    });

    it('完全无 frontmatter 的内容按 legacy 放行（与历史行为一致）', () => {
        expect(isFanficApproved('# 随便一段没有审核记录的文字')).toBe(true);
    });
});

describe('parseFanficReviewStatus — 状态解析口径', () => {
    it('四种状态解析正确', () => {
        expect(parseFanficReviewStatus(draftWith('approved'))).toBe('approved');
        expect(parseFanficReviewStatus(draftWith('pending'))).toBe('pending');
        expect(parseFanficReviewStatus(draftWith('rejected'))).toBe('rejected');
        expect(parseFanficReviewStatus(draftWith('legacy'))).toBe('legacy');
    });
});

describe('向导保存路径必须过闸门（源码契约）', () => {
    const executor = fs.readFileSync(
        path.join(ROOT, 'ui/full-writer/wizard-step-executors.ts'),
        'utf8',
    );

    it('executeFanficStep 在写正式目录前调用 isFanficApproved', () => {
        const stepStart = executor.indexOf('private async executeFanficStep');
        expect(stepStart).toBeGreaterThan(-1);
        const stepBody = executor.slice(stepStart, executor.indexOf('private async executeWorldviewStep'));
        // 闸门必须在写正式目录之前
        const gateIndex = stepBody.indexOf('isFanficApproved(content)');
        const formalWriteIndex = stepBody.indexOf('getFanficSettingsPath(');
        expect(gateIndex).toBeGreaterThan(-1);
        expect(formalWriteIndex).toBeGreaterThan(-1);
        expect(gateIndex).toBeLessThan(formalWriteIndex);
    });

    it('未通过审核时写入 _待审核 且不绑定项目', () => {
        const stepStart = executor.indexOf('private async executeFanficStep');
        const stepBody = executor.slice(stepStart, executor.indexOf('private async executeWorldviewStep'));
        expect(stepBody).toContain('pjFanficPendingDir');
        // 拦截分支里不能出现 attachFanficPathToProject
        const blockStart = stepBody.indexOf('if (!isFanficApproved(content))');
        const blockEnd = stepBody.indexOf('const filePath = getFanficSettingsPath');
        const blockedBranch = stepBody.slice(blockStart, blockEnd);
        expect(blockedBranch).not.toContain('attachFanficPathToProject');
    });
});
