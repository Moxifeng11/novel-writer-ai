/**
 * Rev 189 回归：refreshContextBar 重新渲染上下文面板前必须移除旧面板。
 *
 * 旧实现移除的是 `.novel-writer-fw-context-card`（全库没有创建点，等于空操作），
 * 导致每次保存设置后往 workspace 里再 append 一个 `.novel-writer-fw-context-panel`。
 * workspace 是三列 grid，第 4 个子元素会把 grid-template-rows 撑成 "0px 692px"，
 * 第一章整体塌成一条缝。
 */
import { describe, it, expect } from 'vitest';
import { App } from 'obsidian';
import { EntityStateController } from '../../../ui/full-writer/entity-state-controller';

describe('EntityStateController.refreshContextBar — 旧上下文面板必须被移除', () => {
    it('只查询并移除 .novel-writer-fw-context-panel，随后 render 一次', () => {
        const queried: string[] = [];
        const removed: string[] = [];
        const workspace = {
            querySelectorAll: (selector: string) => {
                queried.push(selector);
                return {
                    forEach: (fn: (el: { remove: () => void }) => void) =>
                        fn({ remove: () => removed.push(selector) }),
                };
            },
        } as unknown as HTMLElement;

        let renderCalls = 0;
        const controller = new EntityStateController({
            app: new App(),
            plugin: {
                settings: { contextScope: 'full' },
                _involvedChars: new Set<string>(),
                _involvedLocs: new Set<string>(),
                _involvedFactions: new Set<string>(),
                _involvedItems: new Set<string>(),
            } as never,
            aiEngine: {} as never,
            state: { project: '测试书', chapterNum: 1, volume: '第1卷', chapterName: '第1章' } as never,
            getContext: () => null,
            getContextPanel: () => ({ render: () => { renderCalls++; } }) as never,
            getWorkspace: () => workspace,
            estimateTotalChars: () => 0,
        });

        controller.refreshContextBar();

        expect(queried).toEqual(['.novel-writer-fw-context-panel']);
        expect(removed).toEqual(['.novel-writer-fw-context-panel']);
        expect(renderCalls).toBe(1);
    });

    it('workspace 不存在时不渲染、不报错', () => {
        const controller = new EntityStateController({
            app: new App(),
            plugin: { settings: { contextScope: 'full' } } as never,
            aiEngine: {} as never,
            state: { project: '测试书', chapterNum: 1, volume: '第1卷', chapterName: '第1章' } as never,
            getContext: () => null,
            getContextPanel: () => ({ render: () => { throw new Error('不应被调用'); } }) as never,
            getWorkspace: () => null,
            estimateTotalChars: () => 0,
        });

        expect(() => controller.refreshContextBar()).not.toThrow();
    });
});
