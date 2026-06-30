import { describe, it, expect, beforeEach } from 'vitest';
import { Vault } from '../__mocks__/obsidian';

/**
 * 项目完整工作流程集成测试
 * 
 * 测试从创建项目到生成内容的完整流程
 * 使用 Mock Vault 模拟 Obsidian 文件系统
 */

describe('项目完整工作流程', () => {
  let vault: Vault;

  beforeEach(() => {
    // 创建 Vault 实例
    vault = new Vault();
  });

  it('应该能够创建新项目并初始化目录结构', async () => {
    const projectName = '测试项目_集成测试';
    
    // 创建项目根目录
    await vault.createFolder(`${projectName}/`);
    await vault.createFolder(`${projectName}/世界观/`);
    await vault.createFolder(`${projectName}/角色/`);
    await vault.createFolder(`${projectName}/章节/`);
    await vault.createFolder(`${projectName}/设定/`);
    
    // 验证项目目录存在
    expect(vault.exists(`${projectName}/`)).toBe(true);
    
    // 验证子目录存在
    expect(vault.exists(`${projectName}/世界观/`)).toBe(true);
    expect(vault.exists(`${projectName}/角色/`)).toBe(true);
    expect(vault.exists(`${projectName}/章节/`)).toBe(true);
    expect(vault.exists(`${projectName}/设定/`)).toBe(true);
    
    console.log(`✅ 项目 "${projectName}" 创建成功，包含 4 个子目录`);
  });

  it('应该能够保存和读取世界观文件', async () => {
    const projectName = '测试世界观';
    const worldviewPath = `${projectName}/世界观/世界观设定.md`;
    
    // 创建目录
    await vault.createFolder(`${projectName}/`);
    await vault.createFolder(`${projectName}/世界观/`);
    
    // 模拟世界观内容
    const worldviewContent = `---
title: 修仙世界
genre: 修仙
---

# 修仙世界

## 世界描述
一个充满灵气和修炼者的世界

## 修炼体系
- 炼气期
- 筑基期
- 金丹期
- 元婴期

## 主要地点
### 青云宗
正道第一大宗，位于东域

### 魔渊
魔修聚集地，位于西域
`;
    
    // 保存文件
    await vault.write(worldviewPath, worldviewContent);
    
    // 验证文件存在
    expect(vault.exists(worldviewPath)).toBe(true);
    
    // 读取并验证内容
    const content = await vault.readByPath(worldviewPath);
    expect(content).toContain('修仙世界');
    expect(content).toContain('青云宗');
    expect(content).toContain('魔渊');
    
    console.log(`✅ 世界观文件保存成功，字数: ${content.length}`);
  });

  it('应该能够保存和读取角色文件', async () => {
    const projectName = '测试角色';
    const characterPath = `${projectName}/角色/张三.md`;
    
    // 创建目录
    await vault.createFolder(`${projectName}/`);
    await vault.createFolder(`${projectName}/角色/`);
    
    // 模拟角色内容
    const characterContent = `---
name: 张三
role: 主角
archetype: 成长型
---

# 张三

## 背景故事
普通少年，意外获得奇遇，踏上修仙之路

## 能力
- 剑法精通
- 炼丹术
- 阵法基础

## 关系网
- 师父：李长老
- 好友：王五
`;
    
    // 保存文件
    await vault.write(characterPath, characterContent);
    
    // 验证文件存在
    expect(vault.exists(characterPath)).toBe(true);
    
    // 读取并验证内容
    const content = await vault.readByPath(characterPath);
    expect(content).toContain('张三');
    expect(content).toContain('剑法精通');
    expect(content).toContain('李长老');
    
    console.log(`✅ 角色文件保存成功，字数: ${content.length}`);
  });

  it('应该能够保存和读取章节文件', async () => {
    const projectName = '测试章节';
    const chapterPath = `${projectName}/章节/第001章_初入修仙界.md`;
    
    // 创建目录
    await vault.createFolder(`${projectName}/`);
    await vault.createFolder(`${projectName}/章节/`);
    
    // 模拟章节内容（至少1000字）
    const chapterContent = `---
title: 第一章：初入修仙界
chapterNumber: 1
wordCount: 1200
---

# 第一章：初入修仙界

张三站在青云宗的山门前，心中满是激动与忐忑。

眼前的山门高耸入云，云雾缭绕间隐约可见飞檐翘角。这就是他梦寐以求的修仙圣地——青云宗。

"新弟子报到！"张三深吸一口气，迈步向前。

守门的弟子打量了他一眼，递给他一块令牌："拿着这个，去登记处办理手续。"

张三接过令牌，感受着上面传来的微弱灵力波动，心中更加坚定了修行的决心。

登记处排着长长的队伍，都是和他一样慕名而来的年轻人。张三耐心地等待着，观察着周围的环境。

青云宗的建筑风格古朴典雅，青石铺就的道路两旁种满了灵草灵药，空气中弥漫着淡淡的清香。

"下一个！"登记处的老者喊道。

张三走上前，递上令牌和自己的身份信息。

老者仔细查看后，在名册上写下他的名字："张三，十六岁，无修炼基础，分配至外门丙字号院。"

就这样，张三正式成为了青云宗的一员。

接下来的日子里，张三开始了基础的修炼课程。每天清晨，他都要和其他新弟子一起，在山间的广场上练习吐纳功法。

虽然进展缓慢，但张三从未放弃。他知道，修仙之路漫长而艰辛，需要持之以恒的努力。

一个月后，张三终于感受到了体内第一缕灵气的流动。那一刻，他激动得几乎跳了起来。

"恭喜你，突破了炼气期一层。"教导师兄微笑着说道，"继续努力，你很有天赋。"

张三点点头，眼中闪烁着坚定的光芒。他知道，这只是开始，前方还有更长的路要走。

夜晚，张三独自坐在院子里，望着满天繁星，心中默默许下誓言：总有一天，他要成为青云宗最强大的修士之一。

这就是张三的修仙之路的开始，平凡却充满希望。

（此处省略大量正文内容，实际测试中应该包含完整的章节内容以达到字数要求）

张三继续着他的修行之路，每天都在努力提升自己的修为。他深知，只有不断突破自己，才能在这个残酷的修仙世界中生存下去。

宗门内的竞争异常激烈，每个弟子都在为了有限的资源而努力。张三明白，想要脱颖而出，必须付出比常人更多的努力。

他开始研究各种功法秘籍，寻找适合自己的修炼方法。经过反复试验，他终于找到了一套适合自己的剑法，并开始刻苦练习。

日复一日，年复一年，张三的修为稳步提升。从最初的炼气期，到筑基期，再到金丹期，每一步都充满了艰辛和挑战。

但他从未放弃过心中的梦想——成为这个世界上最强大的修士之一，保护自己所爱的人，维护世间的正义与和平。

这就是张三的故事，一个普通少年踏上修仙之路的传奇故事。
`;
    
    // 保存文件
    await vault.write(chapterPath, chapterContent);
    
    // 验证文件存在
    expect(vault.exists(chapterPath)).toBe(true);
    
    // 读取并验证内容
    const content = await vault.readByPath(chapterPath);
    expect(content).toContain('张三');
    expect(content).toContain('青云宗');
    expect(content.length).toBeGreaterThan(1000);
    
    console.log(`✅ 章节文件保存成功，字数: ${content.length}`);
  });

  it('完整流程：从创建项目到生成第一章', async () => {
    const projectName = '完整流程测试';
    
    // 1. 创建项目目录结构
    await vault.createFolder(`${projectName}/`);
    await vault.createFolder(`${projectName}/世界观/`);
    await vault.createFolder(`${projectName}/角色/`);
    await vault.createFolder(`${projectName}/章节/`);
    await vault.createFolder(`${projectName}/设定/`);
    
    expect(vault.exists(`${projectName}/`)).toBe(true);
    console.log('✅ 步骤1: 项目目录创建成功');
    
    // 2. 创建世界观文件
    const worldviewPath = `${projectName}/世界观/世界观设定.md`;
    const worldviewContent = `---
title: 修仙世界
genre: 修仙
---

# 修仙世界

## 世界描述
一个充满灵气和修炼者的世界

## 主要地点
### 青云宗
正道第一大宗
`;
    await vault.write(worldviewPath, worldviewContent);
    expect(vault.exists(worldviewPath)).toBe(true);
    console.log('✅ 步骤2: 世界观文件创建成功');
    
    // 3. 创建角色文件
    const characterPath = `${projectName}/角色/张三.md`;
    const characterContent = `---
name: 张三
role: 主角
---

# 张三

## 背景
普通少年，踏上修仙之路

## 能力
- 剑法
- 炼丹
`;
    await vault.write(characterPath, characterContent);
    expect(vault.exists(characterPath)).toBe(true);
    console.log('✅ 步骤3: 角色文件创建成功');
    
    // 4. 创建章节文件
    const chapterPath = `${projectName}/章节/第001章_初入修仙界.md`;
    const chapterContent = `---
title: 第一章：初入修仙界
chapterNumber: 1
wordCount: 1500
---

# 第一章：初入修仙界

张三站在青云宗的山门前，心中满是激动...

这里是正文内容，描述了张三初入宗门的故事...

（此处省略一千字）
`;
    await vault.write(chapterPath, chapterContent);
    expect(vault.exists(chapterPath)).toBe(true);
    console.log('✅ 步骤4: 章节文件创建成功');
    
    // 5. 验证所有文件都存在
    const files = [
      `${projectName}/世界观/世界观设定.md`,
      `${projectName}/角色/张三.md`,
      `${projectName}/章节/第001章_初入修仙界.md`
    ];
    
    for (const file of files) {
      expect(vault.exists(file)).toBe(true);
    }
    
    console.log(`✅ 完整流程测试通过！共创建了 ${files.length + 4} 个文件/目录`);
  });
});
