/**
 * 知识库界面的「添加同人设定」入口（v4.83.1）
 *
 * 用户要求：知识库里也要能直接进入「添加同人设定」。
 * 此前该入口只在命令面板、工具目录与项目选择器里。
 *
 * 这里用源码契约测试锁住两件事，避免后续重构把入口或参数弄丢：
 * 1. 知识库视图确实渲染了该入口按钮
 * 2. 打开弹窗时传的是**当前项目**（与命令入口口径一致），不是 undefined
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');

/**
 * 读取仓库内源码。
 *
 * @param rel - 仓库相对路径
 * @returns 文件内容
 */
function read(rel: string): string {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('知识库「添加同人设定」入口', () => {
    const view = read('ui/views/knowledge-base-view.ts');

    it('知识库视图引入并渲染了入口按钮', () => {
        expect(view).toContain("import { AddFanficSettingModal } from '@/ui/add-fanfic-setting-modal'");
        expect(view).toContain('添加同人设定');
        expect(view).toContain('new AddFanficSettingModal(');
    });

    it('打开时传入当前项目（与命令入口同口径）', () => {
        // 命令入口：new AddFanficSettingModal(app, plugin, project || undefined).open()
        expect(view).toMatch(/new AddFanficSettingModal\([^)]*getActiveProject\(\)[^)]*\)/);
    });

    it('入口按钮说明里提到「知识库已拆解的内容」（用户可发现新流程）', () => {
        expect(view).toContain('知识库已拆解');
    });
});

describe('命令入口保持一致', () => {
    const executor = read('ui/command-ui-executor.ts');

    it('命令面板入口仍传 activeProject', () => {
        expect(executor).toContain('case CommandIds.ADD_FANFIC:');
        expect(executor).toMatch(/new AddFanficSettingModal\(app, plugin, project \|\| undefined\)/);
    });
});
