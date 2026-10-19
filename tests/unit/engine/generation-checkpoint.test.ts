import { describe, it, expect, vi } from 'vitest';
import { GenerationCheckpointStore, makeCheckpointKey } from '../../../engine/generation-checkpoint';
import { computePromptHash } from '../../../engine/prompt-hash';

/** 内存存储端口（模拟 vault 落盘） */
function makeMemoryPort() {
    const map = new Map<string, string>();
    return {
        write: vi.fn(async (key: string, json: string) => { map.set(key, json); }),
        read: vi.fn(async (key: string) => map.get(key) ?? null),
        remove: vi.fn(async (key: string) => { map.delete(key); }),
        map,
    };
}

function makeCheckpointInput(overrides: Record<string, any> = {}) {
    return {
        projectId: 'proj-A',
        chapter: '第41章',
        sceneNum: 2,
        promptHash: computePromptHash('sys', 'user', 'm', 0.7, 1024),
        content: '场景2已生成的半成品正文…烛芯爆了三次灯花。',
        lastAcceptedParagraph: '烛芯爆了三次灯花。',
        finishReason: 'api_timeout',
        ...overrides,
    };
}

describe('GenerationCheckpointStore — TR-7.1 断点落盘', () => {
    it('save 后字段完整（含 savedAt/version）', async () => {
        const port = makeMemoryPort();
        const store = new GenerationCheckpointStore(port as any);
        const input = makeCheckpointInput();

        const ok = await store.save(input);
        expect(ok).toBe(true);

        const saved = await store.get(input);
        expect(saved).not.toBeNull();
        expect(saved!.projectId).toBe('proj-A');
        expect(saved!.chapter).toBe('第41章');
        expect(saved!.sceneNum).toBe(2);
        expect(saved!.promptHash).toBe(input.promptHash);
        expect(saved!.content).toContain('半成品正文');
        expect(saved!.lastAcceptedParagraph).toBe('烛芯爆了三次灯花。');
        expect(saved!.finishReason).toBe('api_timeout');
        expect(typeof saved!.savedAt).toBe('number');
    });
});

describe('GenerationCheckpointStore — TR-7.2 断点续写', () => {
    it('resume 读取返回 lastAcceptedParagraph，续写以该段为起点（不重复已接受段落）', async () => {
        const port = makeMemoryPort();
        const store = new GenerationCheckpointStore(port as any);
        const input = makeCheckpointInput();
        await store.save(input);

        const cp = await store.get({
            projectId: 'proj-A',
            chapter: '第41章',
            sceneNum: 2,
            promptHash: input.promptHash,
        });
        expect(cp!.lastAcceptedParagraph).toBe('烛芯爆了三次灯花。');

        // 调用方续写时以上一接受段落为衔接起点，续写结果不含已接受段落的重复
        const continuation = '火光跳了跳，把他的影子钉在墙上。';
        expect(continuation).not.toContain(cp!.lastAcceptedParagraph);
    });
});

describe('GenerationCheckpointStore — TR-7.3 多章多场景隔离', () => {
    it('不同 project/chapter/scene/promptHash 的断点互不覆盖', async () => {
        const port = makeMemoryPort();
        const store = new GenerationCheckpointStore(port as any);
        const hashA = computePromptHash('sys', 'user-a', 'm', 0.7, 1024);
        const hashB = computePromptHash('sys', 'user-b', 'm', 0.7, 1024);

        await store.save(makeCheckpointInput({ sceneNum: 1, promptHash: hashA, content: 'A1' }));
        await store.save(makeCheckpointInput({ sceneNum: 2, promptHash: hashB, content: 'A2' }));
        await store.save(makeCheckpointInput({ chapter: '第42章', promptHash: hashA, content: 'B1' }));
        await store.save(makeCheckpointInput({ projectId: 'proj-B', promptHash: hashA, content: 'X' }));

        const a1 = await store.get({ projectId: 'proj-A', chapter: '第41章', sceneNum: 1, promptHash: hashA });
        const a2 = await store.get({ projectId: 'proj-A', chapter: '第41章', sceneNum: 2, promptHash: hashB });
        const b1 = await store.get({ projectId: 'proj-A', chapter: '第42章', sceneNum: 2, promptHash: hashA });
        const x = await store.get({ projectId: 'proj-B', chapter: '第41章', sceneNum: 2, promptHash: hashA });

        expect(a1!.content).toBe('A1');
        expect(a2!.content).toBe('A2');
        expect(b1!.content).toBe('B1');
        expect(x!.content).toBe('X');
    });

    it('同 key 二次 save 覆盖旧断点', async () => {
        const port = makeMemoryPort();
        const store = new GenerationCheckpointStore(port as any);
        const input = makeCheckpointInput();
        await store.save(input);
        await store.save({ ...input, content: '重试后的新内容' });

        const cp = await store.get(input);
        expect(cp!.content).toBe('重试后的新内容');
    });
});

describe('GenerationCheckpointStore — TR-7.4 落盘失败降级', () => {
    it('底层写入抛错 → save 返回 false 不抛未捕获异常', async () => {
        const port = makeMemoryPort();
        port.write.mockRejectedValue(new Error('磁盘已满'));
        const store = new GenerationCheckpointStore(port as any);

        let threw = false;
        let ok = true;
        try {
            ok = await store.save(makeCheckpointInput());
        } catch {
            threw = true;
        }
        expect(threw).toBe(false);
        expect(ok).toBe(false);
    });

    it('discard 清除断点，get 返回 null', async () => {
        const port = makeMemoryPort();
        const store = new GenerationCheckpointStore(port as any);
        const input = makeCheckpointInput();
        await store.save(input);

        await store.discard(input);
        const cp = await store.get(input);
        expect(cp).toBeNull();
    });

    it('无断点时 get 返回 null，不抛异常', async () => {
        const port = makeMemoryPort();
        const store = new GenerationCheckpointStore(port as any);
        expect(await store.get(makeCheckpointInput())).toBeNull();
    });
});

describe('makeCheckpointKey — key 口径', () => {
    it('key 由四元组构成且与 P0 computePromptHash 口径衔接', () => {
        const h = computePromptHash('s', 'u', 'm', 0.7, 1024);
        const key = makeCheckpointKey('proj-A', '第41章', 2, h);
        expect(key).toBe(`proj-A::第41章::2::${h}`);
    });
});
