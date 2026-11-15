import { describe, expect, it } from 'vitest';
import { CowriteSnapshotService } from '@/services/cowrite-snapshot-service';

describe('CowriteSnapshotService', () => {
    it('首次注入全部新增', () => {
        const service = new CowriteSnapshotService();
        const result = service.compute('SC-1', ['entity:CHR-0001']);
        expect(result.inject).toBe(true);
        expect(result.delta.added).toHaveLength(1);
    });

    it('同场景重复请求不再注入', () => {
        const service = new CowriteSnapshotService();
        service.compute('SC-1', ['entity:CHR-0001']);
        const second = service.compute('SC-1', ['entity:CHR-0001']);
        expect(second.inject).toBe(false);
        expect(second.delta.added).toEqual([]);
    });

    it('新增条目只补差异', () => {
        const service = new CowriteSnapshotService();
        service.compute('SC-1', ['entity:CHR-0001']);
        const result = service.compute('SC-1', ['entity:CHR-0001', 'relation:REL-0001']);
        expect(result.inject).toBe(true);
        expect(result.delta.added).toEqual(['relation:REL-0001']);
        expect(result.delta.unchanged).toEqual(['entity:CHR-0001']);
    });

    it('切换场景需要重新装配', () => {
        const service = new CowriteSnapshotService();
        service.compute('SC-1', ['entity:CHR-0001']);
        const result = service.compute('SC-2', ['entity:CHR-0002']);
        expect(result.delta.sameScene).toBe(false);
        expect(result.inject).toBe(true);
    });

    it('切换会话清空快照', () => {
        const service = new CowriteSnapshotService();
        service.setSession('proj/第1章');
        service.compute('SC-1', ['entity:CHR-0001']);
        service.setSession('proj/第2章');
        expect(service.size()).toBe(0);
        const result = service.compute('SC-1', ['entity:CHR-0001']);
        expect(result.inject).toBe(true);
    });

    it('同会话重复设置不清空', () => {
        const service = new CowriteSnapshotService();
        service.setSession('proj/第1章');
        service.compute('SC-1', ['entity:CHR-0001']);
        service.setSession('proj/第1章');
        expect(service.size()).toBe(1);
    });
});
