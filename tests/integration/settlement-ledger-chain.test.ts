import { describe, expect, it } from 'vitest';
import { App } from '../__mocks__/obsidian';
import type { App as ObsidianApp } from 'obsidian';
import { ObsidianFileSystem } from '../../shared/file-system-port';
import { appendEventToContent, appendForeshadowToContent } from '../../engine/ledger/ledger-write';
import { invalidateStoryLedger, loadStoryLedger } from '../../engine/ledger/ledger-io';
import { renderLinkageIndex } from '../../engine/ledger/ledger-link';
import { writeChapterDigestFromProject } from '../../engine/memory/chapter-digest';
import { pjChapterDigestFile, pjForeshadowDB, pjTimelineBoard } from '../../shared/paths';

/**
 * 维度④ 二轮（2026-11-10 审计）契约：结算写入器 → 台账解析/缓存 → 章节摘要 → 关联索引
 * 这条串联链此前没有任何行为断言（各段单测互不相连）；本文件用真实写入器 + 真实
 * ObsidianFileSystem 断言「写进去的格式能被读回来、摘要与索引拿到的是同一批记录」。
 */

const PROJECT = '长篇小说/链路测试书';
const TIMELINE = pjTimelineBoard(PROJECT);
const FORESHADOW = pjForeshadowDB(PROJECT);

function seed(app: App, path: string, content: string): void {
    (app.vault as unknown as { _seedFile: (p: string, c: string) => void })._seedFile(path, content);
}

describe('结算 → 台账 → 摘要 → 关联索引 串联契约', () => {
    it('写入器产出的行能被台账读回，摘要与关联索引拿到同一批记录', async () => {
        const app = new App();
        const fs = new ObsidianFileSystem(app as unknown as ObsidianApp);
        seed(app, TIMELINE, '');
        seed(app, FORESHADOW, '');

        // 1) 用结算实际使用的唯一写入器写台账（两次写同一份内容验证幂等）
        const event1 = appendEventToContent('', {
            name: '码头遇袭', time: '深夜', chapterKey: '第1章', impact: '林玄受伤', importance: 'high',
        });
        const event2 = appendEventToContent(event1.content, {
            name: '码头遇袭', time: '深夜', chapterKey: '第1章', impact: '林玄受伤', importance: 'high',
        });
        expect(event1.changed).toBe(true);
        expect(event2.changed).toBe(false);

        const fs1 = appendForeshadowToContent('', {
            name: '玉佩', importance: '高', buryChapter: '第1章', plannedReveal: '第3章', relatedChars: '林玄',
        });
        expect(fs1.changed).toBe(true);
        await fs.write(TIMELINE, event1.content);
        await fs.write(FORESHADOW, fs1.content);
        invalidateStoryLedger(PROJECT);

        // 2) 台账能读回写入的事件/伏笔（格式漂移会让这里先红）
        const ledger = await loadStoryLedger(app as unknown as ObsidianApp, PROJECT);
        expect(ledger.events.map((e) => e.name)).toContain('码头遇袭');
        expect(ledger.events[0].chapterNum).toBe(1);
        expect(ledger.foreshadows.map((f) => f.name)).toContain('玉佩');
        expect(ledger.foreshadows[0].plannedReveal).toBe('第3章');

        // 3) 章节摘要从同一台账生成并落盘，事件/线索字段一致
        const digest = await writeChapterDigestFromProject(app as unknown as ObsidianApp, fs, PROJECT, '第1章', '林玄在码头遇袭。', ['林玄']);
        expect(digest.events).toEqual(['码头遇袭']);
        expect(digest.unresolved).toEqual(['玉佩']);
        expect(digest.involved).toContain('林玄');
        const digestFile = app.vault.getAbstractFileByPath(pjChapterDigestFile(PROJECT, '第1章'));
        expect(digestFile).not.toBeNull();
        expect(await fs.read(pjChapterDigestFile(PROJECT, '第1章'))).toContain('码头遇袭');

        // 4) 关联索引渲染来自同一批记录（不丢章、不丢行）
        const index = renderLinkageIndex(ledger, '2026-11-10T00:00:00.000Z');
        expect(index).toContain('## 第1章');
        expect(index).toContain('码头遇袭');
        expect(index).toContain('玉佩');
        expect(index).toContain('- 事件：1');
        expect(index).toContain('- 伏笔：1');
    });

    it('台账文件变更后缓存失效：新写入的事件立即出现在下一次读取', async () => {
        const app = new App();
        const fs = new ObsidianFileSystem(app as unknown as ObsidianApp);
        const first = appendEventToContent('', { name: '入门', time: '清晨', chapterKey: '第1章' });
        seed(app, TIMELINE, first.content);
        invalidateStoryLedger(PROJECT);
        expect((await loadStoryLedger(app as unknown as ObsidianApp, PROJECT)).events.map((e) => e.name)).toEqual(['入门']);

        // 模拟结算再次写入（内容变化，不手动 invalidate：靠签名/mtime 失效）
        const second = appendEventToContent(first.content, { name: '试炼', time: '午后', chapterKey: '第2章' });
        seed(app, TIMELINE, second.content);
        const reloaded = await loadStoryLedger(app as unknown as ObsidianApp, PROJECT);
        expect(reloaded.events.map((e) => e.name).sort()).toEqual(['入门', '试炼'].sort());
    });
});
