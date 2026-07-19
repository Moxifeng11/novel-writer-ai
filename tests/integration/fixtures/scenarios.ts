import type {
  CharacterData,
  LocationData,
  FactionData,
  ItemData,
  ChapterData,
  WorldviewData,
} from '../helpers/test-data-generator';
import { generateLongText } from '../helpers/test-data-generator';

export interface TestScenario {
  id: string;
  name: string;
  genre: string;
  channel: 'male' | 'female' | 'neutral';
  worldview: WorldviewData;
  characters: CharacterData[];
  locations: LocationData[];
  factions: FactionData[];
  items: ItemData[];
  chapters: ChapterData[];
  volumeOutline: {
    volume: number;
    title: string;
    chapters: Array<{ number: number; title: string; summary: string }>;
  };
  sampleText: string;
  synopsis: string;
  tags: string[];
}

export const XUANHUAN_SCENARIO: TestScenario = {
  id: 'xuanhuan',
  name: '玄幻修仙',
  genre: '玄幻',
  channel: 'male',
  worldview: {
    worldName: '天元大陆',
    genre: '玄幻修仙',
    description: '天元大陆是一个充满灵气的修仙世界，修士们通过修炼功法提升实力，追求长生不老。大陆分为东、南、西、北四大域，每域都有各自的修仙势力。',
    cultivationSystem: '修炼体系分为炼气、筑基、金丹、元婴、化神、渡劫、大乘七个大境界，每个境界又分为初期、中期、后期、巅峰四个小境界。',
    geography: '天元大陆广袤无垠，东部是青云宗所在的东域，山脉连绵；西部是魔渊所在的西域，沙漠广布；南部是妖族盘踞的南域，丛林密布；北部是冰原覆盖的北域，寒冷刺骨。',
    history: '远古时期，神魔大战，天地崩裂。近代以来，正道联盟与魔道势力纷争不断。近期，灵气复苏，天才辈出，乱世将至。',
  },
  characters: [
    {
      name: '林惊鸿',
      role: '主角',
      identity: '青云宗外门弟子',
      gender: '男',
      age: '16岁',
      background: '出身平凡小镇，父母早亡，被青云宗外门长老收为弟子。性格坚韧，不服输，有一颗赤子之心。',
      personality: '冷静沉稳、重情重义、有勇有谋',
      ability: '天生剑骨、万法皆通、神秘小鼎',
      faction: '青云宗',
      cultivationLevel: '炼气期七层',
    },
    {
      name: '苏清雪',
      role: '女主角',
      identity: '青云宗内门弟子',
      gender: '女',
      age: '15岁',
      background: '苏家嫡女，天赋异禀，被誉为青云宗百年一遇的奇才。性格清冷，外冷内热。',
      personality: '清冷孤傲、内心温柔、天赋卓绝',
      ability: '冰心诀、天雪剑体',
      faction: '青云宗',
      cultivationLevel: '筑基期三层',
    },
    {
      name: '王胖子',
      role: '男配角',
      identity: '青云宗外门弟子',
      gender: '男',
      age: '17岁',
      background: '富商之子，为人豪爽，喜欢结交朋友，是林惊鸿的好友。',
      personality: '豪爽大方、乐观开朗、重义气',
      ability: '财通神诀、防御型功法',
      faction: '青云宗',
      cultivationLevel: '炼气期六层',
    },
    {
      name: '血魔老祖',
      role: '反派',
      identity: '魔宗太上长老',
      gender: '男',
      age: '不详',
      background: '魔宗最神秘的存在，传说活了数千年，实力深不可测。',
      personality: '阴险狡诈、残忍嗜血、野心勃勃',
      ability: '血魔大法、噬魂术',
      faction: '魔宗',
      cultivationLevel: '化神期',
    },
  ],
  locations: [
    {
      name: '青云宗',
      type: '宗门',
      description: '正道第一大宗，位于东域青云山脉，弟子数万，势力庞大。',
      geography: '坐落在青云山脉最高峰，云雾缭绕，仙气飘飘',
      inhabitants: '青云宗弟子',
      importance: '核心',
    },
    {
      name: '魔渊',
      type: '秘境',
      description: '魔宗总部所在地，位于西域深处，魔气滔天。',
      geography: '地下洞窟群，终年不见天日',
      inhabitants: '魔宗修士',
      importance: '核心',
    },
    {
      name: '青阳城',
      type: '城市',
      description: '青云宗脚下的凡人城市，商贸繁荣。',
      geography: '位于青云山脉脚下，交通要道',
      inhabitants: '凡人和低阶修士',
      importance: '重要',
    },
    {
      name: '万妖森林',
      type: '森林',
      description: '南域最大的森林，妖族聚居地，危险重重。',
      geography: '广袤的原始森林',
      inhabitants: '妖族',
      importance: '重要',
    },
  ],
  factions: [
    {
      name: '青云宗',
      type: '正道宗门',
      leader: '青云真人',
      description: '正道第一大宗，以剑法和阵法闻名天下。',
      rank: '正道第一',
    },
    {
      name: '魔宗',
      type: '魔道势力',
      leader: '血魔老祖',
      description: '魔道第一势力，行事狠辣，与正道势不两立。',
      rank: '魔道第一',
    },
    {
      name: '妖族联盟',
      type: '妖族势力',
      leader: '妖皇',
      description: '万妖森林中的妖族联盟，与人类势力保持距离。',
      rank: '南域霸主',
    },
  ],
  items: [
    {
      name: '太虚神鼎',
      type: '神器',
      grade: '先天至宝',
      description: '林惊鸿意外获得的神秘小鼎，来历神秘，功能未知。',
      effect: '炼丹加成、空间储物、护体神光',
      owner: '林惊鸿',
    },
    {
      name: '天霜剑',
      type: '法宝',
      grade: '极品灵器',
      description: '苏清雪的佩剑，蕴含极寒之力。',
      effect: '释放寒芒、冰冻敌人',
      owner: '苏清雪',
    },
    {
      name: '聚灵珠',
      type: '丹药',
      grade: '中品',
      description: '辅助修炼的丹药，可提升修炼速度。',
      effect: '提升灵气吸收速度',
      owner: '王胖子',
    },
  ],
  chapters: [
    {
      volume: 1,
      chapter: 1,
      title: '第一章：青云初入',
      content: generateLongText(
        '林惊鸿站在青云宗的山门前，心中满是激动与忐忑。眼前的山门高耸入云，云雾缭绕间隐约可见飞檐翘角。这就是他梦寐以求的修仙圣地——青云宗。',
        3000
      ),
    },
    {
      volume: 1,
      chapter: 2,
      title: '第二章：外门试炼',
      content: generateLongText(
        '外门试炼开始了，林惊鸿和王胖子一起参加了入门测试。第一项测试是灵根检测，林惊鸿的灵根品质让众人大吃一惊。',
        3000
      ),
    },
    {
      volume: 1,
      chapter: 3,
      title: '第三章：神秘小鼎',
      content: generateLongText(
        '林惊鸿在藏经阁中意外发现了一尊神秘小鼎。这尊小鼎看起来普通无奇，但林惊鸿总觉得它不简单。',
        3000
      ),
    },
  ],
  volumeOutline: {
    volume: 1,
    title: '初入修仙',
    chapters: [
      { number: 1, title: '青云初入', summary: '林惊鸿加入青云宗，开始修仙之路' },
      { number: 2, title: '外门试炼', summary: '参加外门试炼，展现实力' },
      { number: 3, title: '神秘小鼎', summary: '获得神秘小鼎，开启奇遇' },
    ],
  },
  sampleText: '林惊鸿修炼了一夜，感受着体内缓缓增长的灵气，心中充满了对未来的期待。他知道，修仙之路漫漫，但他绝不会放弃。太虚神鼎在他丹田中微微发热，仿佛在回应他的决心。',
  synopsis: '少年林惊鸿出身平凡，意外加入青云宗，获得神秘神器太虚神鼎，从此踏上修仙之路。在这个充满机遇与危险的世界里，他将如何一步步成长，最终登顶巅峰？',
  tags: ['玄幻', '修仙', '升级流', '爽文', '系统'],
};

export const ROMANCE_SCENARIO: TestScenario = {
  id: 'romance',
  name: '都市言情',
  genre: '现代言情',
  channel: 'female',
  worldview: {
    worldName: '现代都市',
    genre: '都市言情',
    description: '繁华的现代都市，职场精英们在这里追逐梦想和爱情。',
    cultivationSystem: '无',
    geography: '一线城市，高楼林立，商业发达',
    history: '现代社会',
  },
  characters: [
    {
      name: '苏晚',
      role: '女主角',
      identity: '设计师',
      gender: '女',
      age: '26岁',
      background: '设计系高材生，毕业后进入知名设计公司，努力打拼。',
      personality: '独立坚强、温柔善良、有才华',
      ability: '设计天赋、空间感知力强',
      faction: '',
      cultivationLevel: '',
    },
    {
      name: '顾延深',
      role: '男主角',
      identity: '顾氏集团总裁',
      gender: '男',
      age: '30岁',
      background: '顾氏集团继承人，商界传奇，冷傲寡言。',
      personality: '高冷禁欲、外冷内热、霸道深情',
      ability: '商业头脑、决策力强',
      faction: '顾氏集团',
      cultivationLevel: '',
    },
    {
      name: '林薇薇',
      role: '女配角',
      identity: '苏晚闺蜜',
      gender: '女',
      age: '26岁',
      background: '苏晚的大学同学兼闺蜜，性格开朗。',
      personality: '热情开朗、八卦热心、重友情',
      ability: '社交能力强',
      faction: '',
      cultivationLevel: '',
    },
    {
      name: '白若曦',
      role: '女配角',
      identity: '白家千金',
      gender: '女',
      age: '25岁',
      background: '白氏集团千金，一直喜欢顾延深。',
      personality: '骄纵任性、心机深沉',
      ability: '社交名媛',
      faction: '白氏集团',
      cultivationLevel: '',
    },
  ],
  locations: [
    {
      name: '顾氏集团大厦',
      type: '公司',
      description: '城市地标建筑，顾氏集团总部所在地。',
      geography: '市中心CBD核心区',
      inhabitants: '顾氏集团员工',
      importance: '核心',
    },
    {
      name: '苏晚的小公寓',
      type: '住宅',
      description: '苏晚租住的温馨小公寓。',
      geography: '市区普通小区',
      inhabitants: '苏晚',
      importance: '重要',
    },
    {
      name: '星光设计公司',
      type: '公司',
      description: '苏晚工作的设计公司。',
      geography: '创意园区内',
      inhabitants: '设计公司员工',
      importance: '重要',
    },
  ],
  factions: [
    {
      name: '顾氏集团',
      type: '商业集团',
      leader: '顾延深',
      description: '跨国商业巨头，涉及多个行业。',
      rank: '行业第一',
    },
    {
      name: '白氏集团',
      type: '商业集团',
      leader: '白振邦',
      description: '老牌企业，与顾氏有生意往来。',
      rank: '行业前十',
    },
  ],
  items: [
    {
      name: '钻石项链',
      type: '珠宝',
      grade: '极品',
      description: '顾延深送给苏晚的定情信物。',
      effect: '定情信物',
      owner: '苏晚',
    },
  ],
  chapters: [
    {
      volume: 1,
      chapter: 1,
      title: '第一章：初遇',
      content: generateLongText(
        '苏晚怎么也没想到，自己第一天去新公司报到，就撞上了传说中的顾氏集团总裁。',
        3000
      ),
    },
    {
      volume: 1,
      chapter: 2,
      title: '第二章：误会',
      content: generateLongText(
        '因为一场误会，苏晚被误认为是顾延深的女朋友，这让她百口莫辩。',
        3000
      ),
    },
  ],
  volumeOutline: {
    volume: 1,
    title: '心动初遇',
    chapters: [
      { number: 1, title: '初遇', summary: '苏晚与顾延深初次相遇' },
      { number: 2, title: '误会', summary: '一场误会让两人产生交集' },
    ],
  },
  sampleText: '苏晚站在顾氏集团大厦的落地窗前，看着窗外的车水马龙，心中五味杂陈。她从未想过，自己的人生会因为一次意外的相遇而彻底改变。',
  synopsis: '设计师苏晚意外与霸道总裁顾延深相遇，从最初的误会到逐渐相知相爱，在这个繁华都市中演绎了一段甜蜜浪漫的爱情故事。',
  tags: ['现代言情', '总裁', '甜宠', '职场', '先婚后爱'],
};

export const MYSTERY_SCENARIO: TestScenario = {
  id: 'mystery',
  name: '悬疑推理',
  genre: '悬疑推理',
  channel: 'neutral',
  worldview: {
    worldName: '迷雾城',
    genre: '悬疑推理',
    description: '一座笼罩在迷雾中的城市，接连发生离奇案件。',
    cultivationSystem: '无',
    geography: '沿海城市，常年多雾',
    history: '近年来发生了多起未解悬案',
  },
  characters: [
    {
      name: '陈默',
      role: '主角',
      identity: '刑警队长',
      gender: '男',
      age: '32岁',
      background: '经验丰富的刑警，破获多起大案，思维缜密。',
      personality: '冷静理智、观察力强、正义感强',
      ability: '推理能力、犯罪心理分析',
      faction: '市公安局',
      cultivationLevel: '',
    },
    {
      name: '林雨桐',
      role: '女主角',
      identity: '法医',
      gender: '女',
      age: '28岁',
      background: '知名法医，专业能力出众，是陈默的得力助手。',
      personality: '严谨认真、外冷内热、专业',
      ability: '法医鉴定、细节观察',
      faction: '市公安局',
      cultivationLevel: '',
    },
    {
      name: '老张',
      role: '男配角',
      identity: '老刑警',
      gender: '男',
      age: '50岁',
      background: '从警三十年的老刑警，经验丰富。',
      personality: '沉稳老练、经验丰富、关心后辈',
      ability: '刑侦经验、人脉广',
      faction: '市公安局',
      cultivationLevel: '',
    },
    {
      name: '神秘人X',
      role: '反派',
      identity: '未知',
      gender: '不详',
      age: '不详',
      background: '连环案件的幕后黑手，身份成谜。',
      personality: '狡猾残忍、智商极高',
      ability: '反侦察能力强',
      faction: '',
      cultivationLevel: '',
    },
  ],
  locations: [
    {
      name: '市公安局',
      type: '政府机构',
      description: '陈默和林雨桐工作的地方。',
      geography: '市中心',
      inhabitants: '警察、工作人员',
      importance: '核心',
    },
    {
      name: '迷雾港口',
      type: '地点',
      description: '城市的老港口，常年被迷雾笼罩，第一起案件发生地。',
      geography: '城市东部沿海',
      inhabitants: '码头工人、渔民',
      importance: '重要',
    },
    {
      name: '老城区',
      type: '城区',
      description: '城市的老城区，鱼龙混杂，线索众多。',
      geography: '城市南部',
      inhabitants: '老居民、流动人口',
      importance: '重要',
    },
  ],
  factions: [
    {
      name: '市公安局',
      type: '执法机构',
      leader: '王局长',
      description: '维护城市治安的执法机构。',
      rank: '市级',
    },
  ],
  items: [
    {
      name: '神秘钥匙',
      type: '证物',
      grade: '重要',
      description: '在案发现场发现的神秘钥匙，似乎指向某个秘密。',
      effect: '案件关键证物',
      owner: '警方',
    },
  ],
  chapters: [
    {
      volume: 1,
      chapter: 1,
      title: '第一章：迷雾中的尸体',
      content: generateLongText(
        '清晨，迷雾港口的工人在集装箱里发现了一具尸体。陈默接到报案后立刻赶到现场。',
        3000
      ),
    },
    {
      volume: 1,
      chapter: 2,
      title: '第二章：法医报告',
      content: generateLongText(
        '林雨桐的尸检报告出来了，死者的死因让所有人都感到意外。陈默盯着报告上的结论，陷入了沉思。',
        3000
      ),
    },
  ],
  volumeOutline: {
    volume: 1,
    title: '迷雾初现',
    chapters: [
      { number: 1, title: '迷雾中的尸体', summary: '发现第一具尸体，案件展开' },
      { number: 2, title: '法医报告', summary: '尸检发现重要线索' },
    ],
  },
  sampleText: '陈默站在迷雾港口，望着眼前翻滚的浓雾，眉头紧锁。这起案子比他想象的要复杂得多，凶手似乎对警察的办案手法了如指掌。',
  synopsis: '刑警队长陈默与法医林雨桐联手调查一系列离奇案件，在迷雾重重的城市中追寻真相，与高智商罪犯展开惊心动魄的较量。',
  tags: ['悬疑', '推理', '刑侦', '破案', '烧脑'],
};

export const ALL_SCENARIOS: TestScenario[] = [
  XUANHUAN_SCENARIO,
  ROMANCE_SCENARIO,
  MYSTERY_SCENARIO,
];

export function getScenarioById(id: string): TestScenario | undefined {
  return ALL_SCENARIOS.find(s => s.id === id);
}
