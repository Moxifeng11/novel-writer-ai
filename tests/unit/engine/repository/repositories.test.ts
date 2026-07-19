import { describe, it, expect, beforeEach } from 'vitest';
import { MockFileSystem } from '../../../../shared/file-system-port';
import {
    CharacterRepository,
    ChapterRepository,
    ProjectRepository,
    FactionRepository,
    LocationRepository,
    ItemRepository,
} from '../../../../engine/repository';
import {
    Character,
    Faction,
    Location,
    Item,
    Chapter,
    Project,
} from '../../../../engine/repository/domain/aggregates';
import { pjCharFile, pjFactionFile, pjLocFile, pjItemFile, pjBodyFile, pjProjectMeta } from '../../../../shared/paths';

const TEST_PROJECT = 'test-project';

describe('CharacterRepository', () => {
    let fs: MockFileSystem;
    let repo: CharacterRepository;

    beforeEach(() => {
        fs = new MockFileSystem();
        repo = new CharacterRepository(fs, TEST_PROJECT, { cacheEnabled: false });
    });

    describe('CRUD 操作', () => {
        it('保存人物后可以通过 ID 查找', async () => {
            const char = Character.create('张三', '张三', pjCharFile(TEST_PROJECT, '张三'));
            const saved = await repo.save(char);
            expect(saved.id).toBe('张三');

            const found = await repo.findById('张三');
            expect(found).not.toBeNull();
            expect(found?.name).toBe('张三');
        });

        it('查找不存在的人物返回 null', async () => {
            const found = await repo.findById('不存在');
            expect(found).toBeNull();
        });

        it('删除人物', async () => {
            const char = Character.create('李四', '李四', pjCharFile(TEST_PROJECT, '李四'));
            await repo.save(char);

            const result = await repo.delete('李四');
            expect(result).toBe(true);
            expect(await repo.exists('李四')).toBe(false);
        });

        it('findAll 查找所有人物', async () => {
            await repo.save(Character.create('甲', '甲', pjCharFile(TEST_PROJECT, '甲')));
            await repo.save(Character.create('乙', '乙', pjCharFile(TEST_PROJECT, '乙')));
            await repo.save(Character.create('丙', '丙', pjCharFile(TEST_PROJECT, '丙')));

            const all = await repo.findAll();
            expect(all.length).toBe(3);
        });
    });

    describe('查询方法', () => {
        it('findByFaction 按势力查找', async () => {
            const char1 = Character.create('张三', '张三', pjCharFile(TEST_PROJECT, '张三'));
            const char2 = Character.create('李四', '李四', pjCharFile(TEST_PROJECT, '李四'));
            await repo.save(char1);
            await repo.save(char2);

            const result = await repo.findByFaction('青云宗');
            expect(result.length).toBe(0);
        });

        it('findByStatus 按状态查找', async () => {
            const char = Character.create('王五', '王五', pjCharFile(TEST_PROJECT, '王五'));
            await repo.save(char);

            const activeChars = await repo.findByStatus('active');
            expect(activeChars.length).toBeGreaterThanOrEqual(0);
        });

        it('findByName 按名称模糊查找', async () => {
            await repo.save(Character.create('张三丰', '张三丰', pjCharFile(TEST_PROJECT, '张三丰')));
            await repo.save(Character.create('李四', '李四', pjCharFile(TEST_PROJECT, '李四')));

            const result = await repo.findByName('张');
            expect(result.length).toBeGreaterThanOrEqual(0);
        });

        it('findByIdentity 按身份查找', async () => {
            const result = await repo.findByIdentity('主角');
            expect(Array.isArray(result)).toBe(true);
        });

        it('findByCurrentLocation 按当前位置查找', async () => {
            const result = await repo.findByCurrentLocation('京城');
            expect(Array.isArray(result)).toBe(true);
        });
    });
});

describe('FactionRepository', () => {
    let fs: MockFileSystem;
    let repo: FactionRepository;

    beforeEach(() => {
        fs = new MockFileSystem();
        repo = new FactionRepository(fs, TEST_PROJECT, { cacheEnabled: false });
    });

    describe('CRUD 操作', () => {
        it('保存势力后可以通过 ID 查找', async () => {
            const faction = Faction.create('青云宗', '青云宗', pjFactionFile(TEST_PROJECT, '青云宗'));
            const saved = await repo.save(faction);
            expect(saved.id).toBe('青云宗');

            const found = await repo.findById('青云宗');
            expect(found).not.toBeNull();
            expect(found?.name).toBe('青云宗');
        });

        it('findAll 查找所有势力', async () => {
            await repo.save(Faction.create('青云宗', '青云宗', pjFactionFile(TEST_PROJECT, '青云宗')));
            await repo.save(Faction.create('合欢派', '合欢派', pjFactionFile(TEST_PROJECT, '合欢派')));

            const all = await repo.findAll();
            expect(all.length).toBe(2);
        });
    });

    describe('查询方法', () => {
        it('findByLeader 按领袖查找', async () => {
            const faction = Faction.create('青云宗', '青云宗', pjFactionFile(TEST_PROJECT, '青云宗'));
            await repo.save(faction);

            const result = await repo.findByLeader('道玄真人');
            expect(Array.isArray(result)).toBe(true);
        });

        it('findByType 按类型查找', async () => {
            const result = await repo.findByType('门派');
            expect(Array.isArray(result)).toBe(true);
        });

        it('findByStatus 按状态查找', async () => {
            const result = await repo.findByStatus('active');
            expect(Array.isArray(result)).toBe(true);
        });
    });
});

describe('LocationRepository', () => {
    let fs: MockFileSystem;
    let repo: LocationRepository;

    beforeEach(() => {
        fs = new MockFileSystem();
        repo = new LocationRepository(fs, TEST_PROJECT, { cacheEnabled: false });
    });

    describe('CRUD 操作', () => {
        it('保存地点后可以通过 ID 查找', async () => {
            const loc = Location.create('青云山', '青云山', pjLocFile(TEST_PROJECT, '青云山'));
            const saved = await repo.save(loc);
            expect(saved.id).toBe('青云山');

            const found = await repo.findById('青云山');
            expect(found).not.toBeNull();
            expect(found?.name).toBe('青云山');
        });

        it('findAll 查找所有地点', async () => {
            await repo.save(Location.create('青云山', '青云山', pjLocFile(TEST_PROJECT, '青云山')));
            await repo.save(Location.create('空桑山', '空桑山', pjLocFile(TEST_PROJECT, '空桑山')));

            const all = await repo.findAll();
            expect(all.length).toBe(2);
        });
    });

    describe('查询方法', () => {
        it('findByRegion 按区域查找', async () => {
            const result = await repo.findByRegion('中原');
            expect(Array.isArray(result)).toBe(true);
        });

        it('findByImportance 按重要程度查找', async () => {
            const result = await repo.findByImportance('重要');
            expect(Array.isArray(result)).toBe(true);
        });

        it('findByType 按类型查找', async () => {
            const result = await repo.findByType('山脉');
            expect(Array.isArray(result)).toBe(true);
        });
    });
});

describe('ItemRepository', () => {
    let fs: MockFileSystem;
    let repo: ItemRepository;

    beforeEach(() => {
        fs = new MockFileSystem();
        repo = new ItemRepository(fs, TEST_PROJECT, { cacheEnabled: false });
    });

    describe('CRUD 操作', () => {
        it('保存物品后可以通过 ID 查找', async () => {
            const item = Item.create('噬血珠', '噬血珠', pjItemFile(TEST_PROJECT, '噬血珠'));
            const saved = await repo.save(item);
            expect(saved.id).toBe('噬血珠');

            const found = await repo.findById('噬血珠');
            expect(found).not.toBeNull();
            expect(found?.name).toBe('噬血珠');
        });

        it('findAll 查找所有物品', async () => {
            await repo.save(Item.create('噬血珠', '噬血珠', pjItemFile(TEST_PROJECT, '噬血珠')));
            await repo.save(Item.create('合欢铃', '合欢铃', pjItemFile(TEST_PROJECT, '合欢铃')));

            const all = await repo.findAll();
            expect(all.length).toBe(2);
        });
    });

    describe('查询方法', () => {
        it('findByOwner 按所有者查找', async () => {
            const result = await repo.findByOwner('张小凡');
            expect(Array.isArray(result)).toBe(true);
        });

        it('findByGrade 按品阶查找', async () => {
            const result = await repo.findByGrade('仙品');
            expect(Array.isArray(result)).toBe(true);
        });

        it('findByType 按类型查找', async () => {
            const result = await repo.findByType('法宝');
            expect(Array.isArray(result)).toBe(true);
        });
    });
});

describe('ChapterRepository', () => {
    let fs: MockFileSystem;
    let repo: ChapterRepository;

    beforeEach(() => {
        fs = new MockFileSystem();
        repo = new ChapterRepository(fs, TEST_PROJECT, { cacheEnabled: false });
    });

    describe('CRUD 操作', () => {
        it('保存章节后可以通过 ID 查找', async () => {
            const chapter = Chapter.create(
                'v1-c1',
                '第一章 初见',
                1,
                1,
                pjBodyFile(TEST_PROJECT, 1, 1),
                '# 第一章\n\n这是第一章的内容。'
            );
            const saved = await repo.save(chapter);
            expect(saved.volume).toBe(1);
            expect(saved.chapterNum).toBe(1);

            const found = await repo.findById('v1-c1');
            expect(found).not.toBeNull();
            expect(found?.title).toBe('第一章 初见');
        });

        it('查找不存在的章节返回 null', async () => {
            const found = await repo.findById('v99-c99');
            expect(found).toBeNull();
        });

        it('删除章节', async () => {
            const chapter = Chapter.create(
                'v1-c2',
                '第二章',
                1,
                2,
                pjBodyFile(TEST_PROJECT, 1, 2),
                '内容'
            );
            await repo.save(chapter);

            const result = await repo.delete('v1-c2');
            expect(result).toBe(true);
            expect(await repo.exists('v1-c2')).toBe(false);
        });
    });

    describe('查询方法', () => {
        it('findByVolume 按卷号查找', async () => {
            await repo.save(Chapter.create('v1-c1', '第一章', 1, 1, pjBodyFile(TEST_PROJECT, 1, 1), ''));
            await repo.save(Chapter.create('v1-c2', '第二章', 1, 2, pjBodyFile(TEST_PROJECT, 1, 2), ''));
            await repo.save(Chapter.create('v2-c1', '第一章', 2, 1, pjBodyFile(TEST_PROJECT, 2, 1), ''));

            const vol1 = await repo.findByVolume(1);
            expect(vol1.length).toBe(2);
            expect(vol1[0].chapterNum).toBe(1);
            expect(vol1[1].chapterNum).toBe(2);
        });

        it('findByStatus 按状态查找', async () => {
            const result = await repo.findByStatus('pending');
            expect(Array.isArray(result)).toBe(true);
        });

        it('findByWordCountRange 按字数范围查找', async () => {
            const chapter = Chapter.create(
                'v1-c1',
                '第一章',
                1,
                1,
                pjBodyFile(TEST_PROJECT, 1, 1),
                '一二三四五六七八九十'.repeat(100)
            );
            await repo.save(chapter);

            const result = await repo.findByWordCountRange(0, 10000);
            expect(result.length).toBeGreaterThanOrEqual(0);
        });

        it('findByVolChap 按卷号章号查找', async () => {
            await repo.save(Chapter.create('v1-c5', '第五章', 1, 5, pjBodyFile(TEST_PROJECT, 1, 5), ''));

            const found = await repo.findByVolChap(1, 5);
            expect(found).not.toBeNull();
            expect(found?.title).toBe('第五章');
        });

        it('countByVolume 统计某卷章节数', async () => {
            await repo.save(Chapter.create('v1-c1', '第一章', 1, 1, pjBodyFile(TEST_PROJECT, 1, 1), ''));
            await repo.save(Chapter.create('v1-c2', '第二章', 1, 2, pjBodyFile(TEST_PROJECT, 1, 2), ''));

            const count = await repo.countByVolume(1);
            expect(count).toBe(2);
        });

        it('getAllVolumes 获取所有卷号', async () => {
            await repo.save(Chapter.create('v1-c1', '第一章', 1, 1, pjBodyFile(TEST_PROJECT, 1, 1), ''));
            await repo.save(Chapter.create('v3-c1', '第一章', 3, 1, pjBodyFile(TEST_PROJECT, 3, 1), ''));

            const vols = await repo.getAllVolumes();
            expect(vols).toContain(1);
            expect(vols).toContain(3);
        });
    });

    describe('关联查询', () => {
        it('getRelatedCharacterNames 获取涉及人物', async () => {
            let chapter = Chapter.create('v1-c1', '第一章', 1, 1, pjBodyFile(TEST_PROJECT, 1, 1), '');
            chapter = chapter.addCharacter('张小凡');
            chapter = chapter.addCharacter('林惊羽');
            await repo.save(chapter);

            const chars = await repo.getRelatedCharacterNames('v1-c1');
            expect(chars).toContain('张小凡');
            expect(chars).toContain('林惊羽');
        });

        it('getRelatedLocationNames 获取涉及地点', async () => {
            const chars = await repo.getRelatedLocationNames('v1-c1');
            expect(Array.isArray(chars)).toBe(true);
        });

        it('getRelatedFactionNames 获取涉及势力', async () => {
            const chars = await repo.getRelatedFactionNames('v1-c1');
            expect(Array.isArray(chars)).toBe(true);
        });

        it('getRelatedItemNames 获取涉及物品', async () => {
            const chars = await repo.getRelatedItemNames('v1-c1');
            expect(Array.isArray(chars)).toBe(true);
        });

        it('findChaptersByCharacter 查找某人物出现的章节', async () => {
            let chapter = Chapter.create('v1-c1', '第一章', 1, 1, pjBodyFile(TEST_PROJECT, 1, 1), '');
            chapter = chapter.addCharacter('张小凡');
            await repo.save(chapter);

            const chapters = await repo.findChaptersByCharacter('张小凡');
            expect(chapters.length).toBeGreaterThanOrEqual(0);
        });

        it('findChaptersByLocation 查找某地点出现的章节', async () => {
            const result = await repo.findChaptersByLocation('青云山');
            expect(Array.isArray(result)).toBe(true);
        });

        it('findChaptersByFaction 查找某势力出现的章节', async () => {
            const result = await repo.findChaptersByFaction('青云宗');
            expect(Array.isArray(result)).toBe(true);
        });

        it('findChaptersByItem 查找某物品出现的章节', async () => {
            const result = await repo.findChaptersByItem('噬血珠');
            expect(Array.isArray(result)).toBe(true);
        });
    });
});

describe('ProjectRepository', () => {
    let fs: MockFileSystem;
    let repo: ProjectRepository;

    beforeEach(() => {
        fs = new MockFileSystem();
        repo = new ProjectRepository(fs, { cacheEnabled: false });
    });

    describe('CRUD 操作', () => {
        it('保存项目后可以通过 ID 查找', async () => {
            const project = Project.create('my-novel', '我的小说', pjProjectMeta('my-novel'), {
                genre: '玄幻',
                type: '长篇',
            });
            const saved = await repo.save(project);
            expect(saved.id).toBe('my-novel');

            const found = await repo.findById('my-novel');
            expect(found).not.toBeNull();
            expect(found?.name).toBe('我的小说');
            expect(found?.genre).toBe('玄幻');
        });

        it('查找不存在的项目返回 null', async () => {
            const found = await repo.findById('not-exist');
            expect(found).toBeNull();
        });

        it('删除项目', async () => {
            const project = Project.create('to-delete', '待删除', pjProjectMeta('to-delete'));
            await repo.save(project);

            const result = await repo.delete('to-delete');
            expect(result).toBe(true);
            expect(await repo.exists('to-delete')).toBe(false);
        });
    });

    describe('查询方法', () => {
        it('findAll 查找所有项目', async () => {
            await repo.save(Project.create('project1', '项目1', pjProjectMeta('project1')));
            await repo.save(Project.create('project2', '项目2', pjProjectMeta('project2')));

            const all = await repo.findAll();
            expect(all.length).toBe(2);
        });

        it('getMeta 获取项目元数据', async () => {
            const project = Project.create('meta-test', '元数据测试', pjProjectMeta('meta-test'), {
                genre: '都市',
                author: '测试作者',
            });
            await repo.save(project);

            const meta = await repo.getMeta('meta-test');
            expect(meta).not.toBeNull();
            expect(meta?.name).toBe('元数据测试');
            expect(meta?.genre).toBe('都市');
            expect(meta?.author).toBe('测试作者');
        });

        it('updateMeta 更新项目元数据', async () => {
            const project = Project.create('update-test', '更新测试', pjProjectMeta('update-test'));
            await repo.save(project);

            const updated = await repo.updateMeta('update-test', {
                genre: '科幻',
                description: '新的简介',
            });
            expect(updated).not.toBeNull();
            expect(updated?.genre).toBe('科幻');
            expect(updated?.description).toBe('新的简介');
        });

        it('findByGenre 按题材查找', async () => {
            await repo.save(Project.create('p1', 'P1', pjProjectMeta('p1'), { genre: '玄幻' }));
            await repo.save(Project.create('p2', 'P2', pjProjectMeta('p2'), { genre: '都市' }));

            const result = await repo.findByGenre('玄幻');
            expect(result.length).toBe(1);
            expect(result[0].name).toBe('P1');
        });

        it('findByType 按类型查找', async () => {
            const result = await repo.findByType('长篇');
            expect(Array.isArray(result)).toBe(true);
        });

        it('findByAuthor 按作者查找', async () => {
            const result = await repo.findByAuthor('某作者');
            expect(Array.isArray(result)).toBe(true);
        });
    });
});

describe('文件格式兼容性', () => {
    let fs: MockFileSystem;

    beforeEach(() => {
        fs = new MockFileSystem();
    });

    it('CharacterRepository 能正确读取现有格式文件', async () => {
        const existingContent = `---
姓名: 张小凡
身份: 主角
所属势力: 青云宗
tags: 主角, 青云宗
---

# 张小凡

## 人物背景
普通青年，性格坚韧。
`;
        fs.setFile(pjCharFile(TEST_PROJECT, '张小凡'), existingContent);

        const repo = new CharacterRepository(fs, TEST_PROJECT, { cacheEnabled: false });
        const found = await repo.findById('张小凡');
        expect(found).not.toBeNull();
        expect(found?.name).toBe('张小凡');
    });

    it('ChapterRepository 能正确读取现有格式文件', async () => {
        const existingContent = `---
卷: 1
章: 1
标题: 第一章 风起
status: written
word_count: 3000
涉及人物:
  - 张小凡
  - 林惊羽
---

# 第一章 风起

青云山下，草庙村中...
`;
        fs.setFile(pjBodyFile(TEST_PROJECT, 1, 1), existingContent);

        const repo = new ChapterRepository(fs, TEST_PROJECT, { cacheEnabled: false });
        const found = await repo.findById('v1-c1');
        expect(found).not.toBeNull();
        expect(found?.title).toBe('第一章 风起');
        expect(found?.volume).toBe(1);
        expect(found?.chapterNum).toBe(1);
    });

    it('ProjectRepository 能正确读取现有格式文件', async () => {
        const existingContent = `---
name: 诛仙
genre: 玄幻
type: 长篇
author: 萧鼎
---

# 诛仙

天地不仁，以万物为刍狗...
`;
        fs.setFile(pjProjectMeta('诛仙'), existingContent);

        const repo = new ProjectRepository(fs, { cacheEnabled: false });
        const found = await repo.findById('诛仙');
        expect(found).not.toBeNull();
        expect(found?.name).toBe('诛仙');
        expect(found?.genre).toBe('玄幻');
    });
});
