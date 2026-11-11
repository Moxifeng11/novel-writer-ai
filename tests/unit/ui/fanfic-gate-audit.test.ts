/**
 * 阶段 B4：同人设定审核闸门审计
 *
 * 长期目标阶段 B 第四项：**所有写正式目录（`05-同人设定库`）的路径都必须过审核闸门**。
 *
 * 背景：A3 修好了向导路径（`executeFanficStep` 曾直接写正式目录并绑定），
 * 但闸门是分散在多个入口的，新增一条写入路径就可能重新打开缺口。
 * 本文件把「哪些路径写正式目录、各自怎么过闸门」固化成契约，
 * 任何一条被改动都会让测试失败。
 *
 * 审计结论（2026-11-11）：4 条写入路径，全部有闸门。
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');

/**
 * 读取源码。
 *
 * @param rel - 仓库相对路径
 * @returns 文件内容
 */
function read(rel: string): string {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('B4-1：向导保存路径（A3 修复）', () => {
    const executor = read('ui/full-writer/wizard-step-executors.ts');

    it('写正式目录前调用 isFanficApproved', () => {
        const stepStart = executor.indexOf('private async executeFanficStep');
        const stepBody = executor.slice(stepStart, executor.indexOf('private async executeWorldviewStep'));
        const gateIndex = stepBody.indexOf('isFanficApproved(content)');
        const formalWriteIndex = stepBody.indexOf('getFanficSettingsPath(');
        expect(gateIndex).toBeGreaterThan(-1);
        expect(formalWriteIndex).toBeGreaterThan(-1);
        expect(gateIndex).toBeLessThan(formalWriteIndex);
    });

    it('未通过审核时写入 _待审核 且不绑定', () => {
        const stepStart = executor.indexOf('private async executeFanficStep');
        const stepBody = executor.slice(stepStart, executor.indexOf('private async executeWorldviewStep'));
        const blockStart = stepBody.indexOf('if (!isFanficApproved(content))');
        const blockEnd = stepBody.indexOf('const filePath = getFanficSettingsPath');
        const blocked = stepBody.slice(blockStart, blockEnd);
        expect(blocked).toContain('pjFanficPendingDir');
        expect(blocked).not.toContain('attachFanficPathToProject');
    });
});

describe('B4-2：创建项目时复制设定', () => {
    const service = read('ui/services/project-create-service.ts');

    it('复制前校验审核状态，不通过直接拒绝创建', () => {
        const gateIndex = service.indexOf('isFanficApproved(content)');
        const copyIndex = service.indexOf('const content = await adapter.read(fanficSettingPath)');
        expect(gateIndex).toBeGreaterThan(-1);
        expect(copyIndex).toBeGreaterThan(-1);
        // 闸门在复制之前
        expect(gateIndex).toBeLessThan(copyIndex);
        expect(service).toContain('所选同人设定尚未通过人工审核');
    });
});

describe('B4-3：绑定入口', () => {
    const utils = read('ui/full-writer/fanfic-settings-utils.ts');

    it('attachFanficPathToProject 自身校验审核状态', () => {
        const fnStart = utils.indexOf('export async function attachFanficPathToProject');
        expect(fnStart).toBeGreaterThan(-1);
        const fnBody = utils.slice(fnStart, fnStart + 2000);
        expect(fnBody).toContain('isFanficApproved');
        expect(fnBody).toContain('尚未通过人工审核');
    });
});

describe('B4-4：审核通过后才写正式目录', () => {
    const modal = read('ui/fanfic-review-modal.ts');

    it('正式目录写入发生在审核动作里（approvedPath）', () => {
        expect(modal).toContain('approvedPath');
        expect(modal).toContain('saveFanficSettingFile');
    });
});

describe('B4-5：生成草稿只写待审核目录', () => {
    const addModal = read('ui/add-fanfic-setting-modal.ts');

    it('两条生成路径都写入 _待审核', () => {
        // 原有「依据官方来源生成」与新「从知识库生成并验证」
        const pendingWrites = addModal.match(/pjFanficPendingDir\(/g) ?? [];
        expect(pendingWrites.length).toBeGreaterThanOrEqual(2);
    });

    it('不直接写正式目录（pjFanficDir 只用于展示/路径提示）', () => {
        // pjFanficDir 在弹窗里只用于「保存位置说明」与模板路径，不用于保存草稿
        expect(addModal).toContain('pjFanficPendingDir');
        // 若未来有人把草稿直接写 pjFanficDir，这条会失败
        const directFormalWrite = /writeVaultText\([^)]*pjFanficDir\(/.test(addModal)
            || /saveFanficSettingFile\([^)]*pjFanficDir\(/.test(addModal);
        expect(directFormalWrite).toBe(false);
    });
});
