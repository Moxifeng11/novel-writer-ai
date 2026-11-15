/**
 * 内联 Worker gzip 压缩：解压产物必须是可运行的 worker 源码
 *
 * 背景：为降低安装包体积，`workers-inline.generated.ts` 改为 gzip+base64
 * （855KB → 339KB），运行时用 DecompressionStream 解压。这里锁住三件事：
 * 1) 生成物确实是 gzip+base64，并能解回完整源码；
 * 2) 解出来的代码是合法 JS（node --check 之外的在内存语法校验）；
 * 3) warm 之后 Blob URL 可复用，dispose 后清空。
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
    INLINE_WORKER_COMPRESSION,
    INLINE_WORKER_GZIP_SOURCES,
} from '@/shared/workers-inline.generated';
import { disposeInlineWorkerUrls, resolveInlineWorkerUrl, warmInlineWorkerUrls } from '@/shared/plugin-worker-url';

/** base64 gzip → 文本（与运行时同一套 API，避免测试替身偏离真实实现） */
const gunzip = async (base64: string): Promise<string> => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
};

const files = Object.keys(INLINE_WORKER_GZIP_SOURCES);

describe('内联 Worker 压缩产物', () => {
    beforeEach(() => {
        disposeInlineWorkerUrls();
    });
    afterEach(() => {
        disposeInlineWorkerUrls();
    });

    it('标记为 gzip+base64，且两个 worker 都在', () => {
        expect(INLINE_WORKER_COMPRESSION).toBe('gzip+base64');
        expect(files.sort()).toEqual(['deconstruction-worker.js', 'quality-worker.js']);
    });

    it('base64 解码后是 gzip 魔数（1f 8b），不是明文源码', () => {
        for (const file of files) {
            const base64 = INLINE_WORKER_GZIP_SOURCES[file];
            const binary = atob(base64);
            expect(binary.charCodeAt(0)).toBe(0x1f);
            expect(binary.charCodeAt(1)).toBe(0x8b);
            expect(base64).not.toContain('use strict');
        }
    });

    it('解压后是完整可执行的 worker 源码', async () => {
        for (const file of files) {
            const source = await gunzip(INLINE_WORKER_GZIP_SOURCES[file]);
            expect(source.length).toBeGreaterThan(50_000);
            expect(source).toContain('self');
            // 语法校验：能编译即说明源码完整
            expect(() => new Function(source)).not.toThrow();
        }
    });

    it('压缩后总体积明显小于原始 worker 产物（≥35% 降幅）', async () => {
        let compressedBytes = 0;
        let rawBytes = 0;
        for (const file of files) {
            compressedBytes += Buffer.byteLength(INLINE_WORKER_GZIP_SOURCES[file], 'utf8');
            rawBytes += Buffer.byteLength(await gunzip(INLINE_WORKER_GZIP_SOURCES[file]), 'utf8');
        }
        // deconstruction 684KB + quality 109KB ≈ 793KB
        expect(rawBytes).toBeGreaterThan(700_000);
        expect(compressedBytes).toBeLessThan(rawBytes * 0.65);
    });

    it('warm 后 resolve 命中缓存且可复用；dispose 后清空', async () => {
        const warmed = await warmInlineWorkerUrls();
        expect(warmed).toBeGreaterThanOrEqual(1);
        const first = resolveInlineWorkerUrl('deconstruction-worker.js');
        expect(first).toMatch(/^blob:/);
        expect(resolveInlineWorkerUrl('deconstruction-worker.js')).toBe(first);
        disposeInlineWorkerUrls();
        expect(resolveInlineWorkerUrl('deconstruction-worker.js')).toBeNull();
    });

    it('未知 worker 名返回 null', () => {
        expect(resolveInlineWorkerUrl('not-exist.js')).toBeNull();
    });
});
