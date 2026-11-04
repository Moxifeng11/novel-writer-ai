import { describe, expect, it } from 'vitest';
import { StyleFingerprintLibrary } from '@/engine/style-fingerprint-library';

describe('StyleFingerprintLibrary 项目级单例', () => {
    it('同项目返回同一实例，不同项目隔离', () => {
        const app = {} as never;
        const a = StyleFingerprintLibrary.get(app, '长篇小说/甲');
        const b = StyleFingerprintLibrary.get(app, '长篇小说/甲');
        const c = StyleFingerprintLibrary.get(app, '长篇小说/乙');
        expect(a).toBe(b);
        expect(a).not.toBe(c);
    });

    it('flushAll 后重新获取会创建新实例', async () => {
        const app = {} as never;
        const first = StyleFingerprintLibrary.get(app, '长篇小说/丙');
        await StyleFingerprintLibrary.flushAll();
        const second = StyleFingerprintLibrary.get(app, '长篇小说/丙');
        expect(second).not.toBe(first);
    });
});
