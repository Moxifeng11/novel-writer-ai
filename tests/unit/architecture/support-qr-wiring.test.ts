import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 维度⑤二轮 P2-4：`check:support-qr` 脚本存在但从未接线，源图/生成物漂移
 * 不会被任何门禁发现。这里锁住 preflight + CI + Release 三处接线与漂移清单。
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('support-qr 生成物门禁接线', () => {
    it('preflight 包含 check:support-qr', () => {
        const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
        expect(pkg.scripts['check:support-qr']).toContain('gen-support-qr.mjs --check');
        expect(pkg.scripts['preflight']).toContain('check:support-qr');
    });

    it('CI 与 Release 都跑 check:support-qr，且漂移清单包含生成物', () => {
        for (const file of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
            const src = read(file);
            expect(src, file).toContain('npm run check:support-qr');
            expect(src, file).toContain('shared/support-qr.generated.ts');
        }
    });
});
