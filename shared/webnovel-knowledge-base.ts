export interface SubGenreFeatureConfig {
  characterTypes: string[];
  sceneTypes: string[];
  goldenFingerTypes: string[];
  coolPointTypes: string[];
}

export interface SubGenreWeights {
  keyword: number;
  character: number;
  scene: number;
  goldenFinger: number;
  vector: number;
}

export interface SubGenreConfig {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  exampleTitles: string[];
  features?: SubGenreFeatureConfig;
  weights?: SubGenreWeights;
}

export interface GenreConfig {
  id: string;
  name: string;
  category: 'male' | 'female' | 'neutral';
  description: string;
  personalityTags: string[];
  abilityTypes: string[];
  roleTypes: string[];
  backgroundTypes: string[];
  techniques: TechniqueDef[];
  subGenres?: SubGenreConfig[];
  weights: {
    character: number;
    foreshadow: number;
    technique: number;
    style: number;
    rhythm: number;
    structure: number;
  };
  isCustom?: boolean;
}

export interface TechniqueDef {
  id: string;
  name: string;
  category: 'structure' | 'cool_point' | 'emotion' | 'rhythm' | 'genre' | 'style' | 'foreshadow';
  description: string;
  keywords: string[];
  baseConfidence: number;
  genreWeight: number;
}

export interface ForeshadowCategoryDef {
  id: 'item' | 'skill' | 'character' | 'setting' | 'event';
  name: string;
  description: string;
  setupPatterns: string[];
  payoffPatterns: string[];
  examples: string[];
}

const XUANHUAN_XIANXIA: GenreConfig = {
  id: 'xuanhuan_xianxia',
  name: '玄幻修仙',
  category: 'male',
  description: '以修炼升级为核心的东方幻想题材，包含修仙、玄幻、修真、仙侠等子类，强调个人实力提升、宗门争斗、天地法则探索',
  personalityTags: [
    '杀伐果断', '扮猪吃虎', '白切黑', '腹黑', '隐忍', '痞气', '温润如玉', '清冷孤傲',
    '桀骜不驯', '热血冲动', '沉稳内敛', '狡黠机智', '刚正不阿', '亦正亦邪', '道心坚定',
    '随性洒脱', '睚眦必报', '重情重义', '冷酷无情', '仙风道骨', '邪魅狂狷', '敦厚老实',
    '野心勃勃', '淡泊名利', '争强好胜', '与世无争', '护短', '贱兮兮', '装逼犯', '老银币',
    '疯批美人', '圣母婊', '真小人', '伪君子', '大智若愚', '外冷内热', '毒舌', '闷骚'
  ],
  abilityTypes: [
    '功法', '神通', '法宝', '阵法', '炼丹', '炼器', '符箓', '御兽', '分身', '瞳术',
    '血脉', '体质', '灵根', '剑意', '道心', '领域', '世界', '法则', '天命', '气运',
    '神识', '遁术', '变身', '召唤', '傀儡', '蛊虫', '诅咒', '幻术', '音攻', '炼体',
    '双修', '采补', '禁制', '传承', '秘境'
  ],
  roleTypes: [
    '男主角', '女主角', '女配', '男配', '反派BOSS', '反派小弟', '宗门长老', '师尊',
    '师兄师姐', '师弟师妹', '家族族长', '天才子弟', '废柴子弟', '散修', '魔道修士',
    '正道修士', '妖族', '魔族', '神族', '鬼修', '器灵', '灵兽', '丹师', '器师',
    '阵法师', '符师', '商会会长', '拍卖行负责人', '皇帝', '皇子', '公主'
  ],
  backgroundTypes: [
    '宗门世界', '修真界', '凡间王朝', '修仙世家', '秘境副本', '上古遗迹', '九天仙界',
    '九幽魔界', '妖界', '鬼界', '小世界', '洞天福地', '灵脉矿脉', '坊市集市',
    '拍卖行', '丹城', '器城', '妖兽森林', '死亡绝地', '上古战场', '神魔陵园'
  ],
  techniques: [
    { id: 'xuanhuan_001', name: '废柴逆袭', category: 'cool_point', description: '主角初期被视为废物，通过机缘或努力逐渐变强，打脸看不起自己的人', keywords: ['废柴', '逆袭', '打脸', '废物', '天才'], baseConfidence: 0.8, genreWeight: 2.0 },
    { id: 'xuanhuan_002', name: '退婚流开局', category: 'structure', description: '开篇以女方退婚为切入点，建立主角逆袭动机和第一个打脸目标', keywords: ['退婚', '休妻', '看不起', '莫欺少年穷'], baseConfidence: 0.9, genreWeight: 1.8 },
    { id: 'xuanhuan_003', name: '老爷爷金手指', category: 'cool_point', description: '主角获得寄居在戒指或玉佩中的老者灵魂，传授功法指点迷津', keywords: ['老爷爷', '戒指', '玉佩', '传承', '师父'], baseConfidence: 0.85, genreWeight: 1.9 },
    { id: 'xuanhuan_004', name: '宗门大比', category: 'structure', description: '通过宗门内部比武排名来展现主角成长，制造冲突和爽点', keywords: ['大比', '比武', '排名', '擂台', '选拔'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'xuanhuan_005', name: '秘境探险', category: 'structure', description: '进入上古秘境或遗迹获取机缘，是升级和获得宝物的重要场景', keywords: ['秘境', '遗迹', '探险', '机缘', '宝藏'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'xuanhuan_006', name: '拍卖会装逼', category: 'cool_point', description: '在拍卖会上一掷千金或拍出天价宝物，震惊全场', keywords: ['拍卖', '出价', '天价', '震惊', '宝物'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'xuanhuan_007', name: '越级挑战', category: 'cool_point', description: '主角以低境界击败高境界对手，体现其强大实力', keywords: ['越级', '越阶', '挑战', '境界', '战力'], baseConfidence: 0.85, genreWeight: 1.9 },
    { id: 'xuanhuan_008', name: '炼丹炸炉', category: 'emotion', description: '主角炼丹时被人嘲笑，最终炼出极品丹药打脸', keywords: ['炼丹', '炸炉', '丹药', '丹雷', '极品'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'xuanhuan_009', name: '宗门站队', category: 'structure', description: '宗门内部派系争斗，主角选择站位或左右逢源', keywords: ['宗门', '派系', '站队', '长老', '内斗'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'xuanhuan_010', name: '英雄救美', category: 'emotion', description: '主角救下遇险的女角色，获得好感度和人脉', keywords: ['救美', '遇险', '英雄', '救下', '好感'], baseConfidence: 0.6, genreWeight: 1.3 },
    { id: 'xuanhuan_011', name: '功法残卷', category: 'structure', description: '主角获得残缺功法，补全后威力无穷', keywords: ['残卷', '残缺', '功法', '补全', '上古'], baseConfidence: 0.65, genreWeight: 1.5 },
    { id: 'xuanhuan_012', name: '血脉觉醒', category: 'cool_point', description: '主角隐藏的强大血脉在危机时刻觉醒，实力暴涨', keywords: ['血脉', '觉醒', '爆发', '返祖', '神兽'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'xuanhuan_013', name: '扮猪吃虎', category: 'cool_point', description: '主角隐藏实力，在关键时刻爆发震惊众人', keywords: ['扮猪吃虎', '隐藏', '低调', '爆发', '震惊'], baseConfidence: 0.85, genreWeight: 1.9 },
    { id: 'xuanhuan_014', name: '师徒反目', category: 'emotion', description: '师父或徒弟背叛，制造强烈情感冲突', keywords: ['师徒', '背叛', '反目', '决裂', '欺师灭祖'], baseConfidence: 0.6, genreWeight: 1.3 },
    { id: 'xuanhuan_015', name: '天地异象', category: 'cool_point', description: '主角突破或获得宝物时引发天地异象，彰显不凡', keywords: ['异象', '天变', '祥云', '雷劫', '地动'], baseConfidence: 0.75, genreWeight: 1.6 },
    { id: 'xuanhuan_016', name: '夺舍重生', category: 'structure', description: '主角灵魂占据他人身体重生，带着前世记忆', keywords: ['夺舍', '重生', '穿越', '转世', '前世'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'xuanhuan_017', name: '正邪大战', category: 'structure', description: '正道与魔道的大规模战争，是重要的剧情节点', keywords: ['正邪', '大战', '魔道', '正道', '战争'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'xuanhuan_018', name: '红颜祸水', category: 'emotion', description: '因为女角色引发的争斗和冲突', keywords: ['红颜', '美女', '争风吃醋', '抢亲', '倾城'], baseConfidence: 0.55, genreWeight: 1.2 },
    { id: 'xuanhuan_019', name: '世家恩怨', category: 'structure', description: '家族之间的世代仇恨和恩怨纠葛', keywords: ['世家', '家族', '恩怨', '世仇', '灭门'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'xuanhuan_020', name: '天劫雷罚', category: 'cool_point', description: '突破大境界时经历天劫考验，渡过则实力大增', keywords: ['天劫', '雷劫', '渡劫', '天罚', '雷劈'], baseConfidence: 0.8, genreWeight: 1.7 },
    { id: 'xuanhuan_021', name: '凡人流', category: 'genre', description: '主角资质普通，完全靠自身努力和谨慎步步为营', keywords: ['凡人', '普通', '谨慎', '苟', '稳扎稳打'], baseConfidence: 0.75, genreWeight: 1.6 },
    { id: 'xuanhuan_022', name: '无敌流', category: 'genre', description: '主角开局即无敌，以碾压姿态面对一切敌人', keywords: ['无敌', '碾压', '开局', '最强', '秒杀'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'xuanhuan_023', name: '灵气复苏', category: 'genre', description: '现代世界灵气逐渐恢复，修炼者重新出现', keywords: ['灵气复苏', '现代', '异能', '觉醒', '都市修真'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'xuanhuan_024', name: '洪荒封神', category: 'genre', description: '以洪荒神话或封神榜为背景的修仙故事', keywords: ['洪荒', '封神', '圣人', '巫妖', '盘古'], baseConfidence: 0.6, genreWeight: 1.3 },
    { id: 'xuanhuan_025', name: '儒道流', category: 'genre', description: '以读书、诗词、文章修炼的独特体系', keywords: ['儒道', '读书', '诗词', '浩然正气', '文气'], baseConfidence: 0.6, genreWeight: 1.3 },
    { id: 'xuanhuan_026', name: '升级节奏控制', category: 'rhythm', description: '合理安排升级间隔，避免升级过快或过慢', keywords: ['升级', '境界', '突破', '节奏', '进度'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'xuanhuan_027', name: '地图迭代', category: 'structure', description: '从低阶地图逐步进入高阶地图，不断展开更大世界观', keywords: ['地图', '下界', '上界', '飞升', '仙界'], baseConfidence: 0.8, genreWeight: 1.8 }
  ],
  subGenres: [
    {
      id: 'feichai',
      name: '废柴流',
      description: '主角初期被视为废柴，通过机缘或努力逆袭打脸',
      keywords: ['废柴', '废物', '逆袭', '打脸', '天才', '看不起', '莫欺少年穷', '废材', '垃圾', '没用', '嘲讽', '鄙视', '废物少爷', '废灵根', '杂灵根'],
      exampleTitles: ['斗破苍穹', '完美世界', '武动乾坤', '遮天', '凡人修仙传']
    },
    {
      id: 'fanren',
      name: '凡人流',
      description: '主角资质普通，靠自身努力和谨慎步步为营',
      keywords: ['凡人', '普通', '谨慎', '苟', '稳扎稳打', '一步步', '慢慢', '踏实', '苦修', '坚韧', '不拔', '毅力', '耐心', '低调', '隐忍'],
      exampleTitles: ['凡人修仙传', '仙逆', '求魔', '我师兄实在太稳健了', '修真世界']
    },
    {
      id: 'wudi',
      name: '无敌流',
      description: '主角开局即无敌，以碾压姿态面对一切敌人',
      keywords: ['无敌', '碾压', '开局', '最强', '秒杀', '一招', '无敌了', '天下第一', '绝世', '至高', '主宰', '无敌于', '横扫', '打爆', '无敌从'],
      exampleTitles: ['我师兄实在太稳健了', '大王饶命', '全职法师', '最强反套路系统', '无敌真寂寞']
    },
    {
      id: 'xitong',
      name: '系统流',
      description: '主角获得系统金手指，靠完成任务升级变强',
      keywords: ['系统', '任务', '奖励', '面板', '属性', '等级', '经验', '签到', '抽奖', '商城', '兑换', '技能点', '熟练度', '叮', '宿主'],
      exampleTitles: ['最强反套路系统', '我有一座恐怖屋', '超级神基因', '万界美梦系统', '无敌从满级属性开始']
    },
    {
      id: 'qiandao',
      name: '签到流',
      description: '主角靠签到获得奖励，躺着就能变强',
      keywords: ['签到', '打卡', '每日', '领取', '奖励', '天天', '签到系统', '签到就能', '每日签到', '开局签到', '签到奖励', '打卡签到', '签到百年', '签到十年', '签到获得'],
      exampleTitles: ['签到十万年', '我在大唐签到', '玄幻：签到百年', '签到从遮天开始', '每天签到一个大礼包']
    },
    {
      id: 'tuihun',
      name: '退婚流',
      description: '开篇以女方退婚为切入点，建立主角逆袭动机',
      keywords: ['退婚', '休妻', '悔婚', '解除婚约', '看不起', '莫欺少年穷', '三十年河东', '三十年河西', '退婚流', '被退婚', '上门退婚', '一纸休书', '休夫', '拒婚', '退婚吧'],
      exampleTitles: ['斗破苍穹', '傲世九重天', '异世邪君', '大周皇族', '神印王座']
    },
    {
      id: 'honghuang',
      name: '洪荒流',
      description: '以洪荒神话为背景的修仙故事',
      keywords: ['洪荒', '封神', '圣人', '巫妖', '盘古', '鸿钧', '三清', '女娲', '巫族', '妖族', '西游', '阐教', '截教', '人教', '龙凤'],
      exampleTitles: ['佛本是道', '黑山老妖', '洪荒之第一神经', '清虚道德天尊', '我在洪荒当咸鱼']
    },
    {
      id: 'rudao',
      name: '儒道流',
      description: '以读书、诗词、文章修炼的独特体系',
      keywords: ['儒道', '读书', '诗词', '浩然正气', '文气', '文章', '才子', '文人', '圣道', '文曲星', '笔墨纸砚', '诗词歌赋', '琴棋书画', '金榜题名', '状元'],
      exampleTitles: ['儒道至圣', '逍遥游', '文圣', '寒门崛起', '上品寒士']
    },
    {
      id: 'lingqi_fusu',
      name: '灵气复苏',
      description: '现代世界灵气逐渐恢复，修炼者重新出现',
      keywords: ['灵气复苏', '现代', '异能', '觉醒', '都市修真', '复苏', '末法时代', '灵气', '修炼者', '异能者', '觉醒者', '超凡', '异变', '进化', '新时代'],
      exampleTitles: ['大王饶命', '全球高武', '修真聊天群', '我师兄实在太稳健了', '深空彼岸']
    }
  ],
  weights: { character: 0.25, foreshadow: 0.2, technique: 0.2, style: 0.1, rhythm: 0.15, structure: 0.1 }
};

const DUSHI_MODERN: GenreConfig = {
  id: 'dushi_modern',
  name: '都市现代',
  category: 'male',
  description: '以现代都市为背景的男频小说，涵盖都市生活、异能、重生、商战、校园等子类，贴近现实又充满爽点',
  personalityTags: [
    '杀伐果断', '扮猪吃虎', '腹黑', '隐忍', '痞气', '温润如玉', '桀骜不驯', '沉稳内敛',
    '狡黠机智', '重情重义', '冷酷无情', '亦正亦邪', '随性洒脱', '睚眦必报', '野心勃勃',
    '争强好胜', '护短', '贱兮兮', '装逼犯', '老银币', '外冷内热', '毒舌', '闷骚',
    '讲义气', '风流倜傥', '霸道总裁', '暖男', '渣男', '老实人', '社会人', '老油条',
    '精明能干', '油嘴滑舌', '刚正不阿', '玩世不恭', '大男子主义'
  ],
  abilityTypes: [
    '医术', '赌石', '鉴宝', '神豪', '系统', '重生', '穿越', '异能', '透视', '读心术',
    '预知', '隐身', '力大无穷', '速度', '精神力', '古武术', '内功', '风水相术',
    '占卜算命', '厨艺', '种植', '养殖', '商业天才', '黑客技术', '枪械精通',
    '格斗术', '特种兵', '修仙', '修真', '功法', '法宝', '符箓', '丹道', '阵道'
  ],
  roleTypes: [
    '男主角', '女主角', '女配角', '男配角', '反派BOSS', '富二代', '官二代', '黑道大佬',
    '白富美', '总裁', '秘书', '校花', '班花', '老师', '医生', '护士', '警察',
    '特种兵', '雇佣兵', '商业对手', '家族长辈', '兄弟', '发小', '情敌', '岳父岳母',
    '下属员工', '客户', '合作伙伴', '仇人', '恩人'
  ],
  backgroundTypes: [
    '一线城市', '二线城市', '小县城', '农村', '大学校园', '高中校园', '公司职场',
    '医院', '警局', '军队', '赌场', '古玩城', '玉石市场', '拍卖会', '高档酒店',
    '夜总会', '别墅区', '贫民窟', '城中村', '商业街', '写字楼', '工厂', '农场'
  ],
  techniques: [
    { id: 'dushi_001', name: '重生逆袭', category: 'cool_point', description: '主角重生回到过去，利用前世记忆改变命运，弥补遗憾', keywords: ['重生', '回到过去', '前世', '遗憾', '逆袭'], baseConfidence: 0.85, genreWeight: 2.0 },
    { id: 'dushi_002', name: '神豪系统', category: 'cool_point', description: '主角获得花钱系统，越花越有钱，开启奢靡生活', keywords: ['神豪', '系统', '花钱', '暴富', '消费'], baseConfidence: 0.8, genreWeight: 1.9 },
    { id: 'dushi_003', name: '赘婿流', category: 'structure', description: '主角入赘女方家被看不起，实则身份显赫，最终打脸众人', keywords: ['赘婿', '入赘', '看不起', '窝囊废', '打脸'], baseConfidence: 0.85, genreWeight: 1.9 },
    { id: 'dushi_004', name: '兵王归来', category: 'structure', description: '退役特种兵或兵王回归都市，在都市中掀起风云', keywords: ['兵王', '特种兵', '退役', '归来', '战神'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'dushi_005', name: '透视赌石', category: 'cool_point', description: '主角获得透视能力，在赌石市场捡漏发财', keywords: ['透视', '赌石', '翡翠', '捡漏', '玉石'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'dushi_006', name: '鉴宝捡漏', category: 'cool_point', description: '主角精通鉴宝，在古玩市场低价买入真品高价卖出', keywords: ['鉴宝', '古玩', '捡漏', '古董', '收藏'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'dushi_007', name: '神医圣手', category: 'cool_point', description: '主角医术高超，治好各种疑难杂症，结交权贵', keywords: ['神医', '医术', '治病', '圣手', '疑难杂症'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'dushi_008', name: '校园风云', category: 'structure', description: '主角在校园中从普通学生变为校园大佬', keywords: ['校园', '学生', '校草', '校花', '学霸'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'dushi_009', name: '商战风云', category: 'structure', description: '主角在商场上纵横捭阖，建立商业帝国', keywords: ['商战', '商业', '创业', '公司', '上市'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'dushi_010', name: '官场沉浮', category: 'structure', description: '主角在官场中步步为营，从基层晋升到高位', keywords: ['官场', '晋升', '仕途', '为官', '体制'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'dushi_011', name: '扮猪吃虎', category: 'cool_point', description: '主角隐藏真实身份和实力，关键时刻打脸装逼犯', keywords: ['扮猪吃虎', '隐藏', '低调', '爆发', '震惊'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'dushi_012', name: '打脸装逼', category: 'cool_point', description: '反派嚣张跋扈，主角出场狠狠打脸，让其颜面尽失', keywords: ['打脸', '装逼', '嚣张', '跪下', '道歉'], baseConfidence: 0.85, genreWeight: 1.9 },
    { id: 'dushi_013', name: '美女环绕', category: 'emotion', description: '各种类型的美女围绕在主角身边，情感线丰富', keywords: ['美女', '校花', '总裁', '御姐', '萝莉'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'dushi_014', name: '英雄救美', category: 'emotion', description: '主角救下被骚扰或遇险的美女，获得好感', keywords: ['救美', '英雄', '救下', '遇险', '骚扰'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'dushi_015', name: '情敌较量', category: 'emotion', description: '与情敌在各方面竞争，最终赢得美人归', keywords: ['情敌', '竞争', '追求', '争风吃醋', '抢'], baseConfidence: 0.6, genreWeight: 1.3 },
    { id: 'dushi_016', name: '家族恩怨', category: 'structure', description: '豪门家族内部的权力斗争和恩怨纠葛', keywords: ['家族', '豪门', '内斗', '争产', '继承权'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'dushi_017', name: '黑道争锋', category: 'structure', description: '主角在地下世界建立势力，与其他帮派争斗', keywords: ['黑道', '帮派', '大哥', '地盘', '火拼'], baseConfidence: 0.6, genreWeight: 1.3 },
    { id: 'dushi_018', name: '风水相术', category: 'genre', description: '主角精通风水相术，看相算命、堪舆风水', keywords: ['风水', '相术', '算命', '面相', '堪舆'], baseConfidence: 0.6, genreWeight: 1.3 },
    { id: 'dushi_019', name: '乡村种田', category: 'genre', description: '主角回到农村，靠特殊能力带领乡亲发家致富', keywords: ['乡村', '种田', '农村', '发家致富', '山泉'], baseConfidence: 0.6, genreWeight: 1.2 },
    { id: 'dushi_020', name: '直播网红', category: 'genre', description: '主角成为网络主播或网红，开启不一样的人生', keywords: ['直播', '网红', '主播', '粉丝', '打赏'], baseConfidence: 0.55, genreWeight: 1.2 },
    { id: 'dushi_021', name: '黑客帝国', category: 'genre', description: '主角是顶级黑客，在网络世界中无所不能', keywords: ['黑客', '网络', '电脑', '技术', '入侵'], baseConfidence: 0.55, genreWeight: 1.2 },
    { id: 'dushi_022', name: '快节奏爽点密集', category: 'rhythm', description: '都市文节奏要快，爽点密集，满足读者即时满足感', keywords: ['节奏', '爽点', '快', '密集', '打脸'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'dushi_023', name: '装逼打脸三段式', category: 'structure', description: '标准的装逼打脸结构：反派挑衅→众人嘲讽→主角打脸', keywords: ['三段式', '挑衅', '嘲讽', '打脸', '震惊'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'dushi_024', name: '身份反差', category: 'cool_point', description: '表面身份与真实身份的巨大反差，制造爽点', keywords: ['身份', '反差', '隐藏', '暴露', '真实'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'dushi_025', name: '金钱开路', category: 'cool_point', description: '用钱解决问题，体验金钱的力量', keywords: ['钱', '砸钱', '金钱', '财富', '买买买'], baseConfidence: 0.65, genreWeight: 1.5 },
    { id: 'dushi_026', name: '权力游戏', category: 'structure', description: '在权力场中周旋，上位者的博弈', keywords: ['权力', '博弈', '上位', '权谋', '斗争'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'dushi_027', name: '市井烟火气', category: 'style', description: '接地气的都市生活描写，让读者有代入感', keywords: ['市井', '烟火气', '接地气', '生活', '真实'], baseConfidence: 0.6, genreWeight: 1.3 }
  ],
  subGenres: [
    {
      id: 'dushi_yineng',
      name: '都市异能',
      description: '现代都市背景下主角拥有超能力或异能',
      keywords: ['异能', '超能力', '都市', '现代', '觉醒', '特异功能', '透视', '读心', '预知', '隐身', '精神力', '念动力', '异能者', '超凡', '变异'],
      exampleTitles: ['大王饶命', '全球高武', '我有一座恐怖屋', '最强反套路系统', '修真聊天群']
    },
    {
      id: 'dushi_chongsheng',
      name: '都市重生',
      description: '主角重生回到现代都市过去，利用前世记忆改变命运',
      keywords: ['重生', '回到过去', '前世', '都市重生', '重生之', '重回', '回到', '重来', '再生', '转世', '穿越现代', '重生归来', '带着记忆', '前世记忆', '弥补遗憾'],
      exampleTitles: ['重生之都市修仙', '重生完美时代', '大涅槃', '重生之财源滚滚', '我真的没想重生']
    },
    {
      id: 'shenhao',
      name: '神豪流',
      description: '主角获得花不完的钱，开启奢靡土豪生活',
      keywords: ['神豪', '土豪', '花钱', '暴富', '有钱', '神豪系统', '败家', '挥霍', '买买买', '一掷千金', '首富', '千亿', '万亿', '消费', '打赏'],
      exampleTitles: ['我有亿万家产', '神豪从签到开始', '都市：我有一个神豪系统', '我的首富身份被曝光了', '神豪的悠闲生活']
    },
    {
      id: 'zhuixu',
      name: '赘婿流',
      description: '主角入赘女方家被看不起，实则身份显赫最终打脸众人',
      keywords: ['赘婿', '入赘', '窝囊废', '上门女婿', '倒插门', '看不起', '打脸', '身份', '隐藏', '真实身份', '岳父岳母', '妻子', '嫌弃', '废物', '豪门'],
      exampleTitles: ['赘婿', '上门龙婿', '我的极品老婆', '超级赘婿', '最强赘婿']
    },
    {
      id: 'bingwang',
      name: '兵王流',
      description: '退役特种兵或兵王回归都市，在都市中掀起风云',
      keywords: ['兵王', '特种兵', '退役', '归来', '战神', '兵王归来', '特种兵王', '雇佣军', '战狼', '兵王传奇', '铁血兵王', '最强兵王', '军神', '兵王在都市', '退役兵王'],
      exampleTitles: ['兵王在都市', '我的冰山总裁老婆', '最强兵王', '超级兵王', '近身保镖']
    },
    {
      id: 'yidao',
      name: '医道流',
      description: '主角医术高超，治好各种疑难杂症，结交权贵',
      keywords: ['神医', '医术', '治病', '圣手', '疑难杂症', '医生', '中医', '西医', '针灸', '药方', '医术高明', '妙手回春', '起死回生', '国医', '医道'],
      exampleTitles: ['天才医生', '首席御医', '医道官途', '妙手小村医', '都市仙医']
    },
    {
      id: 'jianbao',
      name: '鉴宝流',
      description: '主角精通鉴宝，在古玩市场捡漏发财',
      keywords: ['鉴宝', '古玩', '捡漏', '古董', '收藏', '赌石', '翡翠', '玉石', '文物', '拍卖行', '宝贝', '真品', '赝品', '眼力', '淘宝'],
      exampleTitles: ['黄金瞳', '捡漏', '天才相师', '宝鉴', '超级黄金手']
    },
    {
      id: 'shangzhan',
      name: '商战流',
      description: '主角在商场上纵横捭阖，建立商业帝国',
      keywords: ['商战', '商业', '创业', '公司', '上市', '总裁', 'CEO', '商界', '商场', '创业史', '商业帝国', '企业家', '投资', '融资', '收购'],
      exampleTitles: ['大时代', '重生之财源滚滚', '完美时代', '我真的没想重生', '财色']
    },
    {
      id: 'xiaoyuan_dushi',
      name: '校园都市',
      description: '以校园为主要场景的都市小说，包含青春、校园生活元素',
      keywords: ['校园', '学生', '校花', '校草', '大学', '高中', '学霸', '校园生活', '青春', '同班同学', '学生会', '校园风云', '校花的贴身高手', '校园全能高手', '我真是大明星'],
      exampleTitles: ['校花的贴身高手', '很纯很暧昧', '重生之大涅磐', '我真是大明星', '我的26岁女房客']
    }
  ],
  weights: { character: 0.2, foreshadow: 0.15, technique: 0.25, style: 0.1, rhythm: 0.2, structure: 0.1 }
};

const GUDAI_YANQING: GenreConfig = {
  id: 'gudai_yanqing',
  name: '古代言情',
  category: 'female',
  description: '以古代为背景的女频言情小说，包含宫斗、宅斗、穿越、重生、种田经商等子类，侧重情感纠葛和女性成长',
  personalityTags: [
    '温婉贤淑', '清冷孤傲', '腹黑', '白切黑', '病娇', '傲娇', '隐忍', '坚韧不拔',
    '敢爱敢恨', '温柔体贴', '刁蛮任性', '心地善良', '心机深沉', '天真烂漫', '足智多谋',
    '杀伐果断', '外柔内刚', '痴情专一', '水性杨花', '贞洁烈女', '大家闺秀', '小家碧玉',
    '英姿飒爽', '妩媚妖娆', '端庄大气', '娇羞可人', '泼辣', '毒舌', '闷骚', '护短',
    '圣母', '白莲', '绿茶', '心机婊', '傻白甜', '女强人'
  ],
  abilityTypes: [
    '医术', '毒术', '谋略', '武功', '轻功', '暗器', '易容', '催眠', '读心', '预知',
    '穿越', '重生', '空间', '系统', '灵泉', '种田', '经商', '厨艺', '女红', '书画',
    '音律', '舞技', '茶道', '花道', '香道', '占卜', '风水', '相术', '御兽', '炼药',
    '阵法', '符箓', '修仙', '媚术', '蛊毒'
  ],
  roleTypes: [
    '女主角', '男主角', '男配', '女配', '反派女配', '反派男配', '皇帝', '皇后',
    '贵妃', '太后', '太子', '皇子', '公主', '王爷', '王妃', '世子', '郡主',
    '侯爷', '夫人', '小姐', '公子', '丫鬟', '小厮', '嬷嬷', '太监', '太医',
    '将军', '丞相', '尚书', '江湖侠客', '魔教教主', '武林盟主', '富商', '老鸨'
  ],
  backgroundTypes: [
    '皇宫内院', '王府侯门', '世家大族', '小户人家', '宫闱深处', '后宫妃嫔',
    '东宫太子府', '王府后院', '宅门内院', '古代街道', '市集庙会', '青楼楚馆',
    '茶馆酒楼', '客栈驿馆', '书院学堂', '寺庙道观', '田园乡村', '边塞军营',
    '江湖帮派', '魔教总坛', '武林世家', '皇家围场', '行宫别院', '皇家园陵'
  ],
  techniques: [
    { id: 'gudai_001', name: '穿越逆袭', category: 'cool_point', description: '现代女性穿越到古代，凭借现代知识和观念逆袭人生', keywords: ['穿越', '现代', '古代', '逆袭', '灵魂'], baseConfidence: 0.85, genreWeight: 2.0 },
    { id: 'gudai_002', name: '重生复仇', category: 'structure', description: '女主前世被害惨死，重生归来步步为营复仇雪恨', keywords: ['重生', '复仇', '前世', '惨死', '重来'], baseConfidence: 0.85, genreWeight: 2.0 },
    { id: 'gudai_003', name: '宫斗升级', category: 'structure', description: '女主在后宫中从低位妃嫔一步步晋升到高位', keywords: ['宫斗', '后宫', '妃嫔', '晋升', '争宠'], baseConfidence: 0.8, genreWeight: 1.9 },
    { id: 'gudai_004', name: '宅斗风云', category: 'structure', description: '女主在后宅中与妻妾、妯娌、婆母斗智斗勇', keywords: ['宅斗', '后宅', '妻妾', '妯娌', '内斗'], baseConfidence: 0.75, genreWeight: 1.8 },
    { id: 'gudai_005', name: '种田经商', category: 'structure', description: '女主靠种田或经商发家致富，撑起家业', keywords: ['种田', '经商', '发家', '致富', '生意'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'gudai_006', name: '替身梗', category: 'emotion', description: '女主因为像男主的白月光而被选中，后来男主真爱女主', keywords: ['替身', '白月光', '像', '代替', '真爱'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'gudai_007', name: '追妻火葬场', category: 'emotion', description: '男主前期不珍惜女主，后期后悔疯狂追妻', keywords: ['追妻', '火葬场', '后悔', '珍惜', '挽回'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'gudai_008', name: '先婚后爱', category: 'structure', description: '男女主先结婚后恋爱，在相处中渐生情愫', keywords: ['先婚后爱', '婚姻', '相处', '日久生情', '联姻'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'gudai_009', name: '指腹为婚', category: 'structure', description: '因指腹为婚或赐婚而在一起的男女主', keywords: ['指腹为婚', '赐婚', '婚约', '娃娃亲', '联姻'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'gudai_010', name: '退婚流', category: 'structure', description: '男方或女方退婚，后续发展出不一样的故事', keywords: ['退婚', '解除婚约', '休妻', '和离', '拒婚'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'gudai_011', name: '白月光与朱砂痣', category: 'emotion', description: '男主心中有白月光，女主是朱砂痣的情感纠葛', keywords: ['白月光', '朱砂痣', '初恋', '心头好', '得不到'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'gudai_012', name: '虐恋情深', category: 'emotion', description: '男女主之间爱得很痛苦，误会重重彼此折磨', keywords: ['虐恋', '误会', '折磨', '心痛', '情深'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'gudai_013', name: '甜宠无虐', category: 'emotion', description: '全程高甜无虐，男主宠女主宠上天', keywords: ['甜宠', '宠妻', '无虐', '高甜', '宠溺'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'gudai_014', name: '女扮男装', category: 'structure', description: '女主女扮男装，在男性主导的世界里打拼', keywords: ['女扮男装', '男装', '身份', '掩饰', '暴露'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'gudai_015', name: '替嫁新娘', category: 'structure', description: '女主代替别人出嫁，意外收获真爱', keywords: ['替嫁', '代替', '新娘', '出嫁', '错嫁'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'gudai_016', name: '嫡女复仇', category: 'structure', description: '嫡女被庶母庶妹陷害，重生或归来复仇', keywords: ['嫡女', '庶女', '复仇', '嫡庶', '陷害'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'gudai_017', name: '权谋天下', category: 'structure', description: '女主辅佐男主争夺天下，在权谋中成长', keywords: ['权谋', '天下', '夺嫡', '皇位', '江山'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'gudai_018', name: '江湖侠女', category: 'genre', description: '女主行走江湖，快意恩仇的武侠言情', keywords: ['江湖', '侠女', '武侠', '门派', '恩怨'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'gudai_019', name: '仙侠奇缘', category: 'genre', description: '带有修仙仙侠元素的古代言情', keywords: ['仙侠', '修仙', '修真', '仙子', '上神'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'gudai_020', name: '空间穿越', category: 'genre', description: '女主带着随身空间穿越到古代', keywords: ['空间', '随身', '灵泉', '仓库', '穿越'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'gudai_021', name: '帝后情深', category: 'emotion', description: '皇帝与皇后之间的爱情故事', keywords: ['帝后', '皇帝', '皇后', '情深', '帝王'], baseConfidence: 0.65, genreWeight: 1.5 },
    { id: 'gudai_022', name: '身世之谜', category: 'structure', description: '女主的真实身世是个谜，逐渐揭开', keywords: ['身世', '秘密', '亲生', '血脉', '谜团'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'gudai_023', name: '打脸虐渣', category: 'cool_point', description: '女主狠狠打脸白莲花、绿茶女配和渣男', keywords: ['打脸', '虐渣', '白莲花', '绿茶', '渣男'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'gudai_024', name: '母子联手', category: 'structure', description: '女主带着萌宝一起逆袭，孩子是神助攻', keywords: ['萌宝', '儿子', '母子', '宝宝', '神助攻'], baseConfidence: 0.65, genreWeight: 1.5 },
    { id: 'gudai_025', name: '权谋宅斗双线', category: 'structure', description: '前朝权谋与后宅争斗双线并行', keywords: ['前朝', '后宅', '双线', '权谋', '宅斗'], baseConfidence: 0.6, genreWeight: 1.3 },
    { id: 'gudai_026', name: '细腻情感描写', category: 'style', description: '古代言情注重情感的细腻描写和心理刻画', keywords: ['细腻', '心理', '情感', '细节', '内心'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'gudai_027', name: '古风水墨感', category: 'style', description: '语言风格古色古香，营造古风意境', keywords: ['古风', '意境', '古色古香', '水墨', '雅致'], baseConfidence: 0.7, genreWeight: 1.6 }
  ],
  subGenres: [
    {
      id: 'chuanyue_gu',
      name: '穿越古言',
      description: '现代女性穿越到古代，凭借现代知识和观念逆袭人生',
      keywords: ['穿越', '现代', '古代', '逆袭', '灵魂', '穿越到', '穿越之', '穿越成', '穿越女', '现代灵魂', '时空穿越', '穿越回', '穿越到古代', '女主穿越', '意外穿越'],
      exampleTitles: ['步步惊心', '绾青丝', '醉玲珑', '蔓蔓青萝', '凤囚凰']
    },
    {
      id: 'chongsheng_fuchou',
      name: '重生复仇',
      description: '女主前世被害惨死，重生归来步步为营复仇雪恨',
      keywords: ['重生', '复仇', '前世', '惨死', '重来', '重生之', '重生女', '复仇文', '重生复仇', '前世今生', '重生回来', '重生逆袭', '重生后', '重生了', '重生文'],
      exampleTitles: ['锦绣未央', '庶女有毒', '重生之将门毒后', '重生之嫡女祸妃', '权臣闲妻']
    },
    {
      id: 'gongdou',
      name: '宫斗权谋',
      description: '女主在后宫中从低位妃嫔一步步晋升到高位',
      keywords: ['宫斗', '后宫', '妃嫔', '晋升', '争宠', '皇后', '贵妃', '皇帝', '后宫妃嫔', '宫闱', '宫廷斗争', '后宫争斗', '妃嫔争宠', '深宫', '后宫文'],
      exampleTitles: ['甄嬛传', '如懿传', '延禧攻略', '芈月传', '美人心计']
    },
    {
      id: 'zhaidou',
      name: '宅斗种田',
      description: '女主在后宅中与妻妾妯娌斗智斗勇，或种田经商发家致富',
      keywords: ['宅斗', '后宅', '妻妾', '妯娌', '内斗', '种田', '经商', '发家', '致富', '生意', '侯府', '王府', '庶女', '嫡女', '宅门'],
      exampleTitles: ['知否知否', '庶女有毒', '锦心似玉', '花开锦绣', '名门闺杀']
    },
    {
      id: 'xianhunhouai',
      name: '先婚后爱',
      description: '男女主先结婚后恋爱，在相处中渐生情愫',
      keywords: ['先婚后爱', '婚姻', '相处', '日久生情', '联姻', '指腹为婚', '赐婚', '婚约', '娃娃亲', '先结婚后恋爱', '婚后相处', '契约婚姻', '假戏真做', '先嫁后爱', '婚后恋'],
      exampleTitles: ['锦心似玉', '知否知否', '传闻中的陈芊芊', '芸汐传', '双世宠妃']
    },
    {
      id: 'tianchong',
      name: '甜宠无虐',
      description: '全程高甜无虐，男主宠女主宠上天',
      keywords: ['甜宠', '宠妻', '无虐', '高甜', '宠溺', '宠文', '甜文', '撒糖', '甜蜜', '宠妻狂魔', '超甜', '甜到齁', '甜宠文', '全程甜', '无虐甜宠'],
      exampleTitles: ['微微一笑很倾城', '何以笙箫默', '杉杉来吃', '亲爱的热爱的', '你是我的荣耀']
    },
    {
      id: 'nüban_nanzhuang',
      name: '女扮男装',
      description: '女主女扮男装，在男性主导的世界里打拼',
      keywords: ['女扮男装', '男装', '身份', '掩饰', '暴露', '扮男装', '女扮男', '男子装扮', '伪装男子', '女扮男装文', '巾帼不让须眉', '男装女主', '女世子', '女巡按', '女驸马'],
      exampleTitles: ['上错花轿嫁对郎', '新女驸马', '女世子', '少年游之一寸相思', '花不弃']
    },
    {
      id: 'quanmou_tianxia',
      name: '权谋天下',
      description: '女主辅佐男主争夺天下，在权谋中成长',
      keywords: ['权谋', '天下', '夺嫡', '皇位', '江山', '权谋天下', '宫廷权谋', '政治斗争', '朝堂', '摄政王', '皇帝', '王爷', '谋天下', '权谋文', '江山美人'],
      exampleTitles: ['琅琊榜', '知否知否', '锦绣未央', '独孤天下', '凤唳九天']
    },
    {
      id: 'dizhai_yaonie',
      name: '嫡宅妖孽',
      description: '嫡女庶女之间的宅斗，女主白切黑，手段高明',
      keywords: ['嫡女', '庶女', '宅斗', '嫡庶', '陷害', '白切黑', '腹黑', '毒后', '嫡女归来', '庶女有毒', '嫡女谋', '庶女策', '侯府嫡女', '嫡女风华', '庶女逆袭'],
      exampleTitles: ['庶女有毒', '锦绣未央', '重生之将门毒后', '嫡女难求', '贵女嫡谋']
    }
  ],
  weights: { character: 0.3, foreshadow: 0.15, technique: 0.15, style: 0.15, rhythm: 0.1, structure: 0.15 }
};

const XIANDAI_YANQING: GenreConfig = {
  id: 'xiandai_yanqing',
  name: '现代言情',
  category: 'female',
  description: '以现代都市为背景的女频言情小说，包含总裁豪门、校园青春、职场婚恋等子类，侧重现代女性的爱情与成长',
  personalityTags: [
    '独立自主', '温柔体贴', '清冷孤傲', '腹黑', '白切黑', '病娇', '傲娇', '隐忍',
    '坚韧不拔', '敢爱敢恨', '天真烂漫', '心机深沉', '杀伐果断', '外冷内热', '痴情专一',
    '温婉可人', '活泼开朗', '内向害羞', '强势霸道', '自尊心强', '敏感多疑', '缺爱',
    '乐观向上', '自卑怯懦', '阳光开朗', '阴郁深沉', '毒舌', '闷骚', '护短', '圣母',
    '白莲', '绿茶', '傻白甜', '女强人', '御姐', '萝莉', '软妹'
  ],
  abilityTypes: [
    '设计', '编程', '医术', '律师', '金融', '投资', '厨艺', '绘画', '音乐', '舞蹈',
    '演技', '唱歌', '写作', '翻译', '摄影', '商业天才', '黑客技术', '心理学',
    '占卜', '预知', '读心', '系统', '穿越', '重生', '空间', '异能', '透视',
    '武术', '格斗', '赛车', '调酒', '咖啡', '花艺', '烘焙', '美妆', '服装搭配'
  ],
  roleTypes: [
    '女主角', '男主角', '男二号', '女二号', '反派女配', '反派男配', '霸道总裁',
    '暖男学长', '青梅竹马', '初恋情人', '顶流明星', '知名设计师', '金牌律师',
    '天才医生', '职场上司', '闺蜜', '情敌', '前男友', '前女友', '家族长辈',
    '父母', '兄弟姐妹', '同事', '客户', '合作伙伴', '老板', '秘书', '助理',
    '经纪人', '粉丝', '狗仔队'
  ],
  backgroundTypes: [
    '一线城市CBD', '高档写字楼', '豪华别墅', '大学校园', '高中校园', '公司职场',
    '医院', '律师事务所', '设计工作室', '画廊', '音乐厅', '电视台', '影视城',
    '高级餐厅', '咖啡厅', '酒吧夜店', '购物中心', '机场高铁站', '公寓小区',
    '海边度假村', '温泉酒店', '滑雪场', '古镇旅游', '国外留学', '贫民窟',
    '城中村', '菜市场'
  ],
  techniques: [
    { id: 'xiandai_001', name: '霸道总裁', category: 'cool_point', description: '男主是霸道多金的总裁，对女主霸道又宠溺', keywords: ['总裁', '霸道', 'CEO', '豪门', '霸道总裁'], baseConfidence: 0.85, genreWeight: 2.0 },
    { id: 'xiandai_002', name: '契约婚姻', category: 'structure', description: '男女主因某种原因签订契约结婚，假戏真做', keywords: ['契约', '协议', '结婚', '假婚', '交易'], baseConfidence: 0.8, genreWeight: 1.9 },
    { id: 'xiandai_003', name: '追妻火葬场', category: 'emotion', description: '男主前期不珍惜女主，后期后悔疯狂追妻', keywords: ['追妻', '火葬场', '后悔', '珍惜', '挽回'], baseConfidence: 0.85, genreWeight: 1.9 },
    { id: 'xiandai_004', name: '替身梗', category: 'emotion', description: '女主因为像男主的白月光而被选中，后来男主真爱女主', keywords: ['替身', '白月光', '像', '代替', '真爱'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'xiandai_005', name: '重生复仇', category: 'structure', description: '女主前世被害惨死，重生归来复仇逆袭', keywords: ['重生', '复仇', '前世', '惨死', '逆袭'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'xiandai_006', name: '先婚后爱', category: 'structure', description: '男女主先结婚后恋爱，在相处中渐生情愫', keywords: ['先婚后爱', '婚姻', '相处', '日久生情', '联姻'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'xiandai_007', name: '甜宠无虐', category: 'emotion', description: '全程高甜无虐，男主宠女主宠上天', keywords: ['甜宠', '宠妻', '无虐', '高甜', '宠溺'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'xiandai_008', name: '虐恋情深', category: 'emotion', description: '男女主之间爱得很痛苦，误会重重彼此折磨', keywords: ['虐恋', '误会', '折磨', '心痛', '情深'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'xiandai_009', name: '校园青春', category: 'genre', description: '以校园为背景的青春爱情故事', keywords: ['校园', '青春', '学生', '校服', '青涩'], baseConfidence: 0.75, genreWeight: 1.6 },
    { id: 'xiandai_010', name: '职场情缘', category: 'genre', description: '男女主在职场中相识相恋，共同成长', keywords: ['职场', '办公室', '上司', '下属', '同事'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'xiandai_011', name: '娱乐圈文', category: 'genre', description: '以娱乐圈为背景的言情故事', keywords: ['娱乐', '明星', '演员', '歌手', '综艺'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'xiandai_012', name: '破镜重圆', category: 'emotion', description: '曾经分开的情侣多年后重逢再续前缘', keywords: ['破镜重圆', '重逢', '复合', '旧情', '再遇'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'xiandai_013', name: '青梅竹马', category: 'emotion', description: '从小一起长大的男女主之间的感情', keywords: ['青梅竹马', '从小', '长大', '邻居', '玩伴'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'xiandai_014', name: '一见钟情', category: 'emotion', description: '男女主第一次见面就爱上对方', keywords: ['一见钟情', '初见', '心动', '一眼', '沦陷'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'xiandai_015', name: '日久生情', category: 'emotion', description: '在长期相处中慢慢产生感情', keywords: ['日久生情', '相处', '陪伴', '习惯', '渐渐'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'xiandai_016', name: '豪门恩怨', category: 'structure', description: '豪门家族内部的权力斗争和情感纠葛', keywords: ['豪门', '家族', '恩怨', '内斗', '争产'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'xiandai_017', name: '单亲妈妈', category: 'structure', description: '女主带着孩子独自生活，后来遇到男主', keywords: ['单亲', '妈妈', '孩子', '独自', '宝宝'], baseConfidence: 0.65, genreWeight: 1.5 },
    { id: 'xiandai_018', name: '萌宝神助攻', category: 'structure', description: '萌娃帮助父母走到一起的可爱故事', keywords: ['萌宝', '神助攻', '宝宝', '儿子', '女儿'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'xiandai_019', name: '打脸虐渣', category: 'cool_point', description: '女主狠狠打脸白莲花、绿茶女配和渣男', keywords: ['打脸', '虐渣', '白莲花', '绿茶', '渣男'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'xiandai_020', name: '女强男强', category: 'genre', description: '男女主都是强者，势均力敌的爱情', keywords: ['女强', '男强', '势均力敌', '强强联合', '双强'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'xiandai_021', name: '年龄差', category: 'emotion', description: '男女主之间有较大年龄差的爱情', keywords: ['年龄差', '大叔', '萝莉', '年上', '年下'], baseConfidence: 0.6, genreWeight: 1.3 },
    { id: 'xiandai_022', name: '误会重重', category: 'emotion', description: '因为各种误会导致的情感波折', keywords: ['误会', '解释', '错过', '误解', '澄清'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'xiandai_023', name: '双向奔赴', category: 'emotion', description: '男女主互相爱慕，共同走向对方', keywords: ['双向', '奔赴', '互相', '彼此', '相爱'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'xiandai_024', name: '暗恋成真', category: 'emotion', description: '主角暗恋对方多年，最终修成正果', keywords: ['暗恋', '单恋', '喜欢', '偷偷', '成真'], baseConfidence: 0.65, genreWeight: 1.5 },
    { id: 'xiandai_025', name: '闪婚厚爱', category: 'structure', description: '认识不久就结婚，婚后逐渐相爱', keywords: ['闪婚', '厚爱', '快速', '结婚', '婚后'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'xiandai_026', name: '细腻心理刻画', category: 'style', description: '现代言情注重人物心理活动的细腻描写', keywords: ['心理', '细腻', '内心', '感受', '情绪'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'xiandai_027', name: '都市氛围感', category: 'style', description: '营造现代都市特有的氛围和生活气息', keywords: ['都市', '氛围', '现代', '生活', '气息'], baseConfidence: 0.65, genreWeight: 1.5 }
  ],
  subGenres: [
    {
      id: 'zongcai_haomen',
      name: '总裁豪门',
      description: '男主是霸道多金的总裁，女主与豪门总裁的爱情故事',
      keywords: ['总裁', '霸道', 'CEO', '豪门', '霸道总裁', '总裁文', '豪门总裁', '总裁的', '总裁大人', '亿万总裁', '霸道总裁爱上我', '总裁爹地', '总裁老公', '总裁在上', '豪门恩怨'],
      exampleTitles: ['何以笙箫默', '霸道总裁爱上我', '总裁的替身前妻', '亿万老婆买一送一', '总裁的33日索情']
    },
    {
      id: 'xiaoyuan_qingchun',
      name: '校园青春',
      description: '以校园为背景的青春爱情故事',
      keywords: ['校园', '青春', '学生', '校服', '青涩', '大学', '高中', '校花', '校草', '学长', '学妹', '同班同学', '校园生活', '青涩爱情', '学生时代'],
      exampleTitles: ['微微一笑很倾城', '夏至未至', '致我们终将逝去的青春', '那些年我们一起追的女孩', '匆匆那年']
    },
    {
      id: 'zhichang_qingyuan',
      name: '职场情缘',
      description: '男女主在职场中相识相恋，共同成长',
      keywords: ['职场', '办公室', '上司', '下属', '同事', '工作', '职业', '职场爱情', '办公室恋情', '霸道上司', '职场精英', '职场恋爱', '同事恋', '上下级', '职场成长'],
      exampleTitles: ['杜拉拉升职记', '欢乐颂', '我的前半生', '三十而已', '下一站是幸福']
    },
    {
      id: 'yulequan',
      name: '娱乐圈文',
      description: '以娱乐圈为背景的言情故事',
      keywords: ['娱乐', '明星', '演员', '歌手', '综艺', '娱乐圈', '影帝', '影后', '天王', '天后', '经纪公司', '粉丝', '绯闻', '拍戏', '选秀'],
      exampleTitles: ['微微一笑很倾城', '你是我的荣耀', '亲爱的热爱的', '下一站是幸福', '变成你的那一天']
    },
    {
      id: 'pojing_chongyuan',
      name: '破镜重圆',
      description: '曾经分开的情侣多年后重逢再续前缘',
      keywords: ['破镜重圆', '重逢', '复合', '旧情', '再遇', '旧爱', '前任', '前男友', '前女友', '再续前缘', '久别重逢', '重新开始', '和好如初', '旧情人', '失而复得'],
      exampleTitles: ['何以笙箫默', '千山暮雪', '佳期如梦', '来不及说我爱你', '最美的时光']
    },
    {
      id: 'nüqiang_nanqiang',
      name: '女强男强',
      description: '男女主都是强者，势均力敌的爱情',
      keywords: ['女强', '男强', '势均力敌', '强强联合', '双强', '女强人', '霸道女总裁', '女强文', '双强文', '男女主都强', '强强', '强者', '双A', '大女主', '男主也强'],
      exampleTitles: ['你是我的荣耀', '亲爱的热爱的', '微微一笑很倾城', '杉杉来吃', '太阳的后裔']
    },
    {
      id: 'mengbao_shenzhugong',
      name: '萌宝神助攻',
      description: '萌娃帮助父母走到一起的可爱故事',
      keywords: ['萌宝', '神助攻', '宝宝', '儿子', '女儿', '萌娃', '天才宝宝', '萌宝来袭', '总裁爹地', '妈咪快跑', '爹地追来了', '萌宝驾到', '宝宝神助攻', '萌宝总裁爹地', '带球跑'],
      exampleTitles: ['总裁的替身前妻', '亿万老婆买一送一', '天才儿子腹黑娘亲', '萌宝来袭：总裁爹地太难缠', '妈咪快跑：爹地追来了']
    },
    {
      id: 'tiansheng',
      name: '甜宠无虐',
      description: '全程高甜无虐，男主宠女主宠上天',
      keywords: ['甜宠', '宠妻', '无虐', '高甜', '宠溺', '宠文', '甜文', '撒糖', '甜蜜', '宠妻狂魔', '超甜', '甜到齁', '甜宠文', '全程甜', '小甜文'],
      exampleTitles: ['微微一笑很倾城', '杉杉来吃', '你是我的荣耀', '亲爱的热爱的', '下一站是幸福']
    },
    {
      id: 'nüelian',
      name: '虐恋情深',
      description: '男女主之间爱得很痛苦，误会重重彼此折磨',
      keywords: ['虐恋', '误会', '折磨', '心痛', '情深', '虐文', '虐心', '玻璃渣', '虐恋情深', '相爱相杀', '爱恨交织', '虐到哭', '狗血虐恋', '强制爱', '追妻火葬场'],
      exampleTitles: ['千山暮雪', '佳期如梦', '来不及说我爱你', '夏有乔木雅望天堂', '悲伤逆流成河']
    }
  ],
  weights: { character: 0.35, foreshadow: 0.1, technique: 0.15, style: 0.15, rhythm: 0.1, structure: 0.15 }
};

const LISHI_JUNSHI: GenreConfig = {
  id: 'lishi_junshi',
  name: '历史军事',
  category: 'male',
  description: '以历史时期或战争为背景的男频小说，包含架空历史、历史穿越、军事战争、谍战等子类，侧重权谋和战争',
  personalityTags: [
    '杀伐果断', '腹黑', '隐忍', '雄才大略', '刚正不阿', '重情重义', '冷酷无情', '沉稳内敛',
    '狡黠机智', '野心勃勃', '忠肝义胆', '奸诈狡猾', '仁义道德', '残暴嗜杀', '爱民如子',
    '睚眦必报', '知人善任', '从谏如流', '刚愎自用', '智勇双全', '有勇无谋', '深思熟虑',
    '冲动鲁莽', '谨小慎微', '放荡不羁', '忧国忧民', '精忠报国', '通敌叛国', '忍辱负重',
    '老谋深算', '少年老成', '血气方刚', '暮气沉沉', '外圆内方', '宁折不弯'
  ],
  abilityTypes: [
    '兵法', '谋略', '武功', '箭术', '马术', '剑术', '枪法', '刀法', '暗器', '轻功',
    '政治手腕', '治国理政', '外交辞令', '识人用人', '理财', '工程营造', '医术',
    '工匠技艺', '发明创造', '穿越记忆', '预知历史', '系统', '召唤', '推演',
    '观天象', '识地理', '风水', '相术', '占卜', '火攻', '水战', '骑射',
    '守城', '攻城', '侦察', '谍报', '暗杀', '审讯', '练兵'
  ],
  roleTypes: [
    '男主角', '女主角', '谋士', '武将', '文臣', '皇帝', '太子', '皇子', '王爷',
    '丞相', '将军', '校尉', '士兵', '太监', '外戚', '宦官', '世家大族',
    '寒门士子', '书生', '商人', '农民', '起义军', '敌国君主', '敌国大将',
    '游牧民族首领', '江湖侠客', '隐士高人', '御医', '钦天监', '工匠', '船夫'
  ],
  backgroundTypes: [
    '皇宫大内', '朝堂之上', '军营大帐', '边关要塞', '州府县衙', '世家府邸',
    '书院学堂', '酒楼茶馆', '街道市集', '乡村田野', '战场沙场', '长城关口',
    '黄河长江', '草原大漠', '江南水乡', '巴蜀蜀道', '中原大地', '江南水乡',
    '行宫别院', '皇家陵园', '太庙宗社', '驿站驿馆', '渡口码头', '山寨贼窝'
  ],
  techniques: [
    { id: 'lishi_001', name: '架空历史', category: 'genre', description: '在一个虚构的历史朝代中展开故事', keywords: ['架空', '历史', '朝代', '虚构', '大雍'], baseConfidence: 0.8, genreWeight: 2.0 },
    { id: 'lishi_002', name: '穿越争霸', category: 'structure', description: '主角穿越到古代，凭借现代知识争霸天下', keywords: ['穿越', '争霸', '天下', '现代', '知识'], baseConfidence: 0.8, genreWeight: 1.9 },
    { id: 'lishi_003', name: '三国争霸', category: 'genre', description: '以三国时期为背景的历史故事', keywords: ['三国', '曹操', '刘备', '孙权', '诸葛亮'], baseConfidence: 0.75, genreWeight: 1.8 },
    { id: 'lishi_004', name: '隋唐风云', category: 'genre', description: '以隋唐时期为背景的历史故事', keywords: ['隋唐', '李世民', '杨广', '瓦岗寨', '十八路反王'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'lishi_005', name: '明末风云', category: 'genre', description: '以明朝末年为背景，内忧外患中力挽狂澜', keywords: ['明末', '崇祯', '李自成', '满清', '大明'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'lishi_006', name: '抗战烽火', category: 'genre', description: '以抗日战争为背景的军事故事', keywords: ['抗战', '抗日', '八路军', '日军', '鬼子'], baseConfidence: 0.7, genreWeight: 1.7 },
    { id: 'lishi_007', name: '谍战特工', category: 'genre', description: '以间谍情报战为核心的故事', keywords: ['谍战', '特工', '间谍', '情报', '卧底'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'lishi_008', name: '权谋夺嫡', category: 'structure', description: '皇子之间争夺皇位继承权的权谋斗争', keywords: ['夺嫡', '皇位', '皇子', '权谋', '太子'], baseConfidence: 0.8, genreWeight: 1.9 },
    { id: 'lishi_009', name: '开疆拓土', category: 'structure', description: '主角带领国家或势力扩张领土', keywords: ['开疆', '拓土', '扩张', '领土', '版图'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'lishi_010', name: '改革变法', category: 'structure', description: '主角在古代推行改革变法，富国强兵', keywords: ['改革', '变法', '新政', '富强', '革新'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'lishi_011', name: '练兵强军', category: 'structure', description: '主角训练新式军队，打造强军', keywords: ['练兵', '强军', '军队', '训练', '精锐'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'lishi_012', name: '以少胜多', category: 'cool_point', description: '主角以劣势兵力击败优势敌人', keywords: ['以少胜多', '以弱胜强', '劣势', '大胜', '奇迹'], baseConfidence: 0.75, genreWeight: 1.8 },
    { id: 'lishi_013', name: '空城计', category: 'structure', description: '使用虚虚实实的计谋迷惑敌人', keywords: ['空城计', '计谋', '虚虚实实', '迷惑', '诱敌'], baseConfidence: 0.6, genreWeight: 1.3 },
    { id: 'lishi_014', name: '反间计', category: 'structure', description: '利用间谍使敌人内部产生矛盾', keywords: ['反间计', '离间', '挑拨', '内讧', '猜疑'], baseConfidence: 0.6, genreWeight: 1.3 },
    { id: 'lishi_015', name: '围魏救赵', category: 'structure', description: '通过攻击敌人后方来解救友军', keywords: ['围魏救赵', '围攻', '救援', '后方', '计策'], baseConfidence: 0.6, genreWeight: 1.3 },
    { id: 'lishi_016', name: '寒门崛起', category: 'cool_point', description: '主角出身寒门，凭借才能一步步高升', keywords: ['寒门', '崛起', '科举', '晋升', '出身'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'lishi_017', name: '科举入仕', category: 'structure', description: '通过科举考试进入官场', keywords: ['科举', '入仕', '考试', '状元', '进士'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'lishi_018', name: '官场沉浮', category: 'structure', description: '在官场中起起落落，步步为营', keywords: ['官场', '沉浮', '升迁', '贬谪', '为官'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'lishi_019', name: '党争不断', category: 'structure', description: '朝廷中不同派系之间的政治斗争', keywords: ['党争', '派系', '朋党', '斗争', '政治'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'lishi_020', name: '农民起义', category: 'structure', description: '主角率领农民起义军反抗暴政', keywords: ['起义', '农民', '造反', '推翻', '暴政'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'lishi_021', name: '和亲外交', category: 'emotion', description: '通过联姻等外交手段解决争端', keywords: ['和亲', '联姻', '外交', '结盟', '公主'], baseConfidence: 0.55, genreWeight: 1.2 },
    { id: 'lishi_022', name: '忠奸之辨', category: 'emotion', description: '忠臣与奸臣的较量，正邪之争', keywords: ['忠臣', '奸臣', '忠奸', '正邪', '陷害'], baseConfidence: 0.6, genreWeight: 1.3 },
    { id: 'lishi_023', name: '国仇家恨', category: 'emotion', description: '国家灭亡或家族被灭的深仇大恨', keywords: ['国仇', '家恨', '亡国', '灭门', '复仇'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'lishi_024', name: '历史厚重感', category: 'style', description: '营造历史的厚重感和时代氛围', keywords: ['厚重', '历史', '时代', '氛围', '沧桑'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'lishi_025', name: '战争场面描写', category: 'style', description: '宏大的战争场面和激烈的战斗描写', keywords: ['战争', '场面', '宏大', '战斗', '厮杀'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'lishi_026', name: '权谋智斗', category: 'rhythm', description: '通过智谋的较量推动剧情发展', keywords: ['权谋', '智斗', '谋略', '计策', '博弈'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'lishi_027', name: '格局宏大', category: 'structure', description: '故事格局宏大，涉及天下大势', keywords: ['格局', '宏大', '天下', '大势', '格局开阔'], baseConfidence: 0.75, genreWeight: 1.7 }
  ],
  subGenres: [
    {
      id: 'jiakong_lishi',
      name: '架空历史',
      description: '在一个虚构的历史朝代中展开故事',
      keywords: ['架空', '历史', '朝代', '虚构', '大雍', '大楚', '大靖', '大梁', '大燕', '架空历史', '架空文', '历史架空', '架空王朝', '虚构朝代', '穿越架空'],
      exampleTitles: ['庆余年', '赘婿', '将夜', '择天记', '扶摇皇后']
    },
    {
      id: 'chuanyue_zhengba',
      name: '穿越争霸',
      description: '主角穿越到古代，凭借现代知识争霸天下',
      keywords: ['穿越', '争霸', '天下', '现代', '知识', '穿越到', '穿越之', '穿越成', '争霸天下', '逐鹿天下', '争霸文', '穿越古代', '历史穿越', '穿越争霸', '一统天下'],
      exampleTitles: ['极品家丁', '回到明朝当王爷', '锦衣夜行', '步步生莲', '宋医']
    },
    {
      id: 'sanguo',
      name: '三国争霸',
      description: '以三国时期为背景的历史故事',
      keywords: ['三国', '曹操', '刘备', '孙权', '诸葛亮', '关羽', '张飞', '赵云', '周瑜', '司马懿', '吕布', '貂蝉', '三国争霸', '三国文', '三国志', '三国演义'],
      exampleTitles: ['三国演义', '三国志', '大秦帝国', '三国之蜀汉中兴', '重生之定三国']
    },
    {
      id: 'kangzhan',
      name: '抗战烽火',
      description: '以抗日战争为背景的军事故事',
      keywords: ['抗战', '抗日', '八路军', '日军', '鬼子', '抗日战争', '抗战文', '抗日文', '八路军', '新四军', '游击队', '鬼子进村', '抗战烽火', '抗日奇侠', '特战兵王'],
      exampleTitles: ['亮剑', '雪豹', '我的团长我的团', '长沙保卫战', '中国远征军']
    },
    {
      id: 'diezhan',
      name: '谍战特工',
      description: '以间谍情报战为核心的故事',
      keywords: ['谍战', '特工', '间谍', '情报', '卧底', '地下党', '军统', '中统', '特务', '卧底', '谍战文', '特工文', '间谍战', '情报战', '潜伏'],
      exampleTitles: ['潜伏', '伪装者', '悬崖', '风筝', '暗算']
    },
    {
      id: 'quanmou_duodi',
      name: '权谋夺嫡',
      description: '皇子之间争夺皇位继承权的权谋斗争',
      keywords: ['夺嫡', '皇位', '皇子', '权谋', '太子', '王爷', '皇帝', '皇子争位', '九子夺嫡', '夺位', '储位之争', '东宫', '太子之位', '谋朝篡位', '朝堂斗争'],
      exampleTitles: ['琅琊榜', '庆余年', '鹤唳华亭', '东宫', '甄嬛传']
    },
    {
      id: 'hanmen_jueqi',
      name: '寒门崛起',
      description: '主角出身寒门，凭借才能一步步高升',
      keywords: ['寒门', '崛起', '科举', '晋升', '出身', '寒门子弟', '穷书生', '书生', '状元', '进士', '科举入仕', '寒门贵子', '布衣卿相', '白衣卿相', '科举考试'],
      exampleTitles: ['寒门崛起', '上品寒士', '雅骚', '回到明朝当王爷', '新宋']
    },
    {
      id: 'kaiziang_tuotu',
      name: '开疆拓土',
      description: '主角带领国家或势力扩张领土',
      keywords: ['开疆', '拓土', '扩张', '领土', '版图', '开疆拓土', '征战四方', '横扫天下', '一统天下', '帝国', '远征', '开疆辟土', '疆域', '国土', '称霸'],
      exampleTitles: ['大秦帝国', '汉武大帝', '康熙王朝', '乾隆王朝', '贞观长歌']
    },
    {
      id: 'mingsui_mowan',
      name: '明末风云',
      description: '以明朝末年为背景，内忧外患中力挽狂澜',
      keywords: ['明末', '崇祯', '李自成', '满清', '大明', '明朝', '明末风云', '明末文', '崇祯帝', '闯王', '张献忠', '袁崇焕', '明朝末年', '南明', '抗清'],
      exampleTitles: ['明朝那些事儿', '窃明', '明末边军一小兵', '晚明', '新明史']
    }
  ],
  weights: { character: 0.2, foreshadow: 0.2, technique: 0.2, style: 0.1, rhythm: 0.15, structure: 0.15 }
};

const KEHUAN_MOSHI: GenreConfig = {
  id: 'kehuan_moshi',
  name: '科幻末世',
  category: 'neutral',
  description: '以科幻或末世为背景的小说，包含星际科幻、末世危机、进化变异、机甲等子类，侧重设定和生存',
  personalityTags: [
    '杀伐果断', '冷酷无情', '隐忍', '腹黑', '坚韧不拔', '谨慎多疑', '重情重义', '自私自利',
    '疯狂偏执', '冷静理智', '热血冲动', '沉稳内敛', '狡黠机智', '亦正亦邪', '野心勃勃',
    '淡泊名利', '争强好胜', '护短', '贱兮兮', '装逼犯', '老银币', '外冷内热', '毒舌',
    '闷骚', '疯批', '圣母', '理智派', '感性派', '理想主义', '现实主义', '悲观主义',
    '乐观主义', '舍己为人', '损人利己', '大智若愚', '刚愎自用', '从善如流'
  ],
  abilityTypes: [
    '异能', '进化', '变异', '精神力', '念动力', '火系', '冰系', '雷系', '风系', '土系',
    '空间系', '时间系', '治愈系', '召唤系', '暗影系', '光明系', '机甲操控', '基因改造',
    '机械师', '黑客', '人工智能', '星际航行', '虫洞跳跃', '曲率驱动', '能量武器',
    '修仙', '功法', '系统', '重生', '穿越', '预知', '读心', '透视', '隐身',
    '飞行', '巨力', '速度', '再生', '变形', '分身', '御兽', '炼体'
  ],
  roleTypes: [
    '男主角', '女主角', '男配', '女配', '反派BOSS', '末世强者', '异能者', '进化者',
    '变异人', '丧尸', '机甲战士', '星际战士', '科学家', '研究员', '医生',
    '军队长官', '士兵', '幸存者', '赏金猎人', '星际海盗', '外星人', '人工智能',
    '机器人', '生化人', '克隆人', '商人', '统治者', '反抗军', '教会', '猎人'
  ],
  backgroundTypes: [
    '废土世界', '末世城市', '丧尸围城', '避难所', '地下基地', '星际战舰',
    '外太空', '外星殖民地', '火星基地', '月球基地', '虚拟世界', '赛博朋克都市',
    '机甲战场', '虫族巢穴', '变异森林', '辐射区', '安全区', '废墟城市',
    '空间站', '虫洞', '黑洞', '星际港口', '科研基地', '军事要塞', '生化实验室'
  ],
  techniques: [
    { id: 'kehuan_001', name: '末世求生', category: 'genre', description: '末世来临，主角在废墟中挣扎求生', keywords: ['末世', '求生', '废墟', '丧尸', '末日'], baseConfidence: 0.85, genreWeight: 2.0 },
    { id: 'kehuan_002', name: '异能觉醒', category: 'cool_point', description: '末世来临，主角觉醒强大异能', keywords: ['异能', '觉醒', '能力', '进化', '变异'], baseConfidence: 0.8, genreWeight: 1.9 },
    { id: 'kehuan_003', name: '星际科幻', category: 'genre', description: '以浩瀚宇宙为舞台的星际冒险故事', keywords: ['星际', '宇宙', '太空', '星球', '星系'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'kehuan_004', name: '机甲风暴', category: 'genre', description: '驾驶机甲进行战斗的热血故事', keywords: ['机甲', '机器人', '操控', '战士', '高达'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'kehuan_005', name: '进化变异', category: 'cool_point', description: '生物因辐射或病毒产生进化变异', keywords: ['进化', '变异', '基因突变', '辐射', '病毒'], baseConfidence: 0.75, genreWeight: 1.8 },
    { id: 'kehuan_006', name: '丧尸围城', category: 'structure', description: '丧尸潮爆发，人类被困在幸存者基地', keywords: ['丧尸', '围城', '尸潮', '感染者', '活死人'], baseConfidence: 0.8, genreWeight: 1.9 },
    { id: 'kehuan_007', name: '基地建设', category: 'structure', description: '主角建立并发展自己的幸存者基地', keywords: ['基地', '建设', '发展', '势力', '据点'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'kehuan_008', name: '系统金手指', category: 'cool_point', description: '主角获得末世系统或游戏系统', keywords: ['系统', '金手指', '任务', '奖励', '面板'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'kehuan_009', name: '空间异能', category: 'cool_point', description: '主角拥有空间异能，可以储存物资', keywords: ['空间', '储物', '物资', '储存', '异能'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'kehuan_010', name: '重生末世', category: 'structure', description: '主角重生回到末世前，提前准备', keywords: ['重生', '末世前', '提前', '准备', '先知'], baseConfidence: 0.8, genreWeight: 1.9 },
    { id: 'kehuan_011', name: '囤货流', category: 'genre', description: '末世前疯狂囤货，末世后物资充足', keywords: ['囤货', '物资', '储备', '买买买', '仓库'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'kehuan_012', name: '虫族入侵', category: 'structure', description: '外星虫族入侵，人类面临灭绝危机', keywords: ['虫族', '入侵', '外星', '怪物', '虫潮'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'kehuan_013', name: '赛博朋克', category: 'genre', description: '高科技低生活的未来都市风格', keywords: ['赛博朋克', '义体', '黑客', '霓虹', '未来都市'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'kehuan_014', name: '虚拟世界', category: 'genre', description: '主角进入虚拟游戏世界或网络空间', keywords: ['虚拟', '游戏', '网络', '数字', 'VR'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'kehuan_015', name: '人工智能', category: 'structure', description: '人工智能觉醒，与人类产生冲突或合作', keywords: ['AI', '人工智能', '觉醒', '机器人', '程序'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'kehuan_016', name: '基因锁', category: 'cool_point', description: '解锁基因锁获得强大力量', keywords: ['基因锁', '解锁', '基因', '潜能', '血脉'], baseConfidence: 0.65, genreWeight: 1.5 },
    { id: 'kehuan_017', name: '末日种田', category: 'genre', description: '末世中发展农业和生产，重建文明', keywords: ['种田', '农业', '生产', '重建', '文明'], baseConfidence: 0.6, genreWeight: 1.3 },
    { id: 'kehuan_018', name: '废土拾荒', category: 'structure', description: '在废土世界中拾荒和探险', keywords: ['废土', '拾荒', '探索', '废墟', '遗迹'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'kehuan_019', name: '强者之路', category: 'structure', description: '主角从弱者一步步成为末世最强者', keywords: ['强者', '成长', '变强', '巅峰', '最强'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'kehuan_020', name: '末世挣扎', category: 'emotion', description: '展现末世中人性的善恶挣扎', keywords: ['挣扎', '人性', '善恶', '生存', '道德'], baseConfidence: 0.65, genreWeight: 1.5 },
    { id: 'kehuan_021', name: '希望与绝望', category: 'emotion', description: '在绝望的末世中寻找希望', keywords: ['希望', '绝望', '光明', '黑暗', '未来'], baseConfidence: 0.65, genreWeight: 1.5 },
    { id: 'kehuan_022', name: '科技树攀升', category: 'structure', description: '逐步发展科技，提升文明等级', keywords: ['科技树', '发展', '科研', '技术', '攀升'], baseConfidence: 0.65, genreWeight: 1.5 },
    { id: 'kehuan_023', name: '宇宙探索', category: 'structure', description: '探索未知宇宙，发现新世界', keywords: ['探索', '宇宙', '未知', '新世界', '发现'], baseConfidence: 0.6, genreWeight: 1.3 },
    { id: 'kehuan_024', name: '宏大设定', category: 'style', description: '科幻末世需要宏大的世界观设定', keywords: ['设定', '宏大', '世界观', '背景', '体系'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'kehuan_025', name: '紧张刺激节奏', category: 'rhythm', description: '末世科幻节奏紧张，危机四伏', keywords: ['紧张', '刺激', '危机', '节奏', '压迫感'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'kehuan_026', name: '生存压力', category: 'emotion', description: '时刻面临生存压力，营造紧迫感', keywords: ['生存', '压力', '紧迫', '危机', '死亡'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'kehuan_027', name: '视觉冲击力', category: 'style', description: '科幻场景要有强烈的视觉冲击力', keywords: ['视觉', '冲击', '画面感', '震撼', '宏大'], baseConfidence: 0.7, genreWeight: 1.6 }
  ],
  subGenres: [
    {
      id: 'moshi_zhanshi',
      name: '末世丧尸',
      description: '末世来临，丧尸爆发，主角在废墟中挣扎求生',
      keywords: ['末世', '丧尸', '末日', '僵尸', '丧尸围城', '尸潮', '感染者', '活死人', '末世文', '丧尸文', '末日求生', '丧尸爆发', '病毒爆发', '末世危机', '丧尸病毒'],
      exampleTitles: ['全球进化', '末日蟑螂', '重启家园', '末世之恐怖风暴', '末日剧场']
    },
    {
      id: 'yineng_jinhua',
      name: '异能进化',
      description: '末世来临，人类觉醒异能或基因进化',
      keywords: ['异能', '觉醒', '进化', '变异', '能力', '异能者', '进化者', '变异人', '超能力', '精神力', '念动力', '火系', '冰系', '雷系', '基因进化'],
      exampleTitles: ['全球高武', '大王饶命', '超级神基因', '末日乐园', '全球进化']
    },
    {
      id: 'xingji_kehuan',
      name: '星际科幻',
      description: '以浩瀚宇宙为舞台的星际冒险故事',
      keywords: ['星际', '宇宙', '太空', '星球', '星系', '宇宙飞船', '星际航行', '外星', '殖民地', '星际战争', '太空歌剧', '星舰', '星际争霸', '银河帝国', '星球大战'],
      exampleTitles: ['三体', '流浪地球', '银河帝国', '沙丘', '星际穿越']
    },
    {
      id: 'jijia',
      name: '机甲风暴',
      description: '驾驶机甲进行战斗的热血故事',
      keywords: ['机甲', '机器人', '操控', '战士', '高达', '机甲战士', '人形兵器', '机甲战斗', '机甲文', '机动战士', '驾驶机甲', '机甲舰队', '机甲时代', '机甲王朝', '机甲战神'],
      exampleTitles: ['机动战士高达', '环太平洋', '机甲大师', '冒牌大英雄', '间客']
    },
    {
      id: 'jidi_jianshe',
      name: '基地建设',
      description: '主角建立并发展自己的幸存者基地或势力',
      keywords: ['基地', '建设', '发展', '势力', '据点', '幸存者基地', '基地建设', '发展势力', '建立基地', '基地文', '势力发展', '末世基地', '重建文明', '领地建设', '开疆拓土'],
      exampleTitles: ['重启家园', '末世之恐怖风暴', '末日蟑螂', '全球进化', '末世之王']
    },
    {
      id: 'chongsheng_moshi',
      name: '重生末世',
      description: '主角重生回到末世前，提前准备囤货',
      keywords: ['重生', '末世前', '提前', '准备', '先知', '重生末世', '末世重生', '回到末世前', '重生在末世', '带着记忆', '重生回来', '预知', '先知先觉', '囤货', '重生文'],
      exampleTitles: ['末世之恐怖风暴', '末日乐园', '末世重生', '重生末世之强女', '末世之我的基地']
    },
    {
      id: 'saibopengke',
      name: '赛博朋克',
      description: '高科技低生活的未来都市风格',
      keywords: ['赛博朋克', '义体', '黑客', '霓虹', '未来都市', '高科技', '低生活', '赛博', '义体改造', '网络', '虚拟世界', '大企业', '霓虹灯光', '雨夜', '机械义体'],
      exampleTitles: ['神经漫游者', '银翼杀手', '赛博朋克2077', '阿丽塔战斗天使', '攻壳机动队']
    },
    {
      id: 'xuni_shijie',
      name: '虚拟世界',
      description: '主角进入虚拟游戏世界或网络空间',
      keywords: ['虚拟', '游戏', '网络', '数字', 'VR', '虚拟世界', '游戏世界', '虚拟现实', '虚拟真实', '全息游戏', '网络游戏', '虚拟游戏', '虚拟空间', '数字世界', '虚拟游戏世界'],
      exampleTitles: ['刀剑神域', '全职高手', '惊悚乐园', '超神机械师', '我有一座恐怖屋']
    },
    {
      id: 'zhongzu_ruqin',
      name: '虫族入侵',
      description: '外星虫族或怪物入侵，人类面临灭绝危机',
      keywords: ['虫族', '入侵', '外星', '怪物', '虫潮', '虫族入侵', '外星生物', '外星入侵', '怪物潮', '怪兽', '变异生物', '星际虫族', '虫族战争', '抵抗入侵', '虫族女王'],
      exampleTitles: ['星际争霸', '星河战队', '环太平洋', '安德的游戏', '第九区']
    }
  ],
  weights: { character: 0.2, foreshadow: 0.15, technique: 0.2, style: 0.15, rhythm: 0.2, structure: 0.1 }
};

const XUANYI_TUILI: GenreConfig = {
  id: 'xuanyi_tuili',
  name: '悬疑推理',
  category: 'neutral',
  description: '以悬疑案件或推理破案为核心的小说，包含侦探推理、恐怖惊悚、诡秘悬疑等子类，侧重悬念和逻辑',
  personalityTags: [
    '冷静理智', '缜密细致', '腹黑', '白切黑', '病娇', '隐忍', '坚韧不拔', '刚正不阿',
    '重情重义', '冷酷无情', '亦正亦邪', '随性洒脱', '野心勃勃', '争强好胜', '护短',
    '老银币', '外冷内热', '毒舌', '闷骚', '疯批', '圣母', '偏执狂', '强迫症',
    '社恐', '话痨', '傲娇', '胆小怕事', '胆大心细', '观察敏锐', '直觉超强',
    '逻辑怪', '记忆力超群', '反社会', '多重人格', '精神分裂', '阴郁深沉'
  ],
  abilityTypes: [
    '推理能力', '观察力', '记忆力', '逻辑思维', '直觉', '心理学', '犯罪心理',
    '法医', '毒理', '弹道', '痕迹检验', '审讯', '侧写', '黑客技术', '格斗术',
    '枪械', '追踪', '反侦察', '易容', '催眠', '读心', '预知', '通灵',
    '阴阳眼', '道术', '符箓', '阵法', '咒术', '蛊毒', '招魂', '驱邪',
    '风水', '相术', '占卜', '塔罗牌', '灵媒', '鬼差', '无常'
  ],
  roleTypes: [
    '男主角', '女主角', '侦探', '警察', '刑警', '法医', '检察官', '律师',
    '嫌疑人', '凶手', '受害者', '目击者', '证人', '反派BOSS', '连环杀手',
    '犯罪集团头目', '黑帮老大', '间谍', '特工', '私家侦探', '记者', '作家',
    '医生', '心理医生', '教授', '学生', '家族成员', '管家', '佣人', '邻居',
    '同事', '朋友', '情人', '鬼魂', '怨灵', '僵尸', '妖怪', '道士', '和尚'
  ],
  backgroundTypes: [
    '案发现场', '警察局', '法医室', '法院', '监狱', '废弃建筑', '密室',
    '孤岛', '山庄', '古堡', '学校', '医院', '精神病院', '殡仪馆', '墓地',
    '古宅', '村庄', '小镇', '大城市', '地铁', '电梯', '走廊', '地下室',
    '阁楼', '书房', '仓库', '火车', '轮船', '飞机', '图书馆', '博物馆'
  ],
  techniques: [
    { id: 'xuanyi_001', name: '密室杀人', category: 'structure', description: '发生在封闭空间内的不可能犯罪', keywords: ['密室', '不可能犯罪', '封闭空间', '锁', '机关'], baseConfidence: 0.8, genreWeight: 2.0 },
    { id: 'xuanyi_002', name: '不在场证明', category: 'structure', description: '嫌疑人拥有看似完美的不在场证明', keywords: ['不在场证明', 'alibi', '时间', '证人', '伪造'], baseConfidence: 0.75, genreWeight: 1.8 },
    { id: 'xuanyi_003', name: '连环杀人', category: 'structure', description: '连环杀手犯下的系列杀人案', keywords: ['连环', '杀人狂', '系列案件', '模仿犯罪', '签名'], baseConfidence: 0.75, genreWeight: 1.8 },
    { id: 'xuanyi_004', name: '暴风雪山庄', category: 'structure', description: '一群人被困在封闭空间内接连发生命案', keywords: ['暴风雪山庄', '孤岛', '封闭', '连续死亡', '被困'], baseConfidence: 0.8, genreWeight: 1.9 },
    { id: 'xuanyi_005', name: '叙述性诡计', category: 'structure', description: '利用叙述技巧误导读者', keywords: ['叙述性诡计', '误导', '文字游戏', '视角', '诡计'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'xuanyi_006', name: '反转再反转', category: 'cool_point', description: '剧情多次反转，真凶出人意料', keywords: ['反转', '逆转', '出人意料', '真凶', '颠覆'], baseConfidence: 0.8, genreWeight: 1.9 },
    { id: 'xuanyi_007', name: '逻辑推理', category: 'structure', description: '通过逻辑推理找出真凶', keywords: ['推理', '逻辑', '演绎', '归纳', '证据'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'xuanyi_008', name: '心理侧写', category: 'structure', description: '通过犯罪行为分析凶手心理特征', keywords: ['侧写', '心理画像', '犯罪心理', '行为分析', 'profile'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'xuanyi_009', name: '死亡讯息', category: 'structure', description: '死者临死前留下的指向凶手的线索', keywords: ['死亡讯息', 'dying message', '死前留言', '线索', '暗号'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'xuanyi_010', name: '暗号密码', category: 'structure', description: '需要破解的暗号或密码', keywords: ['暗号', '密码', '解密', '破解', '密码机'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'xuanyi_011', name: '童谣杀人', category: 'structure', description: '按照童谣歌词顺序杀人', keywords: ['童谣', '模仿杀人', '歌词', '预言', '顺序'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'xuanyi_012', name: '消失的凶器', category: 'structure', description: '凶器消失或找不到的谜团', keywords: ['消失的凶器', '凶器', '找不到', '处理', '手法'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'xuanyi_013', name: '身份替换', category: 'structure', description: '有人冒充他人身份的诡计', keywords: ['身份替换', '冒充', '顶替', '易容', '伪装'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'xuanyi_014', name: '灵异诡秘', category: 'genre', description: '带有灵异鬼怪元素的悬疑故事', keywords: ['灵异', '诡秘', '鬼魂', '诡异', '阴森'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'xuanyi_015', name: '民俗恐怖', category: 'genre', description: '基于民间传说或地方风俗的恐怖故事', keywords: ['民俗', '恐怖', '传说', '禁忌', '仪式'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'xuanyi_016', name: '盗墓探险', category: 'genre', description: '盗墓探险类的悬疑冒险故事', keywords: ['盗墓', '探险', '古墓', '机关', '宝藏'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'xuanyi_017', name: '无限流恐怖', category: 'genre', description: '主角不断进入不同的恐怖世界求生', keywords: ['无限流', '恐怖', '副本', '世界', '任务'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'xuanyi_018', name: '悬念设置', category: 'structure', description: '巧妙设置悬念，吸引读者追更', keywords: ['悬念', '钩子', '好奇', '谜团', '未知'], baseConfidence: 0.8, genreWeight: 1.9 },
    { id: 'xuanyi_019', name: '氛围营造', category: 'style', description: '营造恐怖悬疑的氛围和环境', keywords: ['氛围', '营造', '恐怖', '压抑', '阴森'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'xuanyi_020', name: '节奏把控', category: 'rhythm', description: '张弛有度的节奏，紧张与舒缓交替', keywords: ['节奏', '张弛', '紧张', '舒缓', '把控'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'xuanyi_021', name: '人性黑暗面', category: 'emotion', description: '展现人性深处的黑暗和罪恶', keywords: ['人性', '黑暗', '罪恶', '欲望', '嫉妒'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'xuanyi_022', name: '受害者视角', category: 'structure', description: '从受害者视角描写增加代入感', keywords: ['受害者', '视角', '代入', '恐惧', '绝望'], baseConfidence: 0.6, genreWeight: 1.3 },
    { id: 'xuanyi_023', name: '开放式结局', category: 'structure', description: '结局留有余地，引发读者讨论', keywords: ['开放式', '结局', '留白', '想象', '讨论'], baseConfidence: 0.55, genreWeight: 1.2 },
    { id: 'xuanyi_024', name: '社会派推理', category: 'genre', description: '反映社会问题的推理小说', keywords: ['社会派', '社会问题', '现实', '批判', '人性'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'xuanyi_025', name: '本格推理', category: 'genre', description: '以逻辑解谜为核心的正统推理', keywords: ['本格', '解谜', '诡计', '逻辑', '公平'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'xuanyi_026', name: '细节伏笔', category: 'foreshadow', description: '在细节中埋下破案关键线索', keywords: ['细节', '伏笔', '线索', '暗示', '铺垫'], baseConfidence: 0.8, genreWeight: 1.9 },
    { id: 'xuanyi_027', name: '多重解答', category: 'structure', description: '同一案件有多种合理解答', keywords: ['多重解答', '伪解答', '逆转', '真相', '推理'], baseConfidence: 0.65, genreWeight: 1.4 }
  ],
  subGenres: [
    {
      id: 'bengge_tuili',
      name: '本格推理',
      description: '以逻辑解谜为核心的正统推理',
      keywords: ['本格', '解谜', '诡计', '逻辑', '公平', '推理', '侦探', '破案', '密室', '不在场证明', '杀人案', '凶手', '线索', '证据', '逻辑推理'],
      exampleTitles: ['福尔摩斯探案集', '名侦探柯南', '金田一少年事件簿', '嫌疑人X的献身', '白夜行']
    },
    {
      id: 'shehuipai',
      name: '社会派推理',
      description: '反映社会问题的推理小说',
      keywords: ['社会派', '社会问题', '现实', '批判', '人性', '社会', '现实问题', '社会现实', '社会批判', '人性黑暗', '社会现象', '现实主义', '社会派推理', '东野圭吾', '宫部美雪'],
      exampleTitles: ['白夜行', '嫌疑人X的献身', '解忧杂货店', '恶意', '新参者']
    },
    {
      id: 'mishi_sharen',
      name: '密室杀人',
      description: '发生在封闭空间内的不可能犯罪',
      keywords: ['密室', '不可能犯罪', '封闭空间', '锁', '机关', '密室杀人', '密室逃脱', '密室案', '不可能', '完美犯罪', '密室推理', '密室诡计', '双重密室', '密室消失', '密室谋杀'],
      exampleTitles: ['密室收藏家', '凛冬之棺', '钟塔杀人事件', '十角馆事件', '斜屋犯罪']
    },
    {
      id: 'baofeng_xueshanzhuang',
      name: '暴风雪山庄',
      description: '一群人被困在封闭空间内接连发生命案',
      keywords: ['暴风雪山庄', '孤岛', '封闭', '连续死亡', '被困', '山庄', '别墅', '孤岛杀人', '暴风雪', '与世隔绝', '连续杀人', '连环死亡', '孤岛模式', '封闭空间', '被困杀人'],
      exampleTitles: ['无人生还', '十角馆事件', '钟表馆事件', '雾越邸杀人事件', '狱门岛']
    },
    {
      id: 'lingyi_guimi',
      name: '灵异诡秘',
      description: '带有灵异鬼怪元素的悬疑故事',
      keywords: ['灵异', '诡秘', '鬼魂', '诡异', '阴森', '恐怖', '鬼怪', '幽灵', '怨灵', '邪祟', '阴森恐怖', '诡异事件', '灵异事件', '恐怖悬疑', '灵异恐怖'],
      exampleTitles: ['盗墓笔记', '鬼吹灯', '我有一座恐怖屋', '深夜书屋', '诡秘之主']
    },
    {
      id: 'daomu',
      name: '盗墓探险',
      description: '盗墓探险类的悬疑冒险故事',
      keywords: ['盗墓', '探险', '古墓', '机关', '宝藏', '盗墓笔记', '鬼吹灯', '摸金校尉', '发丘中郎将', '古墓探险', '盗墓贼', '墓穴', '陵墓', '考古', '墓葬'],
      exampleTitles: ['盗墓笔记', '鬼吹灯', '藏地密码', '沙海', '老九门']
    },
    {
      id: 'minzu_kongbu',
      name: '民俗恐怖',
      description: '基于民间传说或地方风俗的恐怖故事',
      keywords: ['民俗', '恐怖', '传说', '禁忌', '仪式', '民间传说', '民俗恐怖', '乡村恐怖', '农村恐怖', '禁忌之地', '诅咒', '邪术', '巫术', '降头', '蛊'],
      exampleTitles: ['山村老尸', '双瞳', '咒怨', '午夜凶铃', '鬼域']
    },
    {
      id: 'wuxianliu_kongbu',
      name: '无限流恐怖',
      description: '主角不断进入不同的恐怖世界求生',
      keywords: ['无限流', '恐怖', '副本', '世界', '任务', '无限恐怖', '恐怖副本', '恐怖世界', '恐怖任务', '无限流文', '恐怖片', '生存任务', '恐怖生存', '轮回乐园', '惊悚乐园'],
      exampleTitles: ['无限恐怖', '惊悚乐园', '末日乐园', '轮回乐园', '我有一座恐怖屋']
    },
    {
      id: 'xushuxing_guiji',
      name: '叙述性诡计',
      description: '利用叙述技巧误导读者',
      keywords: ['叙述性诡计', '误导', '文字游戏', '视角', '诡计', '叙述', '叙事诡计', '欺骗读者', '视角转换', '不可靠叙述', '隐藏线索', '文字陷阱', '叙述陷阱', '误导读者', '反转'],
      exampleTitles: ['罗杰疑案', '向日葵不开的夏天', '剪刀男', '杀戮之病', '咚咚吊桥坠落']
    }
  ],
  weights: { character: 0.2, foreshadow: 0.25, technique: 0.2, style: 0.15, rhythm: 0.1, structure: 0.1 }
};

const YOUXI_JINGJI: GenreConfig = {
  id: 'youxi_jingji',
  name: '游戏竞技',
  category: 'male',
  description: '以游戏或电竞为背景的男频小说，包含虚拟网游、游戏异界、电子竞技等子类，侧重游戏玩法和竞技',
  personalityTags: [
    '杀伐果断', '腹黑', '隐忍', '坚韧不拔', '争强好胜', '重情重义', '冷酷无情', '沉稳内敛',
    '狡黠机智', '亦正亦邪', '随性洒脱', '睚眦必报', '野心勃勃', '淡泊名利', '护短',
    '贱兮兮', '装逼犯', '老银币', '外冷内热', '毒舌', '闷骚', '骚话连篇', '沙雕',
    '欧皇', '非酋', '肝帝', '咸鱼', '学霸', '学渣', '技术流', '意识流',
    '手残党', '大神', '萌新', '老油条', '话痨', '社恐', '乐观开朗', '不服输'
  ],
  abilityTypes: [
    '游戏技术', '操作', '意识', '走位', '预判', '手速', '反应', '战术', '策略',
    '指挥', '游戏理解', '版本理解', '英雄池', '英雄海', '全能', '专精',
    '重生记忆', '预知', '系统', '外挂', 'BUG级能力', '隐藏职业', '生活技能',
    '锻造', '炼金', '采药', '采矿', '钓鱼', '烹饪', '裁缝', '附魔',
    '公会管理', '商业头脑', '抽奖运气', '开箱子', '强化', '合成', '副本攻略'
  ],
  roleTypes: [
    '男主角', '女主角', '男配', '女配', '反派BOSS', '游戏大神', '职业选手',
    '战队队长', '教练', '分析师', '主播', '解说', '代练', '工作室',
    '公会会长', '公会管理', '土豪玩家', '普通玩家', '萌新玩家', '老玩家',
    'NPC', 'BOSS', '小怪', '游戏公司老板', '游戏策划', '程序员', '赞助商',
    '经纪人', '粉丝', '黑粉', '裁判', '对手', '队友', '师傅', '徒弟'
  ],
  backgroundTypes: [
    '游戏世界', '虚拟世界', '游戏服务器', '新手村', '主城', '野外地图',
    '副本', '竞技场', '战场', '公会驻地', '拍卖行', '交易行', '商店',
    '职业联赛赛场', '训练基地', '战队基地', '直播平台', '网吧', '电竞馆',
    '学校宿舍', '出租屋', '豪宅', '比赛场馆', '解说台', '采访间',
    '版本更新', '新资料片', '活动地图', '节日活动', '跨服战场'
  ],
  techniques: [
    { id: 'youxi_001', name: '虚拟网游', category: 'genre', description: '主角在虚拟网络游戏中的冒险故事', keywords: ['网游', '虚拟', '游戏世界', '头盔', '虚拟真实'], baseConfidence: 0.85, genreWeight: 2.0 },
    { id: 'youxi_002', name: '游戏异界', category: 'genre', description: '主角穿越到游戏世界，或游戏降临现实', keywords: ['游戏异界', '穿越', '降临', '现实', '异世界'], baseConfidence: 0.8, genreWeight: 1.9 },
    { id: 'youxi_003', name: '电子竞技', category: 'genre', description: '职业电竞选手的成长和比赛故事', keywords: ['电竞', '职业', '比赛', '联赛', '冠军'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'youxi_004', name: '全职高手式', category: 'genre', description: '退役大神回归赛场再创辉煌的故事', keywords: ['全职高手', '退役', '回归', '大神', '荣耀'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'youxi_005', name: '隐藏职业', category: 'cool_point', description: '主角获得游戏中的隐藏职业或特殊天赋', keywords: ['隐藏职业', '特殊', '唯一', '天赋', '职业'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'youxi_006', name: '开局满资质', category: 'cool_point', description: '主角初始属性或资质爆表', keywords: ['满资质', '满属性', '开局', '天赋异禀', '先天满'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'youxi_007', name: '首杀首通', category: 'cool_point', description: '主角第一个击杀BOSS或通关副本', keywords: ['首杀', '首通', '第一个', 'FD', '世界首杀'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'youxi_008', name: '神级操作', category: 'cool_point', description: '主角展现出神级操作震惊全场', keywords: ['神操作', '操作', '手速', '走位', '预判'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'youxi_009', name: '装备碾压', category: 'cool_point', description: '主角凭借极品装备碾压对手', keywords: ['装备', '碾压', '极品', '神器', '史诗'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'youxi_010', name: '副本攻略', category: 'structure', description: '攻略各种难度的副本，获取奖励', keywords: ['副本', '攻略', 'BOSS', '通关', '掉落'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'youxi_011', name: '公会战争', category: 'structure', description: '公会之间的大规模战争', keywords: ['公会战', '帮战', '城战', '国战', '领地'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'youxi_012', name: '竞技场PK', category: 'structure', description: '竞技场或排位赛中的玩家对战', keywords: ['竞技场', 'PK', '排位', '段位', '天梯'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'youxi_013', name: '生活玩家', category: 'genre', description: '主角专注于生活技能而非战斗', keywords: ['生活玩家', '生活技能', '生产', '制造', '休闲'], baseConfidence: 0.6, genreWeight: 1.3 },
    { id: 'youxi_014', name: '商人玩家', category: 'genre', description: '主角在游戏中经商赚钱，成为游戏首富', keywords: ['商人', '倒买倒卖', '赚钱', '首富', '经济'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'youxi_015', name: '工作室', category: 'structure', description: '主角建立游戏工作室打金赚钱', keywords: ['工作室', '打金', '搬砖', '代练', '赚钱'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'youxi_016', name: '战队组建', category: 'structure', description: '主角组建自己的电竞战队', keywords: ['战队', '组建', '队友', '招募', '俱乐部'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'youxi_017', name: '比赛逆袭', category: 'cool_point', description: '在比赛中劣势翻盘，逆袭夺冠', keywords: ['逆袭', '翻盘', '夺冠', '逆转', '反败为胜'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'youxi_018', name: '骚话连篇', category: 'style', description: '主角骚话不断，搞笑轻松的风格', keywords: ['骚话', '搞笑', '吐槽', '梗', '段子'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'youxi_019', name: '技术流', category: 'genre', description: '主角靠技术而非装备取胜', keywords: ['技术流', '操作', '意识', '技巧', '不靠装备'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'youxi_020', name: '运气流', category: 'genre', description: '主角运气爆表，欧皇附体', keywords: ['运气', '欧皇', '爆率', '抽奖', '人品'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'youxi_021', name: '养成升级', category: 'structure', description: '角色或装备的成长养成体系', keywords: ['养成', '升级', '成长', '培养', '进化'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'youxi_022', name: '版本理解', category: 'cool_point', description: '主角对游戏版本有深刻理解，领先版本', keywords: ['版本理解', '版本', '前瞻', '领先', '开发'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'youxi_023', name: '热血沸腾比赛', category: 'emotion', description: '激烈的比赛场面，热血沸腾的氛围', keywords: ['热血', '比赛', '激烈', '沸腾', '燃'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'youxi_024', name: '兄弟情义', category: 'emotion', description: '游戏中结识的兄弟情义，并肩作战', keywords: ['兄弟', '情义', '并肩', '战友', '团队'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'youxi_025', name: '快节奏升级', category: 'rhythm', description: '升级速度快，爽点密集', keywords: ['快节奏', '升级快', '爽点', '密集', '高效'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'youxi_026', name: '数据化界面', category: 'style', description: '用游戏数据面板的方式展现进度', keywords: ['数据化', '面板', '属性', '等级', '界面'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'youxi_027', name: '开盲盒式抽奖', category: 'cool_point', description: '抽卡、开箱等随机性带来的爽感', keywords: ['抽奖', '开箱', '抽卡', '随机', 'SSR'], baseConfidence: 0.65, genreWeight: 1.5 }
  ],
  subGenres: [
    {
      id: 'xuni_wangyou',
      name: '虚拟网游',
      description: '主角在虚拟网络游戏中的冒险故事',
      keywords: ['网游', '虚拟', '游戏世界', '头盔', '虚拟真实', '虚拟网游', '网络游戏', '全息游戏', '游戏头盔', '虚拟现实', '网游文', '游戏小说', '虚拟世界', '网游之', '全息网游'],
      exampleTitles: ['全职高手', '微微一笑很倾城', '重生之贼行天下', '网游之纵横天下', '失落叶三部曲']
    },
    {
      id: 'youxi_yijie',
      name: '游戏异界',
      description: '主角穿越到游戏世界，或游戏降临现实',
      keywords: ['游戏异界', '穿越', '降临', '现实', '异世界', '游戏降临', '穿越到游戏', '游戏世界', '异界游戏', '带着游戏', '游戏技能', '游戏系统', '穿越游戏', '游戏化', '数据化'],
      exampleTitles: ['全职高手', '惊悚乐园', '超神机械师', '我有一座恐怖屋', '末日乐园']
    },
    {
      id: 'dianzi_jingji',
      name: '电子竞技',
      description: '职业电竞选手的成长和比赛故事',
      keywords: ['电竞', '职业', '比赛', '联赛', '冠军', '电子竞技', '电竞文', '职业选手', '电竞选手', '战队', '职业联赛', '电竞比赛', '电竞小说', '电竞大神', '英雄联盟'],
      exampleTitles: ['全职高手', 'AWM绝地求生', '你是我的荣耀', '蜜汁炖鱿鱼', '穿越火线']
    },
    {
      id: 'quanzhi_dashishen',
      name: '全职大神',
      description: '退役大神回归赛场再创辉煌的故事',
      keywords: ['全职高手', '退役', '回归', '大神', '荣耀', '大神回归', '重回赛场', '退役选手', '昔日王者', '王者归来', '重返巅峰', '退役大神', '再战江湖', '重新出发', '重返赛场'],
      exampleTitles: ['全职高手', '穿越火线', '王者荣耀之大神归来', '电竞之退役天王', '英雄联盟之谁与争锋']
    },
    {
      id: 'fuben_gonglue',
      name: '副本攻略',
      description: '攻略各种难度的副本，获取奖励',
      keywords: ['副本', '攻略', 'BOSS', '通关', '掉落', '副本攻略', '打副本', '下副本', '副本BOSS', '首杀', '首通', '刷副本', '副本记录', '通关攻略', '副本奖励'],
      exampleTitles: ['全职高手', '惊悚乐园', '超神机械师', '我有一座恐怖屋', '末日乐园']
    },
    {
      id: 'gonghui_zhanzheng',
      name: '公会战争',
      description: '公会之间的大规模战争或阵营对抗',
      keywords: ['公会战', '帮战', '城战', '国战', '领地', '公会战争', '帮派战争', '阵营战', '攻城战', '守城战', '公会', '帮派', '势力战争', '领地争夺', '公会争霸'],
      exampleTitles: ['全职高手', '网游之纵横天下', '重生之贼行天下', '失落叶三部曲', '猛龙过江']
    },
    {
      id: 'jishuliu',
      name: '技术流',
      description: '主角靠技术而非装备取胜',
      keywords: ['技术流', '操作', '意识', '技巧', '不靠装备', '技术', '手速', '走位', '预判', '操作流', '意识流', '技术玩家', '神操作', '微操', '高端操作'],
      exampleTitles: ['全职高手', '英雄联盟之谁与争锋', '穿越火线之AK传奇', 'CS之神', '魔兽技能兵种全穿越']
    },
    {
      id: 'shengcun_liupai',
      name: '生存流派',
      description: '在残酷的游戏世界中挣扎求生',
      keywords: ['生存', '求生', '挣扎', '残酷', '活命', '生存游戏', '生存挑战', '活下去', '极限生存', '绝地求生', '大逃杀', '生存类', '求生游戏', '荒野求生', '生存进化'],
      exampleTitles: ['末日乐园', '惊悚乐园', '无限恐怖', '全球进化', '饿了吗死了吗']
    },
    {
      id: 'shangren_wanjia',
      name: '商人玩家',
      description: '主角在游戏中经商赚钱，成为游戏首富',
      keywords: ['商人', '倒买倒卖', '赚钱', '首富', '经济', '游戏商人', '商人玩家', '做买卖', '做生意', '游戏经济', '赚钱攻略', '致富', '游戏里赚钱', '商业帝国', '游戏首富'],
      exampleTitles: ['网游之近战法师', '网游之盗版神话', '网游之纵横天下', '重生之贼行天下', '猛龙过江']
    }
  ],
  weights: { character: 0.2, foreshadow: 0.1, technique: 0.25, style: 0.1, rhythm: 0.25, structure: 0.1 }
};

const QIHUAN_XIFANG: GenreConfig = {
  id: 'qihuan_xifang',
  name: '奇幻西方',
  category: 'male',
  description: '以西方奇幻世界观为背景，包含魔法、骑士、龙、精灵、矮人等元素的冒险故事',
  personalityTags: [
    '勇敢无畏', '正直善良', '孤傲冷冽', '腹黑狡诈', '热血冲动', '沉稳睿智', '玩世不恭', '坚守信念',
    '亦正亦邪', '重情重义', '冷酷无情', '幽默风趣', '野心勃勃', '淡泊名利', '桀骜不驯', '温润如玉',
    '睚眦必报', '护短', '贱兮兮', '装逼犯', '老银币', '外冷内热', '毒舌', '闷骚',
    '骑士精神', '法师傲娇', '矮人豪爽', '精灵高傲', '兽人憨厚', '亡灵阴森', '恶魔邪恶', '天使圣洁',
    '流浪诗人', '佣兵痞气', '贵族傲慢', '平民坚韧'
  ],
  abilityTypes: [
    '魔法', '斗气', '剑术', '弓术', '骑术', '圣力', '暗影', '元素魔法', '召唤术', '死灵魔法',
    '炼金术', '附魔', '锻造', '草药学', '炼金术', '神术', '龙语魔法', '空间魔法', '时间魔法', '精神魔法',
    '血脉天赋', '变身', '飞行', '隐身', '读心', '预知', '诅咒', '祝福', '结界', '契约',
    '龙息', '精灵箭术', '矮人锻造', '兽人狂化', '亡灵召唤', '恶魔契约', '天使降临'
  ],
  roleTypes: [
    '男主角', '女主角', '男配', '女配', '反派BOSS', '勇者', '魔王', '魔法少女', '骑士', '法师',
    '弓箭手', '盗贼', '牧师', '战士', '刺客', '召唤师', '炼金术士', '龙骑士', '精灵', '矮人',
    '兽人', '亡灵', '恶魔', '天使', '龙族', '精灵女王', '矮人国王', '兽人头领', '巫妖', '魔神',
    '佣兵会长', '冒险者', '商人', '贵族领主', '国王', '公主', '王子', '教皇', '圣骑士'
  ],
  backgroundTypes: [
    '人类王国', '精灵森林', '矮人山脉', '兽人草原', '亡灵墓地', '恶魔深渊', '天使天界', '龙族龙岛',
    '魔法学院', '骑士团', '冒险者公会', '佣兵公会', '地下城', '迷宫', '古堡', '遗迹', '神殿',
    '山谷村庄', '港口城市', '王都', '边境要塞', '战场废墟', '魔法塔', '巫师塔', '沼泽', '沙漠',
    '冰原', '火山', '天空之城', '海底世界', '魔界', '神界'
  ],
  techniques: [
    { id: 'qihuan_001', name: '勇者斗魔王', category: 'structure', description: '经典的勇者踏上旅途打败魔王拯救世界的故事框架', keywords: ['勇者', '魔王', '拯救世界', '冒险', '旅途'], baseConfidence: 0.85, genreWeight: 2.0 },
    { id: 'qihuan_002', name: '魔法学院', category: 'structure', description: '主角在魔法学院学习成长，结交伙伴与对手较量', keywords: ['魔法学院', '学院', '学习', '学生', '魔法'], baseConfidence: 0.8, genreWeight: 1.9 },
    { id: 'qihuan_003', name: '屠龙勇士', category: 'cool_point', description: '主角与巨龙战斗或签订契约，获得强大力量', keywords: ['屠龙', '龙', '巨龙', '龙骑士', '龙族'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'qihuan_004', name: '地下城冒险', category: 'structure', description: '探索地下城、迷宫、遗迹，寻找宝藏和机缘', keywords: ['地下城', '迷宫', '遗迹', '探险', '宝藏'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'qihuan_005', name: '队伍组建', category: 'structure', description: '主角组建冒险队伍，不同职业的伙伴各有所长', keywords: ['队伍', '伙伴', '组队', '冒险团', '队友'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'qihuan_006', name: '转职觉醒', category: 'cool_point', description: '主角觉醒隐藏职业或转职为稀有职业', keywords: ['转职', '觉醒', '职业', '隐藏职业', '稀有'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'qihuan_007', name: '神器入手', category: 'cool_point', description: '主角获得传说中的神器，实力大增', keywords: ['神器', '传说', '宝物', '圣剑', '魔杖'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'qihuan_008', name: '种族冲突', category: 'structure', description: '不同种族之间的战争与和平，主角在其中周旋', keywords: ['种族', '精灵', '矮人', '兽人', '人类'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'qihuan_009', name: '魔神降临', category: 'structure', description: '魔神或恶魔入侵世界，主角带领众人抵抗', keywords: ['魔神', '恶魔', '入侵', '末日', '危机'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'qihuan_010', name: '学院大比', category: 'structure', description: '学院内部的比赛或竞赛，展现实力和成长', keywords: ['学院大比', '比赛', '竞赛', '排名', '擂台'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'qihuan_011', name: '拍卖会', category: 'cool_point', description: '在拍卖会上竞拍稀有物品，或卖出天价物品', keywords: ['拍卖', '竞拍', '稀有物品', '天价', '宝物'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'qihuan_012', name: '佣兵任务', category: 'structure', description: '主角作为佣兵接取各种任务，积累经验和人脉', keywords: ['佣兵', '任务', '委托', '冒险', '报酬'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'qihuan_013', name: '龙傲天式', category: 'genre', description: '主角天赋异禀，一路开挂碾压对手', keywords: ['龙傲天', '开挂', '碾压', '天才', '无敌'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'qihuan_014', name: '废柴逆袭', category: 'cool_point', description: '主角初期被视为废物，通过努力或机缘逆袭', keywords: ['废柴', '废物', '逆袭', '天赋', '努力'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'qihuan_015', name: '穿越异世', category: 'genre', description: '主角从现代穿越到奇幻异世界', keywords: ['穿越', '异世', '异世界', '穿越到', '现代'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'qihuan_016', name: '召唤万岁', category: 'genre', description: '主角拥有召唤能力，可以召唤各种强大生物', keywords: ['召唤', '召唤兽', '魔兽', '契约', '召唤术'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'qihuan_017', name: '炼药宗师', category: 'genre', description: '主角精通炼药或炼金术，炼制神奇药剂', keywords: ['炼药', '药剂', '炼金术', '宗师', '药水'], baseConfidence: 0.65, genreWeight: 1.5 },
    { id: 'qihuan_018', name: '亡灵法师', category: 'genre', description: '主角是亡灵法师，召唤亡灵大军征战', keywords: ['亡灵', '死灵', '骷髅', '亡灵法师', '巫妖'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'qihuan_019', name: '骑士荣耀', category: 'emotion', description: '骑士精神与荣耀的坚守，守护重要之人', keywords: ['骑士', '荣耀', '守护', '骑士精神', '誓言'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'qihuan_020', name: '魔法对决', category: 'cool_point', description: '精彩的魔法对战，各种魔法碰撞令人眼花缭乱', keywords: ['魔法对决', '法术', '对轰', '魔法大战', '魔咒'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'qihuan_021', name: '史诗感营造', category: 'style', description: '营造宏大的史诗感，展现波澜壮阔的奇幻世界', keywords: ['史诗', '宏大', '壮阔', '波澜壮阔', '世界观'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'qihuan_022', name: 'D&D式', category: 'genre', description: '类似龙与地下城规则的奇幻冒险故事', keywords: ['DND', '龙与地下城', '跑团', '骰子', '规则'], baseConfidence: 0.6, genreWeight: 1.3 },
    { id: 'qihuan_023', name: '西幻种田', category: 'genre', description: '在奇幻世界种田发展，建设领地或王国', keywords: ['种田', '领地', '建设', '发展', '王国'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'qihuan_024', name: '诸神黄昏', category: 'structure', description: '众神之间的战争，世界面临毁灭危机', keywords: ['诸神', '神战', '黄昏', '众神', '毁灭'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'qihuan_025', name: '血脉觉醒', category: 'cool_point', description: '主角觉醒远古血脉，获得强大力量', keywords: ['血脉', '觉醒', '远古', '龙族血脉', '神血'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'qihuan_026', name: '世界观铺陈', category: 'structure', description: '逐步展开宏大的奇幻世界观，揭示世界真相', keywords: ['世界观', '设定', '真相', '秘密', '历史'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'qihuan_027', name: '伙伴羁绊', category: 'emotion', description: '冒险途中建立的深厚友情和伙伴羁绊', keywords: ['伙伴', '友情', '羁绊', '战友', '团队'], baseConfidence: 0.7, genreWeight: 1.5 }
  ],
  subGenres: [
    {
      id: 'mozhe_wuxia',
      name: '魔法学徒',
      description: '主角从魔法学徒开始，一步步成长为大魔法师',
      keywords: ['魔法学徒', '魔法师', '魔法学院', '学习魔法', '法师', '学徒', '魔法', '魔导', '大魔导师', '法神', '魔法学习', '咒语', '魔杖', '魔法书', '元素魔法'],
      exampleTitles: ['哈利波特', '盘龙', '恶魔法则', '魔法学徒', '湛蓝徽章']
    },
    {
      id: 'yongzhe_mowang',
      name: '勇者魔王',
      description: '勇者踏上旅途打败魔王拯救世界的经典故事',
      keywords: ['勇者', '魔王', '拯救世界', '冒险', '旅途', '勇者斗恶龙', '魔王城', '打败魔王', '勇士', '英雄', '冒险小队', '旅行', '组队冒险', '最终BOSS', '世界危机'],
      exampleTitles: ['勇者义彦', '关于我转生变成史莱姆这档事', '魔王勇者', '打工吧！魔王大人', '传说中勇者的传说']
    },
    {
      id: 'longqishi',
      name: '龙骑士',
      description: '主角与龙签订契约，成为龙骑士征战天下',
      keywords: ['龙骑士', '龙', '巨龙', '龙族', '契约', '骑龙', '龙蛋', '幼龙', '神龙', '飞龙', '龙族契约', '龙息', '龙威', '龙王', '神圣巨龙'],
      exampleTitles: ['龙骑士', '盘龙', '龙族', '斗罗大陆', '冰与火之歌']
    },
    {
      id: 'dixiacheng',
      name: '地下城冒险',
      description: '探索地下城、迷宫、遗迹，寻找宝藏和机缘',
      keywords: ['地下城', '迷宫', '遗迹', '探险', '宝藏', '地下迷宫', '古墓', '秘境', '副本', '探索', '机关', '陷阱', 'BOSS', '宝藏猎人', '冒险者'],
      exampleTitles: ['盗墓笔记', '鬼吹灯', '地下城与勇士', '刀剑神域', '记录的地平线']
    },
    {
      id: 'wangling_fashi',
      name: '亡灵法师',
      description: '主角是亡灵法师，召唤亡灵大军征战',
      keywords: ['亡灵法师', '死灵法师', '骷髅', '亡灵', '巫妖', '亡者', '死灵', '骨龙', '亡灵大军', '召唤亡灵', '死亡魔法', '尸巫', '亡灵界', '冥界', '死神'],
      exampleTitles: ['亡灵法师', '暗黑破坏神', '魔兽世界', '巫妖之路', '亡灵进化专家']
    },
    {
      id: 'xiyi_chuanyue',
      name: '西幻穿越',
      description: '从现代穿越到西方奇幻世界的冒险故事',
      keywords: ['西幻穿越', '穿越异世', '异世界', '穿越到', '现代', '穿越西方', '奇幻世界', '魔法世界', '异界', '异世大陆', '带着系统', '穿越者', '异世冒险', '西幻', '中土世界'],
      exampleTitles: ['盘龙', '恶魔法则', '神墓', '长生界', '异世邪君']
    },
    {
      id: 'zhongtian_qishi',
      name: '种田领主',
      description: '在奇幻世界建设领地发展势力的种田文',
      keywords: ['领主', '种田', '领地建设', '发展势力', '建国', '贵族', '城堡', '领土', '建设', '发展', '领地', '开疆拓土', '城邦', '王国', '领主大人'],
      exampleTitles: ['放开那个女巫', '黎明之剑', '巫师之旅', '帝国的黎明', '领主纪事']
    },
    {
      id: 'moshi_xiaoyuan',
      name: '魔法校园',
      description: '以魔法学院为主要场景的校园奇幻故事',
      keywords: ['魔法校园', '魔法学院', '校园', '学生', '学院', '魔法学校', '霍格沃茨', '校园生活', '同学', '老师', '学院大比', '魔法课程', '魔法考试', '社团', '宿舍'],
      exampleTitles: ['哈利波特', '斗破苍穹', '斗罗大陆', '盘龙', '冰火魔厨']
    },
    {
      id: 'shenzhan',
      name: '神战史诗',
      description: '众神之间的战争，宏大史诗级的奇幻故事',
      keywords: ['神战', '诸神', '众神', '史诗', '神话战争', '天神', '神王', '神格', '神火', '神国', '诸神黄昏', '封神', '神系', '神之领域', '神祇'],
      exampleTitles: ['神墓', '长生界', '盘龙', '冰火魔厨', '佣兵天下']
    }
  ],
  weights: { character: 0.2, foreshadow: 0.15, technique: 0.2, style: 0.15, rhythm: 0.15, structure: 0.15 }
};

const TIYU_JINGJI: GenreConfig = {
  id: 'tiyu_jingji',
  name: '体育竞技',
  category: 'male',
  description: '以体育运动为主题，主角通过努力和天赋在竞技场上成长夺冠的故事',
  personalityTags: [
    '热血沸腾', '不服输', '坚韧不拔', '永不放弃', '争强好胜', '自信满满', '低调内敛', '桀骜不驯',
    '沉稳冷静', '火爆脾气', '幽默风趣', '重情重义', '团队至上', '个人英雄', '努力型', '天才型',
    '腹黑', '外冷内热', '毒舌', '闷骚', '护短', '贱兮兮', '装逼犯', '老银币',
    '阳光开朗', '忧郁深沉', '痞气十足', '温润如玉', '亦正亦邪', '随性洒脱', '野心勃勃', '淡泊名利',
    '大器晚成', '少年成名', '老将迟暮', '新人崛起'
  ],
  abilityTypes: [
    '速度', '力量', '耐力', '爆发力', '弹跳力', '柔韧性', '协调性', '球感', '手感', '脚法',
    '战术意识', '大局观', '领导力', '指挥能力', '阅读比赛', '关键球', '大心脏', '抗压能力', '心理素质',
    '过人技术', '射门技术', '投篮技术', '扣篮', '三分球', '传球', '控球', '防守', '抢断', '盖帽',
    '篮板球', '发球', '接发球', '杀球', '吊球', '网前技术', '游泳速度', '跳水技术', '体操动作',
    '举重力量', '跑步耐力', '冲刺速度', '格斗技巧', '摔角技术', '赛车技术'
  ],
  roleTypes: [
    '男主角', '女主角', '男配', '女配', '反派BOSS', '教练', '队友', '对手', '队长', '王牌',
    '新人', '老将', '替补', '明星球员', '超级巨星', '球探', '经纪人', '老板', '经理', '解说员',
    '裁判', '球迷', '记者', '医生', '队医', '训练师', '营养师', '心理医生', '啦啦队', '吉祥物',
    '家属', '女朋友', '男朋友', '赞助商', '联盟主席', '俱乐部主席', '青训教练', '主教练', '助理教练'
  ],
  backgroundTypes: [
    '校园球场', '职业赛场', '国家队', '俱乐部', '训练基地', '体育馆', '体育场', '篮球场', '足球场',
    '网球场', '乒乓球馆', '羽毛球馆', '游泳馆', '跳水馆', '体操馆', '举重馆', '田径场', '赛车场',
    '擂台', '拳馆', '武道馆', '健身房', '体能训练中心', '医疗康复中心', '球员宿舍', '运动员村',
    '新闻发布会厅', '更衣室', '教练办公室', '俱乐部大楼', '球员工会', '选秀大会', '全明星周末',
    '季后赛', '总决赛', '奥运会', '世界杯', '世锦赛', '亚运会'
  ],
  techniques: [
    { id: 'tiyu_001', name: '废柴逆袭', category: 'cool_point', description: '主角初期被看不起或天赋平平，通过努力逆袭成为强者', keywords: ['废柴', '逆袭', '努力', '天才', '看不起'], baseConfidence: 0.85, genreWeight: 2.0 },
    { id: 'tiyu_002', name: '天才降临', category: 'cool_point', description: '天赋异禀的主角横空出世，横扫赛场', keywords: ['天才', '天赋', '降临', '横空出世', '奇才'], baseConfidence: 0.8, genreWeight: 1.9 },
    { id: 'tiyu_003', name: '热血比赛', category: 'emotion', description: '激烈紧张的比赛场面，让人热血沸腾', keywords: ['热血', '比赛', '激烈', '沸腾', '燃'], baseConfidence: 0.85, genreWeight: 2.0 },
    { id: 'tiyu_004', name: '绝杀时刻', category: 'cool_point', description: '最后时刻的绝杀进球，反败为胜', keywords: ['绝杀', '最后时刻', '反败为胜', '压哨', '逆转'], baseConfidence: 0.85, genreWeight: 1.9 },
    { id: 'tiyu_005', name: '训练成长', category: 'structure', description: '主角通过艰苦训练不断提升实力的过程', keywords: ['训练', '成长', '努力', '苦练', '提升'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'tiyu_006', name: '团队配合', category: 'structure', description: '球队从一盘散沙到默契配合的成长历程', keywords: ['团队', '配合', '默契', '队友', '协作'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'tiyu_007', name: '宿敌对决', category: 'structure', description: '主角与宿敌之间的多次对决，亦敌亦友', keywords: ['宿敌', '对手', '对决', '亦敌亦友', '劲敌'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'tiyu_008', name: '伤病复出', category: 'structure', description: '主角遭受重伤后顽强复出，重返巅峰', keywords: ['伤病', '复出', '受伤', '康复', '重返巅峰'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'tiyu_009', name: '教练指导', category: 'structure', description: '遇到名师指导，主角的能力得到质的飞跃', keywords: ['教练', '名师', '指导', '师父', '伯乐'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'tiyu_010', name: '全国大赛', category: 'structure', description: '从地区赛一路打到全国大赛，逐梦冠军', keywords: ['全国大赛', '冠军', '赛事', '晋级', '夺冠'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'tiyu_011', name: '转会风波', category: 'structure', description: '主角转会或被交易，在新的环境重新证明自己', keywords: ['转会', '交易', '新球队', '转会风波', '离队'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'tiyu_012', name: '板凳匪徒', category: 'cool_point', description: '从替补席打起，抓住机会一鸣惊人', keywords: ['替补', '板凳', '机会', '一鸣惊人', '轮换'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'tiyu_013', name: ' MVP封神', category: 'cool_point', description: '主角获得最有价值球员，站在联盟之巅', keywords: ['MVP', '最有价值', '封神', '最佳球员', '第一人'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'tiyu_014', name: '黑八奇迹', category: 'cool_point', description: '弱队以下克上，创造奇迹', keywords: ['黑八', '以下克上', '奇迹', '爆冷', '以弱胜强'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'tiyu_015', name: '王朝建立', category: 'structure', description: '带领球队建立王朝，连续多年夺冠', keywords: ['王朝', '建立王朝', '连冠', '三连冠', '霸业'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'tiyu_016', name: '师徒情深', category: 'emotion', description: '教练与弟子之间深厚的师徒情谊', keywords: ['师徒', '教练', '情谊', '恩师', '师徒情深'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'tiyu_017', name: '兄弟篮球', category: 'emotion', description: '队友之间深厚的兄弟情义，并肩作战', keywords: ['兄弟', '队友', '情义', '并肩', '兄弟情'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'tiyu_018', name: '校园体育', category: 'genre', description: '以校园为背景的青春体育故事', keywords: ['校园', '青春', '高中', '大学', '学生'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'tiyu_019', name: '职业竞技', category: 'genre', description: '以职业联赛为背景的体育竞技故事', keywords: ['职业', '联赛', '职业联赛', '俱乐部', '职业球员'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'tiyu_020', name: '系统流', category: 'genre', description: '主角获得体育系统，靠系统提升实力', keywords: ['系统', '金手指', '技能点', '属性', '任务'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'tiyu_021', name: '快节奏比赛', category: 'rhythm', description: '比赛节奏紧凑，攻防转换令人目不暇接', keywords: ['快节奏', '攻防', '紧凑', '高速', '对攻'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'tiyu_022', name: '专业术语', category: 'style', description: '使用专业的体育术语，增强真实感', keywords: ['专业', '术语', '战术', '技术', '真实感'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'tiyu_023', name: '心理描写', category: 'style', description: '细腻的心理描写，展现运动员的内心世界', keywords: ['心理', '内心', '压力', '心态', '心理描写'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'tiyu_024', name: '战术博弈', category: 'structure', description: '教练之间的战术博弈，用兵如神', keywords: ['战术', '博弈', '排兵布阵', '战术调整', '指挥'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'tiyu_025', name: '梦想与坚持', category: 'emotion', description: '对梦想的执着追求和永不放弃的精神', keywords: ['梦想', '坚持', '执着', '永不放弃', '追梦'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'tiyu_026', name: '小人物崛起', category: 'cool_point', description: '平凡小人物通过努力在体育界崛起', keywords: ['小人物', '崛起', '平凡', '草根', '奋斗'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'tiyu_027', name: '退役与传承', category: 'emotion', description: '老将退役与新人传承，体育精神的延续', keywords: ['退役', '传承', '老将', '新人', '精神'], baseConfidence: 0.65, genreWeight: 1.4 }
  ],
  subGenres: [
    {
      id: 'lanqiu',
      name: '篮球竞技',
      description: '以篮球运动为主题的体育竞技小说',
      keywords: ['篮球', 'NBA', 'CBA', '灌篮', '扣篮', '三分球', '篮球小说', '篮球文', '街头篮球', '高中篮球', '大学篮球', '职业篮球', '篮球运动员', '控球后卫', '中锋', '前锋'],
      exampleTitles: ['灌篮高手', '黑子的篮球', '篮球之神', '超级篮板王', '我是球王']
    },
    {
      id: 'zuqiu',
      name: '足球竞技',
      description: '以足球运动为主题的体育竞技小说',
      keywords: ['足球', '世界杯', '英超', '西甲', '德甲', '意甲', '中超', '足球小说', '足球文', '射门', '过人', '守门员', '前锋', '中场', '后卫', '教练'],
      exampleTitles: ['足球小将', '冠军教父', '我们是冠军', '球王', '重生之足球神话']
    },
    {
      id: 'xiaoyuan_tiyu',
      name: '校园体育',
      description: '以校园为背景的青春体育故事',
      keywords: ['校园体育', '青春', '高中', '大学', '学生', '校园', '全国大赛', '甲子园', '高中联赛', '大学联赛', '青春热血', '社团', '体育部', '高中篮球', '足球部'],
      exampleTitles: ['灌篮高手', '足球小将', '网球王子', '排球少年', '强风吹拂']
    },
    {
      id: 'wangqiu',
      name: '网球竞技',
      description: '以网球运动为主题的体育竞技小说',
      keywords: ['网球', '网球王子', '大满贯', '澳网', '法网', '温网', '美网', '单打', '双打', '发球', '接发球', '正手', '反手', '网前', '底线'],
      exampleTitles: ['网球王子', '网球之神', '重生之网球王者', '网坛风云', '网球少女']
    },
    {
      id: 'geji',
      name: '格斗竞技',
      description: '以格斗、拳击、摔角等为主题的竞技小说',
      keywords: ['格斗', '拳击', 'UFC', 'MMA', '摔角', '格斗小说', '拳王', '搏击', '散打', '泰拳', '柔道', '跆拳道', '空手道', '综合格斗', '地下拳赛'],
      exampleTitles: ['拳王', '格斗之王', '最强格斗', '搏击王者', '拳坛风云']
    },
    {
      id: 'saiche',
      name: '赛车竞技',
      description: '以赛车运动为主题的体育竞技小说',
      keywords: ['赛车', 'F1', '拉力赛', '飙车', '头文字D', '赛车小说', '车神', '方程式', '漂移', '改装车', '山路赛车', '职业赛车', '车队', '赛车手', '冠军'],
      exampleTitles: ['头文字D', '速度与激情', '车神', 'F1之王者归来', '极速人生']
    },
    {
      id: 'youyong',
      name: '游泳竞技',
      description: '以游泳运动为主题的体育竞技小说',
      keywords: ['游泳', '自由泳', '蛙泳', '蝶泳', '仰泳', '游泳小说', '飞鱼', '孙杨', '菲尔普斯', '奥运会', '世锦赛', '泳池', '游泳队', '跳水', '水球'],
      exampleTitles: ['free!', '游泳之王', '重生之游泳天才', '泳池之神', '水中王者']
    },
    {
      id: 'tianjing',
      name: '田径竞技',
      description: '以田径运动为主题的体育竞技小说',
      keywords: ['田径', '跑步', '短跑', '长跑', '马拉松', '跳远', '跳高', '田径小说', '飞人', '博尔特', '刘翔', '奥运会', '世锦赛', '田径场', '接力赛'],
      exampleTitles: ['强风吹拂', '田径之神', '短跑之王', '马拉松王者', '重生之田径天才']
    },
    {
      id: 'xitong_tiyu',
      name: '系统流体育',
      description: '主角获得体育系统，靠系统提升实力的竞技文',
      keywords: ['系统', '金手指', '体育系统', '技能点', '属性', '任务系统', '签到', '抽奖', '系统流', '开挂', '升级', '成长系统', '竞技系统', '篮球系统', '足球系统'],
      exampleTitles: ['超级球王系统', '篮球之神级系统', '足球上帝视角', '我有一个属性面板', '竞技之我是传奇']
    }
  ],
  weights: { character: 0.2, foreshadow: 0.1, technique: 0.25, style: 0.1, rhythm: 0.25, structure: 0.1 }
};

const ERCIYUAN: GenreConfig = {
  id: 'erciyuan',
  name: '二次元',
  category: 'male',
  description: '以动漫风格为特色，包含校园、超能力、异世界穿越等二次元元素',
  personalityTags: [
    '温柔体贴', '傲娇', '病娇', '三无', '腹黑', '天然呆', '元气满满', '高冷',
    '沙雕', '中二', '热血', '冷静', '机智', '迟钝', '害羞', '开朗',
    '慵懒', '认真', '调皮', '毒舌', '闷骚', '护短', '贱兮兮', '装逼犯',
    '老银币', '外冷内热', '白切黑', '亦正亦邪', '随性洒脱', '重情重义', '阳光开朗', '阴郁深沉',
    '呆毛', '吃货', '路痴', '音痴', '运动白痴', '学霸', '学渣', '温柔治愈'
  ],
  abilityTypes: [
    '超能力', '魔法', '异能', '念力', '瞬间移动', '时间停止', '时间回溯', '空间移动', '隐身', '透视',
    '读心术', '预知未来', '不死之身', '再生能力', '变身', '召唤', '契约', '系统', '金手指', '技能面板',
    '剑术', '格斗术', '枪术', '弓术', '忍术', '咒术', '灵力', '妖力', '神力', '魔力',
    '精灵魔法', '龙之力', '恶魔之力', '天使之力', '神圣力量', '黑暗力量', '元素操控', '精神力量',
    '黑客技术', '游戏技术', '料理能力', '绘画能力', '音乐天赋', '演技', '学习能力', '语言天赋'
  ],
  roleTypes: [
    '男主角', '女主角', '女配角', '男配角', '反派BOSS', '青梅竹马', '转学生', '班长', '学生会长',
    '风纪委员', '社团社长', '幽灵', '妖怪', '精灵', '恶魔', '天使', '神明', '外星人',
    '机器人', '人造人', '魔法少女', '勇者', '魔王', '龙傲天', '穿越者', '转生者',
    '系统精灵', '导师', '前辈', '后辈', '同学', '老师', '家长', '邻居', '网友',
    '游戏好友', '竞争对手', '战友', '宿敌', '妹妹', '姐姐', '弟弟', '哥哥'
  ],
  backgroundTypes: [
    '现代校园', '高中学校', '大学校园', '中学教室', '学生会室', '社团活动室', '学校天台', '学校操场',
    '学校图书馆', '学校食堂', '樱花树下', '学生宿舍', '学园祭', '文化祭', '体育祭', '修学旅行',
    '异世界', '幻想世界', '魔法世界', '剑与魔法的世界', '游戏世界', '虚拟世界', '未来都市',
    '末日世界', '妖怪世界', '神界', '魔界', '精灵国度', '地下城', '冒险者公会', '魔王城',
    '海边', '夏日祭', '烟火大会', '温泉旅馆', '游乐园', '咖啡厅', '便利店', '家庭餐厅',
    '漫展', '同人志即卖会', '秋叶原', '动漫店', '游戏中心'
  ],
  techniques: [
    { id: 'erciyuan_001', name: '异世界穿越', category: 'genre', description: '主角穿越或转生到异世界，开启第二人生', keywords: ['异世界', '穿越', '转生', '穿越到', '转生到'], baseConfidence: 0.85, genreWeight: 2.0 },
    { id: 'erciyuan_002', name: '校园日常', category: 'genre', description: '以校园生活为背景的轻松日常故事', keywords: ['校园', '日常', '学校', '学生', '校园生活'], baseConfidence: 0.8, genreWeight: 1.9 },
    { id: 'erciyuan_003', name: '超能力觉醒', category: 'cool_point', description: '主角觉醒超能力，生活从此改变', keywords: ['超能力', '觉醒', '异能', '特异功能', '能力'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'erciyuan_004', name: '后宫成群', category: 'emotion', description: '各种类型的美少女围绕在主角身边', keywords: ['后宫', '美少女', '妹子', '女主们', '环绕'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'erciyuan_005', name: '系统加身', category: 'cool_point', description: '主角获得系统金手指，人生开挂', keywords: ['系统', '金手指', '任务', '奖励', '面板'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'erciyuan_006', name: '学院战斗', category: 'structure', description: '在学院中进行的战斗比赛或能力对决', keywords: ['学院', '战斗', '比赛', '对决', '能力'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'erciyuan_007', name: '萌系日常', category: 'style', description: '轻松治愈的萌系日常，可爱角色卖萌', keywords: ['萌', '治愈', '可爱', '卖萌', '轻松'], baseConfidence: 0.75, genreWeight: 1.6 },
    { id: 'erciyuan_008', name: '中二病发作', category: 'style', description: '充满中二气息的设定和台词', keywords: ['中二', '中二病', '邪气眼', '漆黑烈焰使', '幻想'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'erciyuan_009', name: '社团活动', category: 'structure', description: '围绕社团活动展开的青春故事', keywords: ['社团', '社团活动', '部活', '社团活动室', '部长'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'erciyuan_010', name: '青梅竹马', category: 'emotion', description: '从小一起长大的青梅竹马的感情线', keywords: ['青梅竹马', '幼驯染', '从小', '邻居', '玩伴'], baseConfidence: 0.75, genreWeight: 1.6 },
    { id: 'erciyuan_011', name: '转学生', category: 'structure', description: '神秘转学生的到来打破了平静的校园生活', keywords: ['转学生', '转学', '新同学', '神秘', '新来的'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'erciyuan_012', name: '学园祭', category: 'structure', description: '学园祭、文化祭等校园活动是重要剧情节点', keywords: ['学园祭', '文化祭', '校园活动', '校庆', '活动'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'erciyuan_013', name: '异世界建国', category: 'genre', description: '主角在异世界建立国家或势力', keywords: ['建国', '领地', '建设', '国家', '势力'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'erciyuan_014', name: '召唤勇者', category: 'genre', description: '主角被召唤到异世界成为勇者', keywords: ['召唤', '勇者', '异世界召唤', '勇者召唤', '魔法阵'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'erciyuan_015', name: '最弱无败', category: 'cool_point', description: '看似最弱的主角其实是最强的', keywords: ['最弱', '无败', '最强', '隐藏实力', '扮猪吃虎'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'erciyuan_016', name: '魔法学院', category: 'structure', description: '主角在魔法学院学习魔法的故事', keywords: ['魔法学院', '魔法学校', '学院', '学习魔法', '魔法师'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'erciyuan_017', name: '游戏人生', category: 'genre', description: '主角靠游戏技能或游戏知识在异世界开挂', keywords: ['游戏', '游戏人生', '游戏技能', '游戏知识', '玩家'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'erciyuan_018', name: '精灵耳', category: 'style', description: '精灵、兽人等亚人角色，萌属性满满', keywords: ['精灵', '兽耳', '猫耳', '狐耳', '亚人'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'erciyuan_019', name: '异世界食堂', category: 'genre', description: '以美食为主题的异世界温馨故事', keywords: ['美食', '食堂', '料理', '异世界食堂', '吃'], baseConfidence: 0.6, genreWeight: 1.3 },
    { id: 'erciyuan_020', name: '转生史莱姆', category: 'genre', description: '主角转生成非人类生物，在异世界发展', keywords: ['转生', '史莱姆', '非人类', '魔物', '异世界'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'erciyuan_021', name: '热血战斗', category: 'emotion', description: '热血沸腾的战斗场面，友情与努力的胜利', keywords: ['热血', '战斗', '友情', '努力', '胜利'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'erciyuan_022', name: '梗与吐槽', category: 'style', description: '充满动漫梗和角色吐槽，轻松搞笑', keywords: ['梗', '吐槽', '搞笑', '玩梗', 'neta'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'erciyuan_023', name: '夏日海边', category: 'structure', description: '海边、夏日祭等经典二次元场景', keywords: ['海边', '夏日', '泳装', '海边合宿', '夏日祭'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'erciyuan_024', name: '妹妹属性', category: 'emotion', description: '有妹妹角色，或妹控属性', keywords: ['妹妹', '义妹', '实妹', '妹控', '妹妹大人'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'erciyuan_025', name: '傲娇女主', category: 'emotion', description: '女主是典型的傲娇性格，口嫌体正直', keywords: ['傲娇', '蹭得累', '口嫌体正直', '傲娇女主', '哼'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'erciyuan_026', name: '异世界迷宫', category: 'structure', description: '探索异世界的迷宫地下城', keywords: ['迷宫', '地下城', '探索迷宫', '迷宫攻略', '地下迷宫'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'erciyuan_027', name: '画风突变', category: 'style', description: '时而认真时而沙雕，风格多变', keywords: ['画风突变', '搞笑', '严肃', '切换', '风格多变'], baseConfidence: 0.65, genreWeight: 1.4 }
  ],
  subGenres: [
    {
      id: 'isekai',
      name: '异世界转生',
      description: '主角穿越或转生到异世界，开启第二人生',
      keywords: ['异世界', '穿越', '转生', '转生到', '穿越到', '异世界穿越', '异世界转生', '异世', '异界', '异世界生活', '穿越者', '转生者', '异世界冒险', '剑与魔法', '魔力'],
      exampleTitles: ['关于我转生变成史莱姆这档事', 'Re:从零开始的异世界生活', '无职转生', '刀剑神域', '游戏人生']
    },
    {
      id: 'xiaoyuan_qingchun',
      name: '校园青春',
      description: '以校园生活为背景的青春恋爱喜剧',
      keywords: ['校园', '青春', '校园生活', '高中', '学生', '校园恋爱', '校园喜剧', '日常', '青春校园', '同学', '校园日常', '校园爱情', '青涩', '校服', '学生时代'],
      exampleTitles: ['我的青春恋爱物语果然有问题', '辉夜大小姐想让我告白', '青春猪头少年', '冰菓', 'CLANNAD']
    },
    {
      id: 'chaonengli',
      name: '超能力战斗',
      description: '拥有超能力的角色之间的战斗故事',
      keywords: ['超能力', '异能', '能力者', '超能力者', '特异功能', '觉醒能力', '超能', '异能力', '能力', '特殊能力', '超自然', '念力', '空间能力', '时间能力', '元素能力'],
      exampleTitles: ['某科学的超电磁炮', '魔法禁书目录', '我的英雄学院', '一拳超人', '灵能百分百']
    },
    {
      id: 'mofa_xueyuan',
      name: '魔法学院',
      description: '主角在魔法学院学习和成长的故事',
      keywords: ['魔法学院', '魔法学校', '学院', '学习魔法', '魔法师', '魔法学生', '魔法课', '学院大比', '魔法社团', '魔法战斗', '魔法老师', '魔法教材', '魔法实践', '学院都市', '魔导士'],
      exampleTitles: ['哈利波特', '魔法科高中的劣等生', '零之使魔', '妖精的尾巴', '魔导少年']
    },
    {
      id: 'rixi_hougong',
      name: '日常后宫',
      description: '日常背景下的后宫恋爱喜剧',
      keywords: ['后宫', '美少女', '妹子', '恋爱喜剧', '后宫动漫', '女主们', '修罗场', '多女主', '后宫王', '艳遇', '桃花运', '妹子环绕', '萌妹子', '可爱女孩', '同居'],
      exampleTitles: ['约会大作战', '刀剑神域', '出包王女', '五等分的新娘', '我们无法一起学习']
    },
    {
      id: 'youxi_shijie',
      name: '游戏世界',
      description: '主角进入游戏世界或穿越到游戏里',
      keywords: ['游戏世界', '游戏', '穿越游戏', '进入游戏', '游戏人生', '游戏技能', '游戏玩家', '虚拟现实游戏', 'VRMMO', '潜行游戏', '游戏化', '数据化', '游戏系统', '游戏攻略', '游戏NPC'],
      exampleTitles: ['刀剑神域', '记录的地平线', '游戏人生', 'Overlord', '因为太怕痛就全点防御力了']
    },
    {
      id: 'yaogui_lingyi',
      name: '妖怪灵异',
      description: '妖怪、幽灵、灵异现象相关的故事',
      keywords: ['妖怪', '幽灵', '灵异', '鬼怪', '妖怪灵异', '阴阳师', '除灵', '灵能力者', '妖怪少女', '付丧神', '妖怪旅馆', '怪谈', '灵异事件', '驱魔', '式神'],
      exampleTitles: ['夏目友人帐', '犬夜叉', '滑头鬼之孙', '青之驱魔师', '境界的彼方']
    },
    {
      id: 'moyu_wangguo',
      name: '魔王勇者',
      description: '勇者与魔王相关的奇幻故事',
      keywords: ['魔王', '勇者', '魔王城', '勇者斗魔王', '魔族', '人类军', '魔王大人', '勇者大人', '魔族公主', '魔王军', '四天王', '最终BOSS', '魔界', '勇者小队', '封印'],
      exampleTitles: ['魔王勇者', '打工吧！魔王大人', '传说中勇者的传说', '关于我转生变成史莱姆这档事', '异世界魔王与召唤少女的奴隶魔术']
    },
    {
      id: 'meishi_eryuan',
      name: '美食二次元',
      description: '以美食为主题的温馨二次元故事',
      keywords: ['美食', '料理', '异世界食堂', '美食番', '吃', '好吃', '料理制作', '美食家', '异世界美食', '食堂', '餐厅', '甜点', '日式料理', '中华料理', '西餐'],
      exampleTitles: ['异世界食堂', '食戟之灵', '中华小当家', '卫宫家今天的饭', '请问您今天要来点兔子吗']
    }
  ],
  weights: { character: 0.25, foreshadow: 0.1, technique: 0.2, style: 0.2, rhythm: 0.15, structure: 0.1 }
};

const LINGYI_GUIGUAI: GenreConfig = {
  id: 'lingyi_guiguai',
  name: '灵异鬼怪',
  category: 'male',
  description: '以鬼怪灵异为主题，包含捉鬼、驱邪、灵异事件调查等恐怖悬疑元素',
  personalityTags: [
    '冷静沉着', '胆大心细', '神经质', '阴阳眼', '天生道体', '痞气十足', '玩世不恭', '深藏不露',
    '正直善良', '亦正亦邪', '神秘莫测', '阴郁深沉', '外冷内热', '毒舌', '闷骚', '腹黑',
    '重情重义', '睚眦必报', '护短', '贱兮兮', '装逼犯', '老银币', '白切黑', '杀伐果断',
    '贪财好色', '神神叨叨', '疯疯癫癫', '大智若愚', '真人不露相', '铁齿铜牙', '一身正气', '邪气凛然',
    '看破红尘', '济世救人', '除魔卫道', '走阴人', '阴阳先生', '风水师'
  ],
  abilityTypes: [
    '道术', '法术', '符咒', '符箓', '阵法', '风水', '相术', '占卜', '算命', '望气',
    '阴阳眼', '开天眼', '通灵', '请神', '上身', '走阴', '过阴', '招魂', '驱邪', '捉鬼',
    '超度', '炼化', '收妖', '降魔', '茅山术', '全真道', '正一道', '佛教神通', '念经超度', '佛珠法器',
    '桃木剑', '金钱剑', '墨斗', '罗盘', '八卦镜', '玉符', '护身符', '五帝钱', '朱砂', '黑狗血',
    '童子尿', '黑驴蹄子', '糯米', '墨斗线', '捆仙绳', '照妖镜', '三清铃', '天皇号令', '令旗', '桃木印'
  ],
  roleTypes: [
    '男主角', '女主角', '男配', '女配', '反派BOSS', '道士', '阴阳先生', '风水师', '算命先生',
    '法师', '和尚', '尼姑', '神父', '修女', '灵媒', '神婆', '神棍', '骗子',
    '厉鬼', '恶鬼', '冤魂', '怨灵', '孤魂野鬼', '山精野怪', '狐狸精', '黄鼠狼', '蛇精',
    '僵尸', '丧尸', '吸血鬼', '狼人', '恶魔', '幽灵', '恶灵', '食尸鬼', '梦魇',
    '警察', '法医', '侦探', '记者', '医生', '护士', '教授', '学生', '老板',
    '客户', '委托人', '守墓人', '赶尸人', '盗墓贼', '发丘中郎将', '摸金校尉', '搬山道人', '卸岭力士'
  ],
  backgroundTypes: [
    '古老小镇', '废弃医院', '精神病院', '废弃学校', '旧宿舍楼', '荒村古宅', '深山老林', '乱葬岗',
    '坟场墓地', '殡仪馆', '火葬场', '太平间', '停尸房', '医院', '学校', '宿舍楼',
    '出租屋', '老宅', '古宅', '凶宅', '鬼屋', '地下室', '阁楼', '电梯', '楼梯间',
    '厕所', '浴室', '镜子前', '井边', '河边', '湖边', '十字路口', '公交车', '地铁',
    '出租车', '电梯间', '走廊', '密室', '山洞', '古墓', '墓穴', '地宫', '祠堂',
    '城隍庙', '土地庙', '道观', '寺庙', '教堂', '神坛', '祭坛', '法坛'
  ],
  techniques: [
    { id: 'lingyi_001', name: '阴阳眼', category: 'cool_point', description: '主角天生或后天拥有阴阳眼，能看见鬼魂', keywords: ['阴阳眼', '天眼', '见鬼', '看见鬼', '第三只眼'], baseConfidence: 0.85, genreWeight: 2.0 },
    { id: 'lingyi_002', name: '祖传秘术', category: 'cool_point', description: '主角继承家族祖传的捉鬼驱邪秘术', keywords: ['祖传', '秘术', '家传', '传承', '祖上'], baseConfidence: 0.8, genreWeight: 1.9 },
    { id: 'lingyi_003', name: '灵异事件', category: 'structure', description: '主角调查解决各种灵异事件', keywords: ['灵异事件', '闹鬼', '怪事', '诡异', '离奇'], baseConfidence: 0.85, genreWeight: 2.0 },
    { id: 'lingyi_004', name: '凶宅探险', category: 'structure', description: '进入凶宅或闹鬼的地方探险调查', keywords: ['凶宅', '鬼屋', '闹鬼', '探险', '老宅'], baseConfidence: 0.8, genreWeight: 1.9 },
    { id: 'lingyi_005', name: '道术驱邪', category: 'cool_point', description: '使用道术符箓驱邪捉鬼，道法高深', keywords: ['道术', '驱邪', '符箓', '符咒', '捉鬼'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'lingyi_006', name: '风水相术', category: 'genre', description: '主角精通风水相术，看相算命堪舆风水', keywords: ['风水', '相术', '算命', '面相', '堪舆'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'lingyi_007', name: '恐怖氛围', category: 'style', description: '营造紧张恐怖的氛围，让读者心惊胆战', keywords: ['恐怖', '氛围', '惊悚', '吓人', '可怕'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'lingyi_008', name: '悬念迭起', category: 'structure', description: '悬念重重，真相一层层揭开', keywords: ['悬念', '悬疑', '真相', '谜团', '揭秘'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'lingyi_009', name: '鬼打墙', category: 'structure', description: '经典的鬼打墙桥段，怎么也走不出去', keywords: ['鬼打墙', '迷路', '走不出去', '循环', '绕圈'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'lingyi_010', name: '冤魂索命', category: 'structure', description: '冤死的鬼魂回来复仇索命', keywords: ['冤魂', '索命', '复仇', '厉鬼', '冤死'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'lingyi_011', name: '招魂仪式', category: 'structure', description: '举行招魂仪式，请逝者亡魂对话', keywords: ['招魂', '仪式', '请魂', '亡魂', '通灵'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'lingyi_012', name: '僵尸来袭', category: 'cool_point', description: '粽子、僵尸的出现和战斗', keywords: ['僵尸', '粽子', '黑驴蹄子', '糯米', '赶尸'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'lingyi_013', name: '摸金盗墓', category: 'genre', description: '盗墓探险，古墓中的鬼怪和机关', keywords: ['盗墓', '摸金', '古墓', '倒斗', '粽子'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'lingyi_014', name: '走阴过阴', category: 'cool_point', description: '主角能走阴过阴，到阴间办事', keywords: ['走阴', '过阴', '阴间', '阴曹地府', '走阴人'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'lingyi_015', name: '因果报应', category: 'structure', description: '善恶到头终有报，因果循环不爽', keywords: ['因果', '报应', '善有善报', '恶有恶报', '因果循环'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'lingyi_016', name: '收妖降魔', category: 'cool_point', description: '收服妖怪，降伏邪魔', keywords: ['收妖', '降魔', '妖怪', '邪魔', '妖精'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'lingyi_017', name: '开坛做法', category: 'structure', description: '道士开坛做法，布阵法驱邪祟', keywords: ['开坛', '做法', '法坛', '布阵', '驱邪'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'lingyi_018', name: '民间怪谈', category: 'genre', description: '基于民间传说和怪谈改编的灵异故事', keywords: ['民间', '怪谈', '传说', '都市传说', '奇闻异事'], baseConfidence: 0.75, genreWeight: 1.6 },
    { id: 'lingyi_019', name: '午夜惊魂', category: 'structure', description: '午夜十二点发生的恐怖事件', keywords: ['午夜', '凌晨', '十二点', '半夜', '深夜'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'lingyi_020', name: '镜中鬼影', category: 'structure', description: '镜子里出现的鬼影，经典恐怖桥段', keywords: ['镜子', '鬼影', '镜中', '倒影', '照镜子'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'lingyi_021', name: '心理恐怖', category: 'style', description: '心理层面的恐怖，细思极恐', keywords: ['心理恐怖', '细思极恐', '心理', '精神', '细思恐极'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'lingyi_022', name: '层层递进', category: 'rhythm', description: '恐怖程度层层递进，越来越吓人', keywords: ['层层递进', '递进', '升级', '越来越恐怖', '加剧'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'lingyi_023', name: '环境渲染', category: 'style', description: '通过环境描写渲染恐怖氛围', keywords: ['环境', '渲染', '氛围', '场景', '描写'], baseConfidence: 0.75, genreWeight: 1.6 },
    { id: 'lingyi_024', name: '都市怪谈', category: 'genre', description: '现代都市中的灵异怪谈故事', keywords: ['都市怪谈', '都市传说', '现代', '城市', '都市'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'lingyi_025', name: '茅山道士', category: 'genre', description: '以茅山道术为主要能力体系', keywords: ['茅山', '茅山术', '茅山道士', '上清派', '茅山派'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'lingyi_026', name: '主角光环', category: 'cool_point', description: '主角有特殊体质或命格，百邪不侵', keywords: ['百邪不侵', '特殊体质', '天生道体', '纯阳之体', '纯阴之体'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'lingyi_027', name: '真假难辨', category: 'structure', description: '真真假假虚虚实实，让人分不清现实与幻觉', keywords: ['真假难辨', '虚实', '幻觉', '现实', '幻象'], baseConfidence: 0.7, genreWeight: 1.5 }
  ],
  subGenres: [
    {
      id: 'zhuogui_daozhang',
      name: '捉鬼道长',
      description: '主角是道士或阴阳先生，专门捉鬼驱邪',
      keywords: ['捉鬼', '道士', '道长', '阴阳先生', '驱邪', '茅山', '道术', '符箓', '符咒', '桃木剑', '捉鬼人', '驱鬼', '超度', '法事', '开坛做法'],
      exampleTitles: ['我有一座恐怖屋', '最后一个道士', '麻衣神相', '苗疆蛊事', '道士不好惹']
    },
    {
      id: 'daomu_lingyi',
      name: '盗墓灵异',
      description: '盗墓探险类灵异故事，古墓中的鬼怪和机关',
      keywords: ['盗墓', '摸金', '倒斗', '古墓', '粽子', '摸金校尉', '发丘中郎将', '搬山道人', '卸岭力士', '盗墓笔记', '鬼吹灯', '古墓历险', '机关', '冥器', '明器'],
      exampleTitles: ['盗墓笔记', '鬼吹灯', '藏地密码', '沙海', '老九门']
    },
    {
      id: 'fengshui_xiansheng',
      name: '风水相师',
      description: '主角精通风水相术，看相算命堪舆风水',
      keywords: ['风水', '相术', '算命', '面相', '堪舆', '风水师', '相师', '算命先生', '风水相术', '看相', '算卦', '占卜', '阴阳宅', '祖坟风水', '龙脉'],
      exampleTitles: ['麻衣神相', '我当阴阳先生的那几年', '民调局异闻录', '天才相师', '超品相师']
    },
    {
      id: 'dushi_guaitan',
      name: '都市怪谈',
      description: '现代都市中的灵异怪谈故事',
      keywords: ['都市怪谈', '都市传说', '现代灵异', '城市鬼故事', '都市', '城市', '高楼', '电梯', '地铁', '公交车', '医院', '学校', '写字楼', '出租屋', '城市传说'],
      exampleTitles: ['我有一座恐怖屋', '深夜书屋', '全球高武', '大王饶命', '修真聊天群']
    },
    {
      id: 'zouyin_ren',
      name: '走阴人',
      description: '主角能走阴过阴，来往阴阳两界',
      keywords: ['走阴', '过阴', '阴间', '阴曹地府', '走阴人', '阴阳两界', '阴阳先生', '灵魂出窍', '幽冥', '地府', '阎王', '牛头马面', '黑白无常', '孟婆', '奈何桥'],
      exampleTitles: ['我当阴阳先生的那几年', '民调局异闻录', '最后一个道士', '苗疆蛊事', '阴间商人']
    },
    {
      id: 'jiangshi_yingshi',
      name: '僵尸影视',
      description: '以僵尸为主要恐怖元素的灵异故事',
      keywords: ['僵尸', '粽子', '赶尸', '黑驴蹄子', '糯米', '丧尸', '行尸走肉', '僵尸片', '林正英', '赶尸人', '湘西赶尸', '僵尸王', '旱魃', '跳尸', '飞尸'],
      exampleTitles: ['鬼吹灯', '盗墓笔记', '湘西赶尸录', '僵尸问道', '末日丧尸']
    },
    {
      id: 'yaojing',
      name: '妖精鬼怪',
      description: '狐狸精、蛇精等山精野怪的故事',
      keywords: ['妖精', '妖怪', '狐狸精', '蛇精', '黄鼠狼', '山精野怪', '妖魔鬼怪', '狐狸精', '狐妖', '妖物', '精怪', '妖邪', '鬼怪', '妖物', '修炼成精'],
      exampleTitles: ['聊斋志异', '白蛇传', '封神榜', '西游记', '镜花缘']
    },
    {
      id: 'lingyi_diaocha',
      name: '灵异调查',
      description: '主角调查各种灵异事件的悬疑故事',
      keywords: ['灵异调查', '调查', '事件', '案件', '诡异事件', '调查组', '特别行动组', '异常事件', '超自然现象', '神秘事件', '灵异档案', 'X档案', '调查员', '探员', '神秘组织'],
      exampleTitles: ['民调局异闻录', '灵异事件簿', '中国龙组', '诡案组', '十宗罪']
    },
    {
      id: 'minjian_chuanshuo',
      name: '民间传说',
      description: '基于民间传说和乡野怪谈的灵异故事',
      keywords: ['民间传说', '乡野怪谈', '奇闻异事', '怪谈', '传说', '民俗', '迷信', '禁忌', '习俗', '老话', '老一辈说', '老人言', '乡下', '农村', '山里'],
      exampleTitles: ['聊斋志异', '阅微草堂笔记', '子不语', '太平广记', '山海经']
    }
  ],
  weights: { character: 0.2, foreshadow: 0.2, technique: 0.2, style: 0.2, rhythm: 0.1, structure: 0.1 }
};

const XIANDAI_DANMEI: GenreConfig = {
  id: 'xiandai_danmei',
  name: '现代耽美',
  category: 'female',
  description: '现代背景下的男男爱情故事，包含校园、职场、娱乐圈等子类',
  personalityTags: [
    '清冷孤傲', '温润如玉', '腹黑', '白切黑', '病娇', '傲娇', '隐忍', '坚韧不拔',
    '敢爱敢恨', '温柔体贴', '外冷内热', '内向害羞', '开朗阳光', '痞气十足', '深情专一',
    '毒舌', '闷骚', '护短', '高冷禁欲', '苏炸天', '忠犬', '女王', '傲娇受',
    '冰山攻', '温柔攻', '年下攻', '年上攻', '霸道总裁', '小奶狗', '小狼狗', '禁欲系',
    '妖孽', '美人', '直男癌', '深柜', '出柜', '暗恋', '明恋', '双向暗恋'
  ],
  abilityTypes: [
    '设计', '编程', '医术', '律师', '金融', '投资', '厨艺', '绘画', '音乐', '舞蹈',
    '演技', '唱歌', '写作', '翻译', '摄影', '商业天才', '黑客技术', '心理学',
    '占卜', '预知', '读心', '系统', '穿越', '重生', '空间', '异能', '透视',
    '武术', '格斗', '赛车', '调酒', '咖啡', '花艺', '烘焙', '美妆', '服装搭配',
    '谈判能力', '演讲口才', '管理能力', '领导力'
  ],
  roleTypes: [
    '主角攻', '主角受', '男配角', '女配角', '反派', '霸道总裁', '温柔学长', '青梅竹马',
    '初恋情人', '顶流明星', '知名设计师', '金牌律师', '天才医生', '职场上司', '闺蜜',
    '情敌', '前男友', '前女友', '家族长辈', '父母', '兄弟姐妹', '同事', '客户',
    '合作伙伴', '老板', '秘书', '助理', '经纪人', '粉丝', '狗仔队', '老师',
    '同学', '室友', '邻居', '网友', '游戏好友', '竞争对手', '战友', '宿敌'
  ],
  backgroundTypes: [
    '一线城市CBD', '高档写字楼', '豪华别墅', '大学校园', '高中校园', '公司职场',
    '医院', '律师事务所', '设计工作室', '画廊', '音乐厅', '电视台', '影视城',
    '高级餐厅', '咖啡厅', '酒吧夜店', '购物中心', '机场高铁站', '公寓小区',
    '海边度假村', '温泉酒店', '滑雪场', '古镇旅游', '国外留学', '出租屋',
    '地下室', '同志酒吧', '彩虹游行', '民政局', '婚礼现场', '医院病房',
    '学校宿舍', '图书馆', '篮球场', '游泳馆', '健身房'
  ],
  techniques: [
    { id: 'xiandai_dm_001', name: '霸道总裁', category: 'cool_point', description: '攻是霸道多金的总裁，对受霸道又宠溺', keywords: ['总裁', '霸道', 'CEO', '豪门', '霸道总裁'], baseConfidence: 0.85, genreWeight: 2.0 },
    { id: 'xiandai_dm_002', name: '契约婚姻', category: 'structure', description: '两人因某种原因签订契约结婚，假戏真做', keywords: ['契约', '协议', '结婚', '假婚', '交易'], baseConfidence: 0.8, genreWeight: 1.9 },
    { id: 'xiandai_dm_003', name: '追妻火葬场', category: 'emotion', description: '攻前期不珍惜受，后期后悔疯狂追妻', keywords: ['追妻', '火葬场', '后悔', '珍惜', '挽回'], baseConfidence: 0.85, genreWeight: 1.9 },
    { id: 'xiandai_dm_004', name: '替身梗', category: 'emotion', description: '受因为像攻的白月光而被选中，后来攻真爱受', keywords: ['替身', '白月光', '像', '代替', '真爱'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'xiandai_dm_005', name: '重生复仇', category: 'structure', description: '受前世被害惨死，重生归来步步为营复仇', keywords: ['重生', '复仇', '前世', '惨死', '重来'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'xiandai_dm_006', name: '先婚后爱', category: 'structure', description: '两人先结婚后恋爱，在相处中渐生情愫', keywords: ['先婚后爱', '婚姻', '相处', '日久生情', '联姻'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'xiandai_dm_007', name: '甜宠无虐', category: 'emotion', description: '全程高甜无虐，攻宠受宠上天', keywords: ['甜宠', '宠妻', '无虐', '高甜', '宠溺'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'xiandai_dm_008', name: '虐恋情深', category: 'emotion', description: '两人之间爱得很痛苦，误会重重彼此折磨', keywords: ['虐恋', '误会', '折磨', '心痛', '情深'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'xiandai_dm_009', name: '校园青春', category: 'genre', description: '以校园为背景的青春爱情故事', keywords: ['校园', '青春', '学生', '校服', '青涩'], baseConfidence: 0.75, genreWeight: 1.6 },
    { id: 'xiandai_dm_010', name: '职场情缘', category: 'genre', description: '两人在职场中相识相恋，共同成长', keywords: ['职场', '办公室', '上司', '下属', '同事'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'xiandai_dm_011', name: '娱乐圈文', category: 'genre', description: '以娱乐圈为背景的言情故事', keywords: ['娱乐', '明星', '演员', '歌手', '综艺'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'xiandai_dm_012', name: '破镜重圆', category: 'emotion', description: '曾经分开的情侣多年后重逢再续前缘', keywords: ['破镜重圆', '重逢', '复合', '旧情', '再遇'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'xiandai_dm_013', name: '青梅竹马', category: 'emotion', description: '从小一起长大的两人之间的感情', keywords: ['青梅竹马', '从小', '长大', '邻居', '玩伴'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'xiandai_dm_014', name: '一见钟情', category: 'emotion', description: '两人第一次见面就爱上对方', keywords: ['一见钟情', '初见', '心动', '一眼', '沦陷'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'xiandai_dm_015', name: '日久生情', category: 'emotion', description: '在长期相处中慢慢产生感情', keywords: ['日久生情', '相处', '陪伴', '习惯', '渐渐'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'xiandai_dm_016', name: '豪门恩怨', category: 'structure', description: '豪门家族内部的权力斗争和情感纠葛', keywords: ['豪门', '家族', '恩怨', '内斗', '争产'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'xiandai_dm_017', name: '打脸虐渣', category: 'cool_point', description: '主角狠狠打脸白莲花、绿茶和渣男', keywords: ['打脸', '虐渣', '白莲花', '绿茶', '渣男'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'xiandai_dm_018', name: '强强联合', category: 'genre', description: '两人都是强者，势均力敌的爱情', keywords: ['强强', '势均力敌', '强强联合', '双强', '强受'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'xiandai_dm_019', name: '年龄差', category: 'emotion', description: '两人之间有较大年龄差的爱情', keywords: ['年龄差', '大叔', '年上', '年下', '差十岁'], baseConfidence: 0.6, genreWeight: 1.3 },
    { id: 'xiandai_dm_020', name: '误会重重', category: 'emotion', description: '因为各种误会导致的情感波折', keywords: ['误会', '解释', '错过', '误解', '澄清'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'xiandai_dm_021', name: '双向奔赴', category: 'emotion', description: '两人互相爱慕，共同走向对方', keywords: ['双向', '奔赴', '互相', '彼此', '相爱'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'xiandai_dm_022', name: '暗恋成真', category: 'emotion', description: '主角暗恋对方多年，最终修成正果', keywords: ['暗恋', '单恋', '喜欢', '偷偷', '成真'], baseConfidence: 0.65, genreWeight: 1.5 },
    { id: 'xiandai_dm_023', name: '闪婚厚爱', category: 'structure', description: '认识不久就结婚，婚后逐渐相爱', keywords: ['闪婚', '厚爱', '快速', '结婚', '婚后'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'xiandai_dm_024', name: '细腻心理刻画', category: 'style', description: '注重人物心理活动的细腻描写', keywords: ['心理', '细腻', '内心', '感受', '情绪'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'xiandai_dm_025', name: '都市氛围感', category: 'style', description: '营造现代都市特有的氛围和生活气息', keywords: ['都市', '氛围', '现代', '生活', '气息'], baseConfidence: 0.65, genreWeight: 1.5 },
    { id: 'xiandai_dm_026', name: '出柜压力', category: 'emotion', description: '面对出柜的压力和家人的反对', keywords: ['出柜', '家人', '反对', '压力', '世俗眼光'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'xiandai_dm_027', name: '十年一品', category: 'emotion', description: '跨越多年的深情，从少年到白头', keywords: ['十年', '多年', '深情', '从一而终', '白头偕老'], baseConfidence: 0.75, genreWeight: 1.7 }
  ],
  subGenres: [
    {
      id: 'zongcai_danmei',
      name: '总裁耽美',
      description: '攻是霸道多金的总裁，与受的爱情故事',
      keywords: ['总裁', '霸道', 'CEO', '豪门', '霸道总裁', '总裁文', '豪门总裁', '总裁的', '总裁大人', '亿万总裁', '霸道总裁爱上我', '总裁攻', '总裁受', '总裁在上', '豪门恩怨'],
      exampleTitles: ['不可抗力', '你丫上瘾了', '逆袭', '势不可挡', '总裁酷帅狂霸拽']
    },
    {
      id: 'xiaoyuan_danmei',
      name: '校园耽美',
      description: '以校园为背景的青春爱情故事',
      keywords: ['校园', '青春', '校园生活', '高中', '大学', '学生', '校园恋爱', '校园耽美', '日常', '青春校园', '同学', '校园日常', '校园爱情', '青涩', '校服', '学生时代'],
      exampleTitles: ['撒野', '伪装学渣', '全球高考', '某某', '这题超纲了']
    },
    {
      id: 'yulequan_danmei',
      name: '娱乐圈耽美',
      description: '以娱乐圈为背景的耽美故事',
      keywords: ['娱乐', '明星', '演员', '歌手', '综艺', '娱乐圈', '影帝', '天王', '顶流', '经纪公司', '粉丝', '绯闻', '拍戏', '选秀', '娱乐圈文'],
      exampleTitles: ['我磕了对家X我的CP', '影帝', '天王', '巨星手记', '重征娱乐圈']
    },
    {
      id: 'pojing_danmei',
      name: '破镜重圆',
      description: '曾经分开的情侣多年后重逢再续前缘',
      keywords: ['破镜重圆', '重逢', '复合', '旧情', '再遇', '破镜', '重圆', '再续前缘', '旧爱', '重逢文', '多年后', '再相遇', '重修旧好', '回心转意', '失而复得'],
      exampleTitles: ['破云', '吞海', '默读', '残次品', '烈火浇愁']
    },
    {
      id: 'tianchong_danmei',
      name: '甜宠耽美',
      description: '全程高甜无虐，攻宠受宠上天',
      keywords: ['甜宠', '宠溺', '无虐', '高甜', '甜文', '宠文', '撒糖', '甜蜜', '宠夫', '宠妻', '超甜', '甜到齁', '甜宠文', '全程甜', '无虐甜宠'],
      exampleTitles: ['魔道祖师', '天官赐福', '人渣反派自救系统', '穿书自救指南', '山河令']
    },
    {
      id: 'nuelian_danmei',
      name: '虐恋耽美',
      description: '虐恋情深，误会重重彼此折磨的爱情',
      keywords: ['虐恋', '虐文', '误会', '折磨', '心痛', '情深', '虐心', '虐身', '虐恋情深', '追妻火葬场', '替身梗', '虐受', '虐攻', '玻璃渣', 'be'],
      exampleTitles: ['十大酷刑', '北京故事', '蓝宇', '断背山', '霜花店']
    },
    {
      id: 'zhichang_danmei',
      name: '职场耽美',
      description: '两人在职场中相识相恋，共同成长',
      keywords: ['职场', '办公室', '上司', '下属', '同事', '工作', '职业', '职场爱情', '办公室恋情', '霸道上司', '职场精英', '职场恋爱', '同事恋', '上下级', '职场成长'],
      exampleTitles: ['迪奥先生', '甲方大佬乙方流氓', '总裁的百万新娘', '上位', '胜者为王']
    },
    {
      id: 'chongsheng_danmei',
      name: '重生耽美',
      description: '主角重生回到过去，改变命运收获爱情',
      keywords: ['重生', '重生回到', '前世', '重生之', '重生文', '重生逆袭', '重生复仇', '带着记忆', '前世记忆', '弥补遗憾', '重来', '再生', '转世', '穿越现代', '重生归来'],
      exampleTitles: ['重生之将门毒后', '重生之嫡女祸妃', '权臣闲妻', '重生之渣受', '重生夜话']
    },
    {
      id: 'chuanyue_danmei',
      name: '穿越耽美',
      description: '主角穿越到另一个世界或时代的爱情故事',
      keywords: ['穿越', '穿越到', '异世', '异界', '穿越文', '穿越耽', '穿书', '穿成', '穿越成', '灵魂穿越', '时空穿越', '穿越回', '古代穿越', '现代穿越', '穿越系统'],
      exampleTitles: ['魔道祖师', '天官赐福', '人渣反派自救系统', '穿书自救指南', '天宝伏妖录']
    }
  ],
  weights: { character: 0.3, foreshadow: 0.1, technique: 0.15, style: 0.15, rhythm: 0.15, structure: 0.15 }
};

const GUDAI_DANMEI: GenreConfig = {
  id: 'gudai_danmei',
  name: '古代耽美',
  category: 'female',
  description: '古代背景下的男男爱情故事，包含江湖、宫廷、修仙等子类',
  personalityTags: [
    '温润如玉', '清冷孤傲', '腹黑', '白切黑', '病娇', '傲娇', '隐忍', '坚韧不拔',
    '敢爱敢恨', '温柔体贴', '外柔内刚', '杀伐果断', '痴情专一', '风流倜傥', '清雅绝尘',
    '毒舌', '闷骚', '护短', '高冷禁欲', '苏炸天', '忠犬', '女王受', '傲娇受',
    '冰山攻', '温柔攻', '年下攻', '年上攻', '帝王攻', '将军攻', '公子受', '书生受',
    '妖孽', '美人', '直男癌', '深柜', '暗恋', '明恋', '双向暗恋', '皇子', '世子'
  ],
  abilityTypes: [
    '武功', '轻功', '暗器', '毒术', '医术', '谋略', '易容', '催眠', '读心', '预知',
    '穿越', '重生', '空间', '系统', '灵泉', '种田', '经商', '厨艺', '书画', '音律',
    '茶道', '花道', '香道', '占卜', '风水', '相术', '御兽', '炼药', '阵法', '符箓',
    '修仙', '媚术', '蛊毒', '剑术', '刀法', '枪法', '鞭法', '掌法', '指法', '内功',
    '权谋', '人心', '兵法', '治国', '驭下之术'
  ],
  roleTypes: [
    '主角攻', '主角受', '男配', '女配', '反派', '皇帝', '王爷', '世子', '公子', '少爷',
    '将军', '丞相', '尚书', '江湖侠客', '魔教教主', '武林盟主', '富商', '书生', '才子',
    '太医', '太监', '侍卫', '暗卫', '影卫', '小厮', '书童', '管家', '嬷嬷', '丫鬟',
    '青楼小倌', '戏子', '药师', '道士', '和尚', '仙人', '魔尊', '道尊', '剑仙', '妖尊',
    '师父', '徒弟', '师兄', '师弟', '掌门', '门主', '教主', '宫主', '阁主'
  ],
  backgroundTypes: [
    '皇宫内院', '王府侯门', '世家大族', '小户人家', '宫闱深处', '东宫太子府', '王府后院',
    '古代街道', '市集庙会', '青楼楚馆', '茶馆酒楼', '客栈驿馆', '书院学堂', '寺庙道观',
    '田园乡村', '边塞军营', '江湖帮派', '魔教总坛', '武林世家', '皇家围场', '行宫别院',
    '皇家园陵', '秘境', '洞天福地', '仙山', '魔界', '神界', '妖界', '鬼界',
    '花海', '竹林', '桃林', '梅林', '雪山', '海岛', '沙漠', '草原', '悬崖峭壁',
    '谷底', '山洞', '水潭', '温泉', '断桥', '长亭', '古道', '边塞', '关外'
  ],
  techniques: [
    { id: 'gudai_dm_001', name: '帝王受', category: 'cool_point', description: '受是皇帝或君王，与权臣或将军的爱情', keywords: ['帝王', '皇帝', '君王', '天子', '帝王受'], baseConfidence: 0.8, genreWeight: 1.9 },
    { id: 'gudai_dm_002', name: '将军攻', category: 'cool_point', description: '攻是战功赫赫的将军，与受的爱情', keywords: ['将军', '战将', '武将', '大将军', '将军攻'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'gudai_dm_003', name: '江湖恩怨', category: 'structure', description: '江湖中的恩怨情仇，刀光剑影中的爱情', keywords: ['江湖', '恩怨', '武林', '侠客', '刀光剑影'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'gudai_dm_004', name: '宫廷权谋', category: 'structure', description: '宫廷中的权力斗争与爱情纠葛', keywords: ['宫廷', '权谋', '朝堂', '皇权', '夺嫡'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'gudai_dm_005', name: '修仙仙侠', category: 'genre', description: '带有修仙仙侠元素的古代耽美', keywords: ['修仙', '仙侠', '修真', '仙子', '上神'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'gudai_dm_006', name: '替身梗', category: 'emotion', description: '受因为像攻的白月光而被选中，后来攻真爱受', keywords: ['替身', '白月光', '像', '代替', '真爱'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'gudai_dm_007', name: '追妻火葬场', category: 'emotion', description: '攻前期不珍惜受，后期后悔疯狂追妻', keywords: ['追妻', '火葬场', '后悔', '珍惜', '挽回'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'gudai_dm_008', name: '先婚后爱', category: 'structure', description: '两人先结婚后恋爱，在相处中渐生情愫', keywords: ['先婚后爱', '婚姻', '相处', '日久生情', '联姻'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'gudai_dm_009', name: '指腹为婚', category: 'structure', description: '因指腹为婚或赐婚而在一起的两人', keywords: ['指腹为婚', '赐婚', '婚约', '娃娃亲', '联姻'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'gudai_dm_010', name: '退婚流', category: 'structure', description: '男方退婚，后续发展出不一样的故事', keywords: ['退婚', '解除婚约', '休妻', '和离', '拒婚'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'gudai_dm_011', name: '白月光与朱砂痣', category: 'emotion', description: '攻心中有白月光，受是朱砂痣的情感纠葛', keywords: ['白月光', '朱砂痣', '初恋', '心头好', '得不到'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'gudai_dm_012', name: '虐恋情深', category: 'emotion', description: '两人之间爱得很痛苦，误会重重彼此折磨', keywords: ['虐恋', '误会', '折磨', '心痛', '情深'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'gudai_dm_013', name: '甜宠无虐', category: 'emotion', description: '全程高甜无虐，攻宠受宠上天', keywords: ['甜宠', '宠妻', '无虐', '高甜', '宠溺'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'gudai_dm_014', name: '女扮男装', category: 'structure', description: '受女扮男装，在男性主导的世界里打拼', keywords: ['女扮男装', '男装', '身份', '掩饰', '暴露'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'gudai_dm_015', name: '替嫁新娘', category: 'structure', description: '受代替别人出嫁，意外收获真爱', keywords: ['替嫁', '代替', '新娘', '出嫁', '错嫁'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'gudai_dm_016', name: '嫡庶之争', category: 'structure', description: '嫡子庶子之间的争斗和情感纠葛', keywords: ['嫡子', '庶子', '嫡庶', '争斗', '世子'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'gudai_dm_017', name: '权谋天下', category: 'structure', description: '两人在权谋中成长，争夺天下', keywords: ['权谋', '天下', '夺嫡', '皇位', '江山'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'gudai_dm_018', name: '江湖侠士', category: 'genre', description: '行走江湖，快意恩仇的武侠耽美', keywords: ['江湖', '侠士', '武侠', '门派', '恩怨'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'gudai_dm_019', name: '师徒年下', category: 'emotion', description: '师父与徒弟之间的年下爱情', keywords: ['师徒', '年下', '师父', '徒弟', '年下攻'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'gudai_dm_020', name: '空间穿越', category: 'genre', description: '主角带着随身空间穿越到古代', keywords: ['空间', '随身', '灵泉', '仓库', '穿越'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'gudai_dm_021', name: '帝后情深', category: 'emotion', description: '皇帝与皇后之间的爱情故事', keywords: ['帝后', '皇帝', '皇后', '情深', '帝王'], baseConfidence: 0.65, genreWeight: 1.5 },
    { id: 'gudai_dm_022', name: '身世之谜', category: 'structure', description: '主角的真实身世是个谜，逐渐揭开', keywords: ['身世', '秘密', '亲生', '血脉', '谜团'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'gudai_dm_023', name: '打脸虐渣', category: 'cool_point', description: '主角狠狠打脸白莲花、绿茶和渣男', keywords: ['打脸', '虐渣', '白莲花', '绿茶', '渣男'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'gudai_dm_024', name: '细腻情感描写', category: 'style', description: '古代耽美注重情感的细腻描写和心理刻画', keywords: ['细腻', '心理', '情感', '细节', '内心'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'gudai_dm_025', name: '古风水墨感', category: 'style', description: '语言风格古色古香，营造古风意境', keywords: ['古风', '意境', '古色古香', '水墨', '雅致'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'gudai_dm_026', name: '强强对抗', category: 'emotion', description: '两个强者之间的势均力敌的爱情和对抗', keywords: ['强强', '对抗', '势均力敌', '双强', '强受强'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'gudai_dm_027', name: '十年生死两茫茫', category: 'emotion', description: '跨越多年的深情，生死相隔的虐恋', keywords: ['十年', '生死', '深情', '等待', '阴阳相隔'], baseConfidence: 0.7, genreWeight: 1.6 }
  ],
  subGenres: [
    {
      id: 'gongting_danmei',
      name: '宫廷权谋',
      description: '宫廷中的权力斗争与爱情纠葛',
      keywords: ['宫廷', '权谋', '朝堂', '皇权', '夺嫡', '皇帝', '王爷', '皇子', '世子', '宫廷权谋', '政治斗争', '朝廷', '丞相', '将军', '后宫'],
      exampleTitles: ['将进酒', '杀破狼', '默读', '镇魂', '残次品']
    },
    {
      id: 'jianghu_danmei',
      name: '江湖武侠',
      description: '江湖中的恩怨情仇，刀光剑影中的爱情',
      keywords: ['江湖', '武侠', '武林', '侠客', '刀光剑影', '门派', '魔教', '武林盟主', '江湖恩怨', '快意恩仇', '侠士', '剑客', '刀客', '帮派', '江湖儿女'],
      exampleTitles: ['笑傲江湖', '天涯客', '山河令', '七侠五义', '三侠五义']
    },
    {
      id: 'xiuxian_danmei',
      name: '修仙仙侠',
      description: '带有修仙仙侠元素的古代耽美',
      keywords: ['修仙', '仙侠', '修真', '仙子', '上神', '仙门', '魔界', '神界', '妖界', '修仙耽美', '仙侠耽美', '修真界', '渡劫', '飞升', '仙尊'],
      exampleTitles: ['魔道祖师', '天官赐福', '人渣反派自救系统', '穿书自救指南', '天宝伏妖录']
    },
    {
      id: 'xianhunhouai_dm',
      name: '先婚后爱',
      description: '两人先结婚后恋爱，在相处中渐生情愫',
      keywords: ['先婚后爱', '婚姻', '相处', '日久生情', '联姻', '指腹为婚', '赐婚', '婚约', '娃娃亲', '先结婚后恋爱', '婚后相处', '契约婚姻', '假戏真做', '先嫁后爱', '婚后恋'],
      exampleTitles: ['将进酒', '杀破狼', '默读', '镇魂', '山河令']
    },
    {
      id: 'tianchong_gudai_dm',
      name: '甜宠古耽',
      description: '全程高甜无虐的古代耽美甜宠文',
      keywords: ['甜宠', '宠溺', '无虐', '高甜', '甜文', '宠文', '撒糖', '甜蜜', '宠夫', '宠妻', '超甜', '甜到齁', '甜宠文', '全程甜', '无虐甜宠'],
      exampleTitles: ['魔道祖师', '天官赐福', '人渣反派自救系统', '穿书自救指南', '山河令']
    },
    {
      id: 'nuelian_gudai_dm',
      name: '虐恋古耽',
      description: '虐恋情深的古代耽美故事',
      keywords: ['虐恋', '虐文', '误会', '折磨', '心痛', '情深', '虐心', '虐身', '虐恋情深', '追妻火葬场', '替身梗', '虐受', '虐攻', '玻璃渣', 'be'],
      exampleTitles: ['十大酷刑', '北京故事', '蓝宇', '断背山', '霜花店']
    },
    {
      id: 'shitu_danmei',
      name: '师徒年下',
      description: '师父与徒弟之间的年下爱情',
      keywords: ['师徒', '年下', '师父', '徒弟', '年下攻', '年上受', '师徒恋', '年下恋', '师生恋', '师徒文', '尊师重道', '一日为师终身为父', '师徒情深', '师徒cp', '年下养成'],
      exampleTitles: ['人渣反派自救系统', '穿书自救指南', '魔道祖师', '天官赐福', '二哈和他的白猫师尊']
    },
    {
      id: 'diwang_danmei',
      name: '帝王将相',
      description: '帝王与将相之间的爱情故事',
      keywords: ['帝王', '皇帝', '将军', '丞相', '帝王将相', '帝王攻', '帝王受', '将军攻', '丞相受', '君臣', '君后', '帝后', '帝丞', '帝将', '皇权'],
      exampleTitles: ['将进酒', '杀破狼', '默读', '镇魂', '残次品']
    },
    {
      id: 'chuanyue_gudai_dm',
      name: '穿越古耽',
      description: '穿越到古代的耽美爱情故事',
      keywords: ['穿越', '穿越到古代', '古代穿越', '穿越文', '穿越耽', '穿书', '穿成', '穿越成', '灵魂穿越', '时空穿越', '穿越回', '穿越古代', '现代穿越', '穿越系统', '异世'],
      exampleTitles: ['魔道祖师', '天官赐福', '人渣反派自救系统', '穿书自救指南', '天宝伏妖录']
    }
  ],
  weights: { character: 0.3, foreshadow: 0.15, technique: 0.15, style: 0.15, rhythm: 0.1, structure: 0.15 }
};

const MENGBAO_TIANCHONG: GenreConfig = {
  id: 'mengbao_tianchong',
  name: '萌宝甜宠',
  category: 'female',
  description: '以萌娃宝宝为特色的甜宠文，包含萌宝神助攻、爹地追妻等梗',
  personalityTags: [
    '软萌可爱', '古灵精怪', '人小鬼大', '聪明伶俐', '天真烂漫', '呆萌', '傲娇', '腹黑',
    '小大人', '懂事', '贴心', '暖心', '奶声奶气', '萌萌哒', '可爱暴击', '小恶魔',
    '小天使', '戏精', '表演帝', '小财迷', '小吃货', '小懒虫', '小调皮', '小捣蛋',
    '护母狂魔', '护爹狂魔', '神助攻', '小大人', '小管家婆', '小老头', '人精', '小机灵鬼',
    '小霸王', '小公主', '小少爷', '小奶包', '小糯米', '小团子', '小汤圆'
  ],
  abilityTypes: [
    '卖萌', '装可怜', '装无辜', '神助攻', '牵红线', '撮合父母', '坑爹', '坑妈', '童言无忌',
    '语出惊人', '小大人说教', '暖心安慰', '保护欲', '撒娇', '耍脾气', '闹别扭', '吃醋',
    '天才智商', '过目不忘', '计算机天赋', '经商头脑', '艺术天赋', '音乐天赋', '绘画天赋',
    '厨艺小能手', '小大人式照顾人', '看人很准', '小福尔摩斯', '小侦探', '小谈判专家',
    '系统', '金手指', '预知', '读心', '空间', '灵泉', '异能', '超能力', '穿越', '重生'
  ],
  roleTypes: [
    '萌宝儿子', '萌宝女儿', '双胞胎萌宝', '龙凤胎', '三胞胎', '男主角（爹地）', '女主角（妈咪）',
    '男配', '女配', '反派', '霸道总裁爹地', '天才萌宝', '萌宝神助攻', '爷爷', '奶奶',
    '外公', '外婆', '叔叔', '阿姨', '舅舅', '姑姑', '幼儿园老师', '小朋友', '同学',
    '邻居', '朋友', '合作伙伴', '情敌', '前男友', '前女友', '秘书', '助理',
    '管家', '保姆', '司机', '保镖', '医生', '护士', '律师', '设计师', '明星'
  ],
  backgroundTypes: [
    '豪华别墅', '总裁办公室', '高档小区', '幼儿园', '小学', '游乐园', '动物园', '公园',
    '商场', '超市', '餐厅', '咖啡厅', '蛋糕店', '玩具店', '童装店', '儿童乐园',
    '海边度假', '温泉酒店', '滑雪场', '迪士尼乐园', '国外旅游', '爷爷奶奶家', '外公外婆家',
    '医院', '诊所', '机场', '高铁站', '私人飞机', '豪华游艇', '赛车场', '高尔夫球场',
    '宴会厅', '拍卖会', '时尚发布会', '电影院', '剧场', '图书馆', '博物馆', '水族馆',
    '科技馆', '少年宫', '兴趣班', '补习班', '夏令营', '冬令营'
  ],
  techniques: [
    { id: 'mengbao_001', name: '萌宝神助攻', category: 'cool_point', description: '萌宝帮父母牵红线，是父母感情的神助攻', keywords: ['萌宝', '神助攻', '牵红线', '撮合', '宝宝'], baseConfidence: 0.85, genreWeight: 2.0 },
    { id: 'mengbao_002', name: '爹地追妻', category: 'structure', description: '男主带着萌宝追求女主，萌宝帮忙追妻', keywords: ['爹地追妻', '追妻', '追妻火葬场', '爹地', '追老婆'], baseConfidence: 0.8, genreWeight: 1.9 },
    { id: 'mengbao_003', name: '天才萌宝', category: 'cool_point', description: '萌宝智商爆表，是个小天才', keywords: ['天才萌宝', '天才', '智商高', '神童', '小天才'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'mengbao_004', name: '萌宝坑爹', category: 'emotion', description: '萌宝各种坑爹，闹出很多笑话', keywords: ['坑爹', '坑妈', '萌宝坑爹', '搞笑', '乌龙'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'mengbao_005', name: '萌宝认亲', category: 'structure', description: '萌宝找到亲生父亲，父子/父女相认', keywords: ['认亲', '找爸爸', '亲生父亲', '相认', '父子相认'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'mengbao_006', name: '甜宠无虐', category: 'emotion', description: '全程高甜无虐，一家三口温馨幸福', keywords: ['甜宠', '宠溺', '无虐', '高甜', '温馨'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'mengbao_007', name: '霸道总裁爹地', category: 'cool_point', description: '男主是霸道总裁，对老婆孩子都很宠', keywords: ['霸道总裁', '总裁爹地', '霸道', 'CEO', '总裁'], baseConfidence: 0.8, genreWeight: 1.9 },
    { id: 'mengbao_008', name: '萌宝吃醋', category: 'emotion', description: '萌宝吃爹地/妈咪的醋，超级可爱', keywords: ['吃醋', '萌宝吃醋', '争宠', '小吃醋', '可爱'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'mengbao_009', name: '童言无忌', category: 'emotion', description: '萌宝说的话天真可爱，语出惊人', keywords: ['童言无忌', '语出惊人', '天真', '可爱', '萌'], baseConfidence: 0.75, genreWeight: 1.6 },
    { id: 'mengbao_010', name: '萌宝护短', category: 'emotion', description: '萌宝保护爹地/妈咪，护短狂魔', keywords: ['护短', '保护', '护母狂魔', '护爹狂魔', '霸气'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'mengbao_011', name: '双胞胎萌宝', category: 'structure', description: '双胞胎萌宝，性格各异，双倍可爱', keywords: ['双胞胎', '龙凤胎', '双生子', '两个宝宝', '双倍可爱'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'mengbao_012', name: '萌宝当家', category: 'structure', description: '萌宝小小年纪就当家作主，照顾父母', keywords: ['萌宝当家', '小大人', '当家', '照顾人', '懂事'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'mengbao_013', name: '带球跑', category: 'structure', description: '女主怀着孩子离开，多年后带着萌宝回归', keywords: ['带球跑', '带着孩子', '离开', '回归', '五年后'], baseConfidence: 0.8, genreWeight: 1.9 },
    { id: 'mengbao_014', name: '萌宝找爹', category: 'structure', description: '萌宝自己找爸爸，闹出很多乌龙', keywords: ['找爸爸', '找爹地', '萌宝找爹', '寻亲', '爸爸在哪'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'mengbao_015', name: '萌宝治愈', category: 'emotion', description: '萌宝用纯真治愈大人的心灵创伤', keywords: ['治愈', '暖心', '温暖', '治愈系', '小天使'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'mengbao_016', name: '萌宝打脸', category: 'cool_point', description: '萌宝人小力量大，帮父母打脸反派', keywords: ['打脸', '萌宝打脸', '虐渣', '小大人', '霸气'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'mengbao_017', name: '萌宝撒娇', category: 'emotion', description: '萌宝撒娇卖萌，谁都抵挡不住', keywords: ['撒娇', '卖萌', '撒娇卖萌', '抵挡不住', '可爱暴击'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'mengbao_018', name: '萌宝吃货', category: 'emotion', description: '萌宝是个小吃货，为了吃什么都愿意做', keywords: ['吃货', '小吃货', '爱吃', '美食', '小馋猫'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'mengbao_019', name: '萌宝财迷', category: 'emotion', description: '萌宝是个小财迷，爱钱如命', keywords: ['财迷', '小财迷', '爱钱', '存钱罐', '零花钱'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'mengbao_020', name: '一家三口', category: 'emotion', description: '一家三口温馨幸福的日常', keywords: ['一家三口', '幸福', '温馨', '日常', '一家人'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'mengbao_021', name: '萌宝戏精', category: 'emotion', description: '萌宝是个小戏精，各种表演让人哭笑不得', keywords: ['戏精', '表演帝', '演戏', '小戏骨', '影帝'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'mengbao_022', name: '萌宝侦探', category: 'structure', description: '萌宝化身小侦探，调查父母的感情问题', keywords: ['侦探', '小侦探', '调查', '发现秘密', '小福尔摩斯'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'mengbao_023', name: '萌宝系统', category: 'genre', description: '萌宝获得系统金手指，帮助父母', keywords: ['系统', '金手指', '萌宝系统', '任务', '奖励'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'mengbao_024', name: '软萌可爱风', category: 'style', description: '整体风格软萌可爱，让人心情愉悦', keywords: ['软萌', '可爱', '风格', '治愈', '轻松'], baseConfidence: 0.75, genreWeight: 1.6 },
    { id: 'mengbao_025', name: '温馨日常', category: 'style', description: '温馨甜蜜的日常生活，细水长流的幸福', keywords: ['温馨', '日常', '甜蜜', '细水长流', '幸福'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'mengbao_026', name: '萌宝交友', category: 'structure', description: '萌宝在幼儿园交新朋友，引出新剧情', keywords: ['交友', '幼儿园', '小朋友', '新朋友', '小伙伴'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'mengbao_027', name: '隔代亲', category: 'emotion', description: '爷爷奶奶/外公外婆对萌宝的隔代亲', keywords: ['隔代亲', '爷爷奶奶', '外公外婆', '宠爱', '祖孙'], baseConfidence: 0.7, genreWeight: 1.5 }
  ],
  subGenres: [
    {
      id: 'tiancai_mengbao',
      name: '天才萌宝',
      description: '智商爆表的天才萌宝帮助父母走到一起',
      keywords: ['天才萌宝', '天才', '智商高', '神童', '小天才', '萌宝天才', '天才宝宝', '高智商', '过目不忘', '小大人', '天才儿子', '天才女儿', '智商碾压', '小神童', '萌宝学霸'],
      exampleTitles: ['天才儿子腹黑娘亲', '天才宝宝甜心妈', '天才儿子萝莉妈', '亿万老婆买一送一', '总裁的替身前妻']
    },
    {
      id: 'diedi_zhuiqi',
      name: '爹地追妻',
      description: '男主带着萌宝追求女主的甜宠故事',
      keywords: ['爹地追妻', '追妻', '追妻火葬场', '爹地', '追老婆', '总裁追妻', '带着宝宝追妻', '萌宝助攻追妻', '追妻路漫漫', '追妻宝典', '追妻三十六计', '追妻火葬场', '追妻之路', '追妻系统', '追妻攻略'],
      exampleTitles: ['亿万老婆买一送一', '总裁的替身前妻', '天才儿子腹黑娘亲', '天才宝宝甜心妈', '天才儿子萝莉妈']
    },
    {
      id: 'daiqiu_pao',
      name: '带球跑',
      description: '女主怀着孩子离开，多年后带着萌宝回归',
      keywords: ['带球跑', '带着孩子', '离开', '回归', '五年后', '带球', '带球跑文', '怀孕离开', '携子归来', '五年后归来', '带着宝宝回来', '消失几年后', '带球跑总裁', '带球跑言情', '带球跑萌宝'],
      exampleTitles: ['亿万老婆买一送一', '总裁的替身前妻', '天才儿子腹黑娘亲', '天才宝宝甜心妈', '天才儿子萝莉妈']
    },
    {
      id: 'tianchong_mengbao',
      name: '甜宠萌宝',
      description: '全程高甜无虐的萌宝甜宠文',
      keywords: ['甜宠', '宠溺', '无虐', '高甜', '温馨', '甜文', '宠文', '撒糖', '甜蜜', '宠妻', '宠娃', '超甜', '甜到齁', '甜宠文', '全程甜'],
      exampleTitles: ['微微一笑很倾城', '何以笙箫默', '杉杉来吃', '亲爱的热爱的', '你是我的荣耀']
    },
    {
      id: 'shuangbao_tai',
      name: '双胞胎萌宝',
      description: '双胞胎或多胞胎萌宝的故事，双倍可爱',
      keywords: ['双胞胎', '龙凤胎', '双生子', '两个宝宝', '双倍可爱', '三胞胎', '多胞胎', '龙凤宝宝', '双胞胎萌宝', '双胎', '双子', '双生', '一模一样', '性格迥异', '可爱加倍'],
      exampleTitles: ['亿万老婆买一送一', '总裁的替身前妻', '天才儿子腹黑娘亲', '龙凤宝宝之总裁爹地', '双胞胎宝宝：爹地妈咪超相爱']
    },
    {
      id: 'mengbao_renqin',
      name: '萌宝认亲',
      description: '萌宝找到亲生父亲，父子/父女相认',
      keywords: ['认亲', '找爸爸', '亲生父亲', '相认', '父子相认', '父女相认', '萌宝认亲', '寻找父亲', '滴血认亲', 'DNA鉴定', '亲子鉴定', '认祖归宗', '找爹地', '萌宝寻亲', '父子重逢'],
      exampleTitles: ['亿万老婆买一送一', '总裁的替身前妻', '天才儿子腹黑娘亲', '天才宝宝甜心妈', '天才儿子萝莉妈']
    },
    {
      id: 'zongcai_mengbao',
      name: '总裁萌宝',
      description: '霸道总裁爹地和萌宝的故事',
      keywords: ['总裁', '霸道总裁', '总裁爹地', 'CEO', '豪门', '总裁文', '总裁的宝宝', '总裁的儿子', '总裁的女儿', '霸道总裁爱上我', '总裁爹地超给力', '总裁爹地宠上天', '霸道总裁的萌宝', '总裁的天才萌宝', '总裁的小萌妻'],
      exampleTitles: ['亿万老婆买一送一', '总裁的替身前妻', '杉杉来吃', '何以笙箫默', '微微一笑很倾城']
    },
    {
      id: 'mengbao_xitong',
      name: '萌宝系统',
      description: '萌宝获得系统金手指，帮助父母',
      keywords: ['系统', '金手指', '萌宝系统', '任务', '奖励', '系统流', '宝宝系统', '萌宝神系统', '助攻系统', '牵线系统', '红娘系统', '恋爱系统', '爸妈恋爱系统', '萌宝有系统', '系统萌宝'],
      exampleTitles: ['萌宝系统：总裁爹地追妻记', '萌宝神助攻：爹地妈咪要和好', '系统萌宝：爹地追妻路漫漫', '萌宝助攻系统', '萌宝红娘系统']
    },
    {
      id: 'wenxin_richang',
      name: '温馨日常',
      description: '一家三口温馨幸福的日常生活',
      keywords: ['温馨', '日常', '甜蜜', '细水长流', '幸福', '一家三口', '一家四口', '家常', '生活', '平凡幸福', '温馨日常', '甜日常', '平淡生活', '岁月静好', '现世安稳'],
      exampleTitles: ['微微一笑很倾城', '何以笙箫默', '杉杉来吃', '亲爱的热爱的', '你是我的荣耀']
    }
  ],
  weights: { character: 0.25, foreshadow: 0.05, technique: 0.2, style: 0.2, rhythm: 0.15, structure: 0.15 }
};

const ZHICHANG_HUNLIAN: GenreConfig = {
  id: 'zhichang_hunlian',
  name: '职场婚恋',
  category: 'female',
  description: '现代都市职场背景的恋爱婚姻故事，包含职场奋斗、婚恋纠葛',
  personalityTags: [
    '独立自主', '温柔体贴', '清冷孤傲', '腹黑', '白切黑', '病娇', '傲娇', '隐忍',
    '坚韧不拔', '敢爱敢恨', '天真烂漫', '心机深沉', '杀伐果断', '外冷内热', '痴情专一',
    '温婉可人', '活泼开朗', '内向害羞', '强势霸道', '自尊心强', '敏感多疑', '缺爱',
    '乐观向上', '自卑怯懦', '阳光开朗', '阴郁深沉', '毒舌', '闷骚', '护短', '圣母',
    '白莲', '绿茶', '傻白甜', '女强人', '御姐', '职场精英', '工作狂'
  ],
  abilityTypes: [
    '设计', '编程', '医术', '律师', '金融', '投资', '厨艺', '绘画', '音乐', '舞蹈',
    '演技', '唱歌', '写作', '翻译', '摄影', '商业天才', '黑客技术', '心理学',
    '谈判能力', '演讲口才', '管理能力', '领导力', '执行力', '策划能力', '文案能力',
    '销售能力', '市场分析', '财务能力', '人力资源', '行政能力', '公关能力',
    '武术', '格斗', '赛车', '调酒', '咖啡', '花艺', '烘焙', '美妆', '服装搭配'
  ],
  roleTypes: [
    '女主角', '男主角', '男二号', '女二号', '反派女配', '反派男配', '霸道总裁',
    '职场上司', '同事', '闺蜜', '情敌', '前男友', '前女友', '家族长辈',
    '父母', '兄弟姐妹', '客户', '合作伙伴', '老板', '秘书', '助理',
    '竞争对手', '下属', '实习生', '部门经理', '总监', 'CEO', '董事长',
    'HR', '财务', '市场', '销售', '产品经理', '程序员', '设计师', '律师',
    '医生', '老师', '记者', '经纪人', '客户', '投资人', '股东'
  ],
  backgroundTypes: [
    '一线城市CBD', '高档写字楼', '豪华别墅', '大学校园', '公司职场', '办公室',
    '会议室', '茶水间', '电梯', '停车场', '员工餐厅', '公司年会', '团建活动',
    '出差酒店', '项目现场', '客户公司', '高级餐厅', '咖啡厅', '酒吧夜店',
    '购物中心', '机场高铁站', '公寓小区', '海边度假村', '温泉酒店', '滑雪场',
    '古镇旅游', '国外出差', '出租屋', '合租房', '地下室', '城中村',
    '健身房', '美容院', '购物中心', '超市', '菜市场', '医院', '律师事务所',
    '设计工作室', '画廊', '音乐厅', '电视台', '影视城'
  ],
  techniques: [
    { id: 'zhichang_001', name: '霸道总裁', category: 'cool_point', description: '男主是霸道多金的总裁，对女主霸道又宠溺', keywords: ['总裁', '霸道', 'CEO', '豪门', '霸道总裁'], baseConfidence: 0.85, genreWeight: 2.0 },
    { id: 'zhichang_002', name: '契约婚姻', category: 'structure', description: '男女主因某种原因签订契约结婚，假戏真做', keywords: ['契约', '协议', '结婚', '假婚', '交易'], baseConfidence: 0.8, genreWeight: 1.9 },
    { id: 'zhichang_003', name: '追妻火葬场', category: 'emotion', description: '男主前期不珍惜女主，后期后悔疯狂追妻', keywords: ['追妻', '火葬场', '后悔', '珍惜', '挽回'], baseConfidence: 0.85, genreWeight: 1.9 },
    { id: 'zhichang_004', name: '替身梗', category: 'emotion', description: '女主因为像男主的白月光而被选中，后来男主真爱女主', keywords: ['替身', '白月光', '像', '代替', '真爱'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'zhichang_005', name: '职场奋斗', category: 'structure', description: '女主在职场中奋斗成长，从基层晋升到高位', keywords: ['职场', '奋斗', '晋升', '成长', '升职加薪'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'zhichang_006', name: '先婚后爱', category: 'structure', description: '男女主先结婚后恋爱，在相处中渐生情愫', keywords: ['先婚后爱', '婚姻', '相处', '日久生情', '联姻'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'zhichang_007', name: '甜宠无虐', category: 'emotion', description: '全程高甜无虐，男主宠女主宠上天', keywords: ['甜宠', '宠妻', '无虐', '高甜', '宠溺'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'zhichang_008', name: '虐恋情深', category: 'emotion', description: '男女主之间爱得很痛苦，误会重重彼此折磨', keywords: ['虐恋', '误会', '折磨', '心痛', '情深'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'zhichang_009', name: '办公室恋情', category: 'genre', description: '男女主在职场中相识相恋，办公室地下情', keywords: ['办公室', '职场', '同事', '上司', '下属'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'zhichang_010', name: '职场竞争', category: 'structure', description: '职场中的明争暗斗，女主凭实力脱颖而出', keywords: ['竞争', '明争暗斗', '职场斗争', '升职', '上位'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'zhichang_011', name: '破镜重圆', category: 'emotion', description: '曾经分开的情侣多年后重逢再续前缘', keywords: ['破镜重圆', '重逢', '复合', '旧情', '再遇'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'zhichang_012', name: '青梅竹马', category: 'emotion', description: '从小一起长大的男女主之间的感情', keywords: ['青梅竹马', '从小', '长大', '邻居', '玩伴'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'zhichang_013', name: '一见钟情', category: 'emotion', description: '男女主第一次见面就爱上对方', keywords: ['一见钟情', '初见', '心动', '一眼', '沦陷'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'zhichang_014', name: '日久生情', category: 'emotion', description: '在长期相处中慢慢产生感情', keywords: ['日久生情', '相处', '陪伴', '习惯', '渐渐'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'zhichang_015', name: '豪门恩怨', category: 'structure', description: '豪门家族内部的权力斗争和情感纠葛', keywords: ['豪门', '家族', '恩怨', '内斗', '争产'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'zhichang_016', name: '单亲妈妈', category: 'structure', description: '女主带着孩子独自生活，后来遇到男主', keywords: ['单亲', '妈妈', '孩子', '独自', '宝宝'], baseConfidence: 0.65, genreWeight: 1.5 },
    { id: 'zhichang_017', name: '萌宝神助攻', category: 'structure', description: '萌娃帮助父母走到一起的可爱故事', keywords: ['萌宝', '神助攻', '宝宝', '儿子', '女儿'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'zhichang_018', name: '打脸虐渣', category: 'cool_point', description: '女主狠狠打脸白莲花、绿茶女配和渣男', keywords: ['打脸', '虐渣', '白莲花', '绿茶', '渣男'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'zhichang_019', name: '女强男强', category: 'genre', description: '男女主都是强者，势均力敌的爱情', keywords: ['女强', '男强', '势均力敌', '强强联合', '双强'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'zhichang_020', name: '年龄差', category: 'emotion', description: '男女主之间有较大年龄差的爱情', keywords: ['年龄差', '大叔', '萝莉', '年上', '年下'], baseConfidence: 0.6, genreWeight: 1.3 },
    { id: 'zhichang_021', name: '误会重重', category: 'emotion', description: '因为各种误会导致的情感波折', keywords: ['误会', '解释', '错过', '误解', '澄清'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'zhichang_022', name: '双向奔赴', category: 'emotion', description: '男女主互相爱慕，共同走向对方', keywords: ['双向', '奔赴', '互相', '彼此', '相爱'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'zhichang_023', name: '暗恋成真', category: 'emotion', description: '主角暗恋对方多年，最终修成正果', keywords: ['暗恋', '单恋', '喜欢', '偷偷', '成真'], baseConfidence: 0.65, genreWeight: 1.5 },
    { id: 'zhichang_024', name: '闪婚厚爱', category: 'structure', description: '认识不久就结婚，婚后逐渐相爱', keywords: ['闪婚', '厚爱', '快速', '结婚', '婚后'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'zhichang_025', name: '细腻心理刻画', category: 'style', description: '现代言情注重人物心理活动的细腻描写', keywords: ['心理', '细腻', '内心', '感受', '情绪'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'zhichang_026', name: '职场专业度', category: 'style', description: '展现职场专业度和行业知识', keywords: ['专业', '职场', '行业', '专业度', '职业'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'zhichang_027', name: '都市氛围感', category: 'style', description: '营造现代都市特有的氛围和生活气息', keywords: ['都市', '氛围', '现代', '生活', '气息'], baseConfidence: 0.65, genreWeight: 1.5 }
  ],
  subGenres: [
    {
      id: 'zongcai_zhichang',
      name: '总裁职场',
      description: '霸道总裁与职场女主的爱情故事',
      keywords: ['总裁', '霸道', 'CEO', '豪门', '霸道总裁', '总裁文', '豪门总裁', '总裁的', '总裁大人', '亿万总裁', '霸道总裁爱上我', '总裁爹地', '总裁老公', '总裁在上', '豪门恩怨'],
      exampleTitles: ['何以笙箫默', '霸道总裁爱上我', '总裁的替身前妻', '亿万老婆买一送一', '总裁的33日索情']
    },
    {
      id: 'bangongshi_lianqing',
      name: '办公室恋情',
      description: '同事或上下级之间的办公室恋情',
      keywords: ['办公室', '职场', '同事', '上司', '下属', '办公室恋情', '办公室爱情', '职场恋爱', '同事恋', '上下级', '职场情缘', '职场爱情', '霸道上司', '职场精英', '办公室地下情'],
      exampleTitles: ['杜拉拉升职记', '欢乐颂', '我的前半生', '三十而已', '下一站是幸福']
    },
    {
      id: 'zhichang_fendou',
      name: '职场奋斗',
      description: '女主在职场中奋斗成长的励志故事',
      keywords: ['职场', '奋斗', '晋升', '成长', '升职加薪', '职场奋斗', '职场成长', '事业', '打拼', '努力', '升职', '加薪', '职场逆袭', '职场晋升', '从基层到高层'],
      exampleTitles: ['杜拉拉升职记', '欢乐颂', '我的前半生', '三十而已', '都挺好']
    },
    {
      id: 'xianhunhouai_zc',
      name: '先婚后爱',
      description: '男女主先结婚后恋爱，在相处中渐生情愫',
      keywords: ['先婚后爱', '婚姻', '相处', '日久生情', '联姻', '契约婚姻', '闪婚厚爱', '先结婚后恋爱', '婚后相处', '协议婚姻', '假戏真做', '先嫁后爱', '婚后恋', '夫妻', '合约夫妻'],
      exampleTitles: ['锦心似玉', '知否知否', '传闻中的陈芊芊', '芸汐传', '双世宠妃']
    },
    {
      id: 'pojing_chongyuan_zc',
      name: '破镜重圆',
      description: '曾经分开的情侣多年后重逢再续前缘',
      keywords: ['破镜重圆', '重逢', '复合', '旧情', '再遇', '破镜', '重圆', '再续前缘', '旧爱', '重逢文', '多年后', '再相遇', '重修旧好', '回心转意', '失而复得'],
      exampleTitles: ['何以笙箫默', '佳期如梦', '致我们终将逝去的青春', '匆匆那年', '后来的我们']
    },
    {
      id: 'nüqiang_nanqiang',
      name: '女强男强',
      description: '男女主都是强者，势均力敌的爱情',
      keywords: ['女强', '男强', '势均力敌', '强强联合', '双强', '强强', '强女', '强男', '势均力敌', '棋逢对手', '将遇良才', '双强联手', '强强对决', '双强文', '强女主'],
      exampleTitles: ['欢乐颂', '都挺好', '我的前半生', '三十而已', '流金岁月']
    },
    {
      id: 'tiangou_danlian',
      name: '舔狗单恋',
      description: '一方默默付出的单恋故事',
      keywords: ['暗恋', '单恋', '舔狗', '默默付出', '一厢情愿', '单相思', '暗恋成真', '单恋文', '暗恋文', '默默喜欢', '偷偷喜欢', '一厢情愿', '单向奔赴', '暗恋逆袭', '单恋逆袭'],
      exampleTitles: ['暗恋橘生淮南', '致我们单纯的小美好', '小时代', '夏至未至', '那些年我们一起追的女孩']
    },
    {
      id: 'hunyin_baowei',
      name: '婚姻保卫',
      description: '婚姻出现危机，女主保卫婚姻的故事',
      keywords: ['婚姻', '保卫婚姻', '婚姻危机', '出轨', '小三', '婚姻保卫战', '夫妻关系', '家庭危机', '婚姻修复', '挽回婚姻', '婚姻生活', '婚内情', '婚姻物语', '婚姻那些事', '婚姻与爱情'],
      exampleTitles: ['我的前半生', '都挺好', '三十而已', '白色月光', '安家']
    },
    {
      id: 'chuangye_qingchun',
      name: '创业青春',
      description: '男女主一起创业奋斗的青春故事',
      keywords: ['创业', '奋斗', '青春', '梦想', '创业故事', '合伙人', '创业之路', '创业艰辛', '创业成功', '创业失败', '创业伙伴', '创业夫妻', '创业情侣', '创业时代', '创业励志'],
      exampleTitles: ['创业时代', '都挺好', '欢乐颂', '我的前半生', '流金岁月']
    }
  ],
  weights: { character: 0.25, foreshadow: 0.1, technique: 0.2, style: 0.15, rhythm: 0.15, structure: 0.15 }
};

const QINGXIAOSHUO: GenreConfig = {
  id: 'qingxiaoshuo',
  name: '轻小说',
  category: 'neutral',
  description: '以轻小说风格创作，包含轻松搞笑、日常、校园恋爱等元素',
  personalityTags: [
    '温柔体贴', '傲娇', '病娇', '三无', '腹黑', '天然呆', '元气满满', '高冷',
    '沙雕', '中二', '热血', '冷静', '机智', '迟钝', '害羞', '开朗',
    '慵懒', '认真', '调皮', '毒舌', '闷骚', '护短', '贱兮兮', '装逼犯',
    '老银币', '外冷内热', '白切黑', '亦正亦邪', '随性洒脱', '重情重义', '阳光开朗', '阴郁深沉',
    '呆毛', '吃货', '路痴', '音痴', '运动白痴', '学霸', '学渣', '温柔治愈',
    '吐槽役', '主人公', '女主角', '路人男主'
  ],
  abilityTypes: [
    '超能力', '魔法', '异能', '念力', '瞬间移动', '时间停止', '时间回溯', '空间移动', '隐身', '透视',
    '读心术', '预知未来', '不死之身', '再生能力', '变身', '召唤', '契约', '系统', '金手指', '技能面板',
    '剑术', '格斗术', '枪术', '弓术', '忍术', '咒术', '灵力', '妖力', '神力', '魔力',
    '精灵魔法', '龙之力', '恶魔之力', '天使之力', '神圣力量', '黑暗力量', '元素操控', '精神力量',
    '黑客技术', '游戏技术', '料理能力', '绘画能力', '音乐天赋', '演技', '学习能力', '语言天赋',
    '吐槽能力', '把妹能力', '亚撒西', '迟钝技能'
  ],
  roleTypes: [
    '男主角', '女主角', '女配角', '男配角', '反派BOSS', '青梅竹马', '转学生', '班长', '学生会长',
    '风纪委员', '社团社长', '幽灵', '妖怪', '精灵', '恶魔', '天使', '神明', '外星人',
    '机器人', '人造人', '魔法少女', '勇者', '魔王', '龙傲天', '穿越者', '转生者',
    '系统精灵', '导师', '前辈', '后辈', '同学', '老师', '家长', '邻居', '网友',
    '游戏好友', '竞争对手', '战友', '宿敌', '妹妹', '姐姐', '弟弟', '哥哥',
    '吐槽役', '路人', '迷之少女', '不可思议的人'
  ],
  backgroundTypes: [
    '现代校园', '高中学校', '大学校园', '中学教室', '学生会室', '社团活动室', '学校天台', '学校操场',
    '学校图书馆', '学校食堂', '樱花树下', '学生宿舍', '学园祭', '文化祭', '体育祭', '修学旅行',
    '异世界', '幻想世界', '魔法世界', '剑与魔法的世界', '游戏世界', '虚拟世界', '未来都市',
    '末日世界', '妖怪世界', '神界', '魔界', '精灵国度', '地下城', '冒险者公会', '魔王城',
    '海边', '夏日祭', '烟火大会', '温泉旅馆', '游乐园', '咖啡厅', '便利店', '家庭餐厅',
    '漫展', '同人志即卖会', '秋叶原', '动漫店', '游戏中心', '轻小说部', '文学社'
  ],
  techniques: [
    { id: 'qingxiaoshuo_001', name: '异世界穿越', category: 'genre', description: '主角穿越或转生到异世界，开启第二人生', keywords: ['异世界', '穿越', '转生', '穿越到', '转生到'], baseConfidence: 0.85, genreWeight: 2.0 },
    { id: 'qingxiaoshuo_002', name: '校园日常', category: 'genre', description: '以校园生活为背景的轻松日常故事', keywords: ['校园', '日常', '学校', '学生', '校园生活'], baseConfidence: 0.8, genreWeight: 1.9 },
    { id: 'qingxiaoshuo_003', name: '吐槽役主角', category: 'style', description: '主角负责吐槽，各种梗和笑点不断', keywords: ['吐槽', '吐槽役', '梗', '搞笑', '笑点'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'qingxiaoshuo_004', name: '后宫成群', category: 'emotion', description: '各种类型的美少女围绕在主角身边', keywords: ['后宫', '美少女', '妹子', '女主们', '环绕'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'qingxiaoshuo_005', name: '系统加身', category: 'cool_point', description: '主角获得系统金手指，人生开挂', keywords: ['系统', '金手指', '任务', '奖励', '面板'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'qingxiaoshuo_006', name: '学院战斗', category: 'structure', description: '在学院中进行的战斗比赛或能力对决', keywords: ['学院', '战斗', '比赛', '对决', '能力'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'qingxiaoshuo_007', name: '萌系日常', category: 'style', description: '轻松治愈的萌系日常，可爱角色卖萌', keywords: ['萌', '治愈', '可爱', '卖萌', '轻松'], baseConfidence: 0.75, genreWeight: 1.6 },
    { id: 'qingxiaoshuo_008', name: '中二病发作', category: 'style', description: '充满中二气息的设定和台词', keywords: ['中二', '中二病', '邪气眼', '漆黑烈焰使', '幻想'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'qingxiaoshuo_009', name: '社团活动', category: 'structure', description: '围绕社团活动展开的青春故事', keywords: ['社团', '社团活动', '部活', '社团活动室', '部长'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'qingxiaoshuo_010', name: '青梅竹马', category: 'emotion', description: '从小一起长大的青梅竹马的感情线', keywords: ['青梅竹马', '幼驯染', '从小', '邻居', '玩伴'], baseConfidence: 0.75, genreWeight: 1.6 },
    { id: 'qingxiaoshuo_011', name: '转学生', category: 'structure', description: '神秘转学生的到来打破了平静的校园生活', keywords: ['转学生', '转学', '新同学', '神秘', '新来的'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'qingxiaoshuo_012', name: '学园祭', category: 'structure', description: '学园祭、文化祭等校园活动是重要剧情节点', keywords: ['学园祭', '文化祭', '校园活动', '校庆', '活动'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'qingxiaoshuo_013', name: '异世界建国', category: 'genre', description: '主角在异世界建立国家或势力', keywords: ['建国', '领地', '建设', '国家', '势力'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'qingxiaoshuo_014', name: '召唤勇者', category: 'genre', description: '主角被召唤到异世界成为勇者', keywords: ['召唤', '勇者', '异世界召唤', '勇者召唤', '魔法阵'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'qingxiaoshuo_015', name: '最弱无败', category: 'cool_point', description: '看似最弱的主角其实是最强的', keywords: ['最弱', '无败', '最强', '隐藏实力', '扮猪吃虎'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'qingxiaoshuo_016', name: '魔法学院', category: 'structure', description: '主角在魔法学院学习魔法的故事', keywords: ['魔法学院', '魔法学校', '学院', '学习魔法', '魔法师'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'qingxiaoshuo_017', name: '游戏人生', category: 'genre', description: '主角靠游戏技能或游戏知识在异世界开挂', keywords: ['游戏', '游戏人生', '游戏技能', '游戏知识', '玩家'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'qingxiaoshuo_018', name: '精灵耳', category: 'style', description: '精灵、兽人等亚人角色，萌属性满满', keywords: ['精灵', '兽耳', '猫耳', '狐耳', '亚人'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'qingxiaoshuo_019', name: '异世界食堂', category: 'genre', description: '以美食为主题的异世界温馨故事', keywords: ['美食', '食堂', '料理', '异世界食堂', '吃'], baseConfidence: 0.6, genreWeight: 1.3 },
    { id: 'qingxiaoshuo_020', name: '转生史莱姆', category: 'genre', description: '主角转生成非人类生物，在异世界发展', keywords: ['转生', '史莱姆', '非人类', '魔物', '异世界'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'qingxiaoshuo_021', name: '热血战斗', category: 'emotion', description: '热血沸腾的战斗场面，友情与努力的胜利', keywords: ['热血', '战斗', '友情', '努力', '胜利'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'qingxiaoshuo_022', name: '梗与吐槽', category: 'style', description: '充满动漫梗和角色吐槽，轻松搞笑', keywords: ['梗', '吐槽', '搞笑', '玩梗', 'neta'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'qingxiaoshuo_023', name: '夏日海边', category: 'structure', description: '海边、夏日祭等经典二次元场景', keywords: ['海边', '夏日', '泳装', '海边合宿', '夏日祭'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'qingxiaoshuo_024', name: '妹妹属性', category: 'emotion', description: '有妹妹角色，或妹控属性', keywords: ['妹妹', '义妹', '实妹', '妹控', '妹妹大人'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'qingxiaoshuo_025', name: '傲娇女主', category: 'emotion', description: '女主是典型的傲娇性格，口嫌体正直', keywords: ['傲娇', '蹭得累', '口嫌体正直', '傲娇女主', '哼'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'qingxiaoshuo_026', name: '异世界迷宫', category: 'structure', description: '探索异世界的迷宫地下城', keywords: ['迷宫', '地下城', '探索迷宫', '迷宫攻略', '地下迷宫'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'qingxiaoshuo_027', name: '画风突变', category: 'style', description: '时而认真时而沙雕，风格多变', keywords: ['画风突变', '搞笑', '严肃', '切换', '风格多变'], baseConfidence: 0.65, genreWeight: 1.4 }
  ],
  subGenres: [
    {
      id: 'isekai_qing',
      name: '异世界转生',
      description: '主角穿越或转生到异世界，开启第二人生',
      keywords: ['异世界', '穿越', '转生', '转生到', '穿越到', '异世界穿越', '异世界转生', '异世', '异界', '异世界生活', '穿越者', '转生者', '异世界冒险', '剑与魔法', '魔力'],
      exampleTitles: ['关于我转生变成史莱姆这档事', 'Re:从零开始的异世界生活', '无职转生', '刀剑神域', '游戏人生']
    },
    {
      id: 'xiaoyuan_qingchun_qing',
      name: '校园青春',
      description: '以校园生活为背景的青春恋爱喜剧',
      keywords: ['校园', '青春', '校园生活', '高中', '学生', '校园恋爱', '校园喜剧', '日常', '青春校园', '同学', '校园日常', '校园爱情', '青涩', '校服', '学生时代'],
      exampleTitles: ['我的青春恋爱物语果然有问题', '辉夜大小姐想让我告白', '青春猪头少年', '冰菓', 'CLANNAD']
    },
    {
      id: 'chaonengli_qing',
      name: '超能力战斗',
      description: '拥有超能力的角色之间的战斗故事',
      keywords: ['超能力', '异能', '能力者', '超能力者', '特异功能', '觉醒能力', '超能', '异能力', '能力', '特殊能力', '超自然', '念力', '空间能力', '时间能力', '元素能力'],
      exampleTitles: ['某科学的超电磁炮', '魔法禁书目录', '我的英雄学院', '一拳超人', '灵能百分百']
    },
    {
      id: 'mofa_xueyuan_qing',
      name: '魔法学院',
      description: '主角在魔法学院学习和成长的故事',
      keywords: ['魔法学院', '魔法学校', '学院', '学习魔法', '魔法师', '魔法学生', '魔法课', '学院大比', '魔法社团', '魔法战斗', '魔法老师', '魔法教材', '魔法实践', '学院都市', '魔导士'],
      exampleTitles: ['哈利波特', '魔法科高中的劣等生', '零之使魔', '妖精的尾巴', '魔导少年']
    },
    {
      id: 'rixi_hougong_qing',
      name: '日常后宫',
      description: '日常背景下的后宫恋爱喜剧',
      keywords: ['后宫', '美少女', '妹子', '恋爱喜剧', '后宫动漫', '女主们', '修罗场', '多女主', '后宫王', '艳遇', '桃花运', '妹子环绕', '萌妹子', '可爱女孩', '同居'],
      exampleTitles: ['约会大作战', '刀剑神域', '出包王女', '五等分的新娘', '我们无法一起学习']
    },
    {
      id: 'youxi_shijie_qing',
      name: '游戏世界',
      description: '主角进入游戏世界或穿越到游戏里',
      keywords: ['游戏世界', '游戏', '穿越游戏', '进入游戏', '游戏人生', '游戏技能', '游戏玩家', '虚拟现实游戏', 'VRMMO', '潜行游戏', '游戏化', '数据化', '游戏系统', '游戏攻略', '游戏NPC'],
      exampleTitles: ['刀剑神域', '记录的地平线', '游戏人生', 'Overlord', '因为太怕痛就全点防御力了']
    },
    {
      id: 'yaogui_lingyi_qing',
      name: '妖怪灵异',
      description: '妖怪、幽灵、灵异现象相关的故事',
      keywords: ['妖怪', '幽灵', '灵异', '鬼怪', '妖怪灵异', '阴阳师', '除灵', '灵能力者', '妖怪少女', '付丧神', '妖怪旅馆', '怪谈', '灵异事件', '驱魔', '式神'],
      exampleTitles: ['夏目友人帐', '犬夜叉', '滑头鬼之孙', '青之驱魔师', '境界的彼方']
    },
    {
      id: 'moyu_wangguo_qing',
      name: '魔王勇者',
      description: '勇者与魔王相关的奇幻故事',
      keywords: ['魔王', '勇者', '魔王城', '勇者斗魔王', '魔族', '人类军', '魔王大人', '勇者大人', '魔族公主', '魔王军', '四天王', '最终BOSS', '魔界', '勇者小队', '封印'],
      exampleTitles: ['魔王勇者', '打工吧！魔王大人', '传说中勇者的传说', '关于我转生变成史莱姆这档事', '异世界魔王与召唤少女的奴隶魔术']
    },
    {
      id: 'meishi_eryuan_qing',
      name: '美食轻小说',
      description: '以美食为主题的温馨轻小说',
      keywords: ['美食', '料理', '异世界食堂', '美食番', '吃', '好吃', '料理制作', '美食家', '异世界美食', '食堂', '餐厅', '甜点', '日式料理', '中华料理', '西餐'],
      exampleTitles: ['异世界食堂', '食戟之灵', '中华小当家', '卫宫家今天的饭', '请问您今天要来点兔子吗']
    }
  ],
  weights: { character: 0.25, foreshadow: 0.1, technique: 0.2, style: 0.2, rhythm: 0.15, structure: 0.1 }
};

const KONGBU_JINGSONG: GenreConfig = {
  id: 'kongbu_jingsong',
  name: '恐怖惊悚',
  category: 'neutral',
  description: '纯恐怖惊悚题材，以营造恐怖氛围、心理惊悚为主',
  personalityTags: [
    '冷静沉着', '胆小懦弱', '神经质', '偏执', '疯狂', '阴郁', '诡异', '神秘莫测',
    '正直善良', '亦正亦邪', '外冷内热', '毒舌', '闷骚', '腹黑', '重情重义', '睚眦必报',
    '护短', '贱兮兮', '装逼犯', '老银币', '白切黑', '杀伐果断', '贪生怕死', '神神叨叨',
    '疯疯癫癫', '大智若愚', '真人不露相', '铁齿铜牙', '一身正气', '邪气凛然',
    '看破红尘', '济世救人', '除魔卫道', '心理变态', '反社会', '连环杀手', '精神病患者'
  ],
  abilityTypes: [
    '通灵', '阴阳眼', '预知', '读心', '催眠', '幻术', '诅咒', '附身', '操控', '精神控制',
    '不死之身', '再生', '变形', '隐身', '穿墙', '悬浮', '念力', '时间操控', '空间操控', '黑暗力量',
    '巫术', '黑魔法', '血祭', '献祭', '召唤恶魔', '契约', '仪式', '蛊毒', '降头', '养鬼',
    '道术', '佛法', '圣光', '净化', '驱魔', '封印', '结界', '法器', '符咒', '桃木剑',
    '医术', '心理学', '犯罪心理', '侦查能力', '推理能力', '格斗术', '枪械精通', '爆破', '黑客技术'
  ],
  roleTypes: [
    '主角', '女主角', '男配', '女配', '反派BOSS', '连环杀手', '精神病患者', '变态',
    '鬼魂', '怨灵', '恶鬼', '厉鬼', '恶魔', '魔鬼', '怪物', '丧尸', '吸血鬼',
    '狼人', '僵尸', '食尸鬼', '幽灵', '邪灵', '恶灵', '魔神', '死神', '女巫',
    '巫师', '术士', '驱魔师', '道士', '和尚', '神父', '修女', '灵媒', '神婆',
    '警察', '侦探', '法医', '心理医生', '教授', '学生', '老师', '医生', '护士',
    '记者', '作家', '探险家', '盗墓贼', '守墓人', '幸存者', '受害者', '路人甲'
  ],
  backgroundTypes: [
    '废弃医院', '精神病院', '废弃学校', '旧宿舍楼', '凶宅', '鬼屋', '古宅', '老宅',
    '地下室', '阁楼', '电梯', '楼梯间', '厕所', '浴室', '镜子前', '井边',
    '河边', '湖边', '十字路口', '公交车', '地铁', '出租车', '电梯间', '走廊',
    '密室', '山洞', '古墓', '墓穴', '地宫', '祠堂', '城隍庙', '土地庙', '道观',
    '寺庙', '教堂', '神坛', '祭坛', '法坛', '乱葬岗', '坟场墓地', '殡仪馆', '火葬场',
    '太平间', '停尸房', '医院', '学校', '宿舍楼', '出租屋', '荒村', '深山老林',
    '孤岛', '雪山', '沙漠', '沼泽', '深海', '太空站', '实验室', '地下设施', '监狱'
  ],
  techniques: [
    { id: 'kongbu_001', name: '心理恐怖', category: 'style', description: '心理层面的恐怖，细思极恐，让人不寒而栗', keywords: ['心理恐怖', '细思极恐', '心理', '精神', '细思恐极'], baseConfidence: 0.85, genreWeight: 2.0 },
    { id: 'kongbu_002', name: 'jump scare', category: 'style', description: '突然出现的惊吓，让人吓一跳', keywords: ['突然', '惊吓', '吓一跳', 'jump scare', '猛地'], baseConfidence: 0.8, genreWeight: 1.9 },
    { id: 'kongbu_003', name: '氛围营造', category: 'style', description: '通过环境描写和气氛渲染营造恐怖氛围', keywords: ['氛围', '气氛', '营造', '渲染', '恐怖氛围'], baseConfidence: 0.85, genreWeight: 2.0 },
    { id: 'kongbu_004', name: '悬念迭起', category: 'structure', description: '悬念重重，真相一层层揭开，让人欲罢不能', keywords: ['悬念', '悬疑', '真相', '谜团', '揭秘'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'kongbu_005', name: '未知恐惧', category: 'style', description: '对未知事物的恐惧，未知才是最可怕的', keywords: ['未知', '未知恐惧', '不知道', '神秘', '未知事物'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'kongbu_006', name: '密闭空间', category: 'structure', description: '密闭空间中的恐怖事件，幽闭恐惧', keywords: ['密闭空间', '密室', '封闭', '幽闭', '逃不出去'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'kongbu_007', name: '鬼打墙', category: 'structure', description: '经典的鬼打墙桥段，怎么也走不出去', keywords: ['鬼打墙', '迷路', '走不出去', '循环', '绕圈'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'kongbu_008', name: '冤魂索命', category: 'structure', description: '冤死的鬼魂回来复仇索命', keywords: ['冤魂', '索命', '复仇', '厉鬼', '冤死'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'kongbu_009', name: '连环杀人', category: 'structure', description: '连环杀手的恐怖犯罪故事', keywords: ['连环杀人', '连环杀手', '凶手', '犯罪', '谋杀'], baseConfidence: 0.8, genreWeight: 1.8 },
    { id: 'kongbu_010', name: '丧尸围城', category: 'structure', description: '丧尸爆发，世界末日中的生存故事', keywords: ['丧尸', '末日', '生存', '围城', '活死人'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'kongbu_011', name: '古宅惊魂', category: 'structure', description: '古老宅子里的恐怖事件', keywords: ['古宅', '老宅', '凶宅', '鬼屋', '闹鬼'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'kongbu_012', name: '医院怪谈', category: 'structure', description: '医院里的恐怖怪谈和灵异事件', keywords: ['医院', '太平间', '停尸房', '怪谈', '灵异'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'kongbu_013', name: '校园怪谈', category: 'structure', description: '学校里的恐怖怪谈和灵异事件', keywords: ['校园', '学校', '怪谈', '校园怪谈', '灵异'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'kongbu_014', name: '都市传说', category: 'genre', description: '现代都市中的恐怖传说和怪谈', keywords: ['都市传说', '都市怪谈', '现代', '城市', '传说'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'kongbu_015', name: '民俗恐怖', category: 'genre', description: '基于民间民俗的恐怖故事', keywords: ['民俗', '民间', '习俗', '禁忌', '封建迷信'], baseConfidence: 0.75, genreWeight: 1.6 },
    { id: 'kongbu_016', name: '克苏鲁风格', category: 'genre', description: '克苏鲁神话风格的恐怖，不可名状的恐惧', keywords: ['克苏鲁', '不可名状', '旧日支配者', '深渊', 'san值'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'kongbu_017', name: '血腥暴力', category: 'style', description: '血腥暴力的恐怖场面，视觉冲击', keywords: ['血腥', '暴力', '残忍', '恶心', '重口'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'kongbu_018', name: '层层递进', category: 'rhythm', description: '恐怖程度层层递进，越来越吓人', keywords: ['层层递进', '递进', '升级', '越来越恐怖', '加剧'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'kongbu_019', name: '环境渲染', category: 'style', description: '通过环境描写渲染恐怖氛围', keywords: ['环境', '渲染', '氛围', '场景', '描写'], baseConfidence: 0.75, genreWeight: 1.6 },
    { id: 'kongbu_020', name: '午夜惊魂', category: 'structure', description: '午夜十二点发生的恐怖事件', keywords: ['午夜', '凌晨', '十二点', '半夜', '深夜'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'kongbu_021', name: '镜中鬼影', category: 'structure', description: '镜子里出现的鬼影，经典恐怖桥段', keywords: ['镜子', '鬼影', '镜中', '倒影', '照镜子'], baseConfidence: 0.65, genreWeight: 1.4 },
    { id: 'kongbu_022', name: '真假难辨', category: 'structure', description: '真真假假虚虚实实，让人分不清现实与幻觉', keywords: ['真假难辨', '虚实', '幻觉', '现实', '幻象'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'kongbu_023', name: '生存游戏', category: 'structure', description: '被迫参与的生存游戏，人性的考验', keywords: ['生存游戏', '大逃杀', '生存', '游戏', '人性考验'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'kongbu_024', name: '诅咒传说', category: 'structure', description: '受到诅咒的人或物，带来厄运和死亡', keywords: ['诅咒', '传说', '厄运', '死亡', '受诅咒'], baseConfidence: 0.7, genreWeight: 1.6 },
    { id: 'kongbu_025', name: '驱魔除灵', category: 'structure', description: '驱魔师或道士驱魔除灵的故事', keywords: ['驱魔', '除灵', '道士', '神父', '驱邪'], baseConfidence: 0.7, genreWeight: 1.5 },
    { id: 'kongbu_026', name: '人性黑暗', category: 'emotion', description: '揭露人性黑暗面的恐怖故事', keywords: ['人性', '黑暗', '人性黑暗', '丑恶', '人心'], baseConfidence: 0.75, genreWeight: 1.7 },
    { id: 'kongbu_027', name: '开放式结局', category: 'structure', description: '开放式结局，留有余韵让人回味', keywords: ['开放式结局', '结局', '留白', '余韵', '想象空间'], baseConfidence: 0.65, genreWeight: 1.4 }
  ],
  subGenres: [
    {
      id: 'xinli_kongbu',
      name: '心理恐怖',
      description: '心理层面的恐怖，细思极恐',
      keywords: ['心理恐怖', '细思极恐', '心理', '精神', '细思恐极', '心理惊悚', '精神恐怖', '心理变态', '心理阴影', '心理压力', '心理博弈', '心理战', '心理悬疑', '心理犯罪', '心理障碍'],
      exampleTitles: ['闪灵', '沉默的羔羊', '七宗罪', '搏击俱乐部', '致命ID']
    },
    {
      id: 'guzhai_jinghun',
      name: '古宅惊魂',
      description: '古老宅子里的恐怖事件',
      keywords: ['古宅', '老宅', '凶宅', '鬼屋', '闹鬼', '古宅惊魂', '老宅恐怖', '凶宅探险', '鬼屋探险', '古宅怪谈', '老宅怪谈', '凶宅鬼屋', '古宅灵异', '老宅灵异', '古宅秘事'],
      exampleTitles: ['闪灵', '招魂', '潜伏', '鬼哭神嚎', '小岛惊魂']
    },
    {
      id: 'lingshi_kongbu',
      name: '灵异类恐怖',
      description: '鬼魂、灵异现象类的恐怖故事',
      keywords: ['灵异', '鬼魂', '幽灵', '鬼怪', '灵异事件', '闹鬼', '鬼', '灵异恐怖', '鬼魂恐怖', '幽灵恐怖', '灵异现象', '超自然', '超自然恐怖', '灵异怪谈', '鬼怪恐怖'],
      exampleTitles: ['午夜凶铃', '咒怨', '招魂', '潜伏', '鬼修女']
    },
    {
      id: 'sangshi_mori',
      name: '丧尸末日',
      description: '丧尸爆发，世界末日中的生存故事',
      keywords: ['丧尸', '末日', '生存', '活死人', '僵尸', '丧尸末日', '末日生存', '丧尸围城', '末日危机', '丧尸病毒', '末日求生', '丧尸危机', '活死人黎明', '行尸走肉', '生化危机'],
      exampleTitles: ['行尸走肉', '生化危机', '活死人黎明', '釜山行', '我是传奇']
    },
    {
      id: 'lianhuan_sharen',
      name: '连环杀人',
      description: '连环杀手的恐怖犯罪故事',
      keywords: ['连环杀人', '连环杀手', '凶手', '犯罪', '谋杀', '杀人狂', '变态杀手', '连环凶案', '连环命案', '连环谋杀', '变态杀人狂', '连环作案', '犯罪心理', '惊悚犯罪', '恐怖犯罪'],
      exampleTitles: ['沉默的羔羊', '七宗罪', '十二宫', '电锯惊魂', '致命弯道']
    },
    {
      id: 'dushi_guaitan_kb',
      name: '都市怪谈',
      description: '现代都市中的恐怖传说和怪谈',
      keywords: ['都市传说', '都市怪谈', '现代', '城市', '传说', '都市恐怖', '城市怪谈', '都市灵异', '城市传说', '都市异闻', '都市奇谈', '都市诡异', '城市诡异', '都市怪谈类', '都市传说类'],
      exampleTitles: ['午夜凶铃', '咒怨', '鬼来电', '裂口女', '半身死灵']
    },
    {
      id: 'misu_kongbu',
      name: '密室恐怖',
      description: '密闭空间中的恐怖事件',
      keywords: ['密室', '密闭空间', '封闭空间', '幽闭', '逃不出去', '密室逃脱', '密室恐怖', '密室惊悚', '密室悬疑', '密室杀人', '密室怪谈', '密室灵异', '密室逃生', '被困密室', '密室求生'],
      exampleTitles: ['电锯惊魂', '心慌方', '密室逃生', '九人禁闭室', '极限空间']
    },
    {
      id: 'kesulu',
      name: '克苏鲁神话',
      description: '克苏鲁神话风格的恐怖故事',
      keywords: ['克苏鲁', '不可名状', '旧日支配者', '深渊', 'san值', '克苏鲁神话', '洛夫克拉夫特', '旧神', '古神', '深空星海之主', '拉莱耶', '克苏鲁风格', '克苏鲁恐怖', 'san值掉光', '不可名状的恐惧'],
      exampleTitles: ['克苏鲁的呼唤', '疯狂山脉', '印斯茅斯的阴霾', '暗夜呢喃', '星之彩']
    },
    {
      id: 'minsu_kongbu',
      name: '民俗恐怖',
      description: '基于民间民俗的恐怖故事',
      keywords: ['民俗', '民间', '习俗', '禁忌', '封建迷信', '民俗恐怖', '民间恐怖', '乡村恐怖', '农村恐怖', '民俗怪谈', '民间怪谈', '民俗灵异', '民间灵异', '乡村怪谈', '农村怪谈'],
      exampleTitles: ['双瞳', '咒', '中邪', '孤岛惊魂', '林中小屋']
    }
  ],
  weights: { character: 0.15, foreshadow: 0.2, technique: 0.15, style: 0.25, rhythm: 0.15, structure: 0.1 }
};

const FORESHADOW_CATEGORIES: ForeshadowCategoryDef[] = [
  {
    id: 'item',
    name: '物品伏笔',
    description: '通过物品道具埋下的伏笔，物品在后续情节中发挥关键作用',
    setupPatterns: [
      '在早期章节中提到一个看似普通或不起眼的物品',
      '主角获得某件物品但暂时不知道其真实用途',
      '配角赠予主角一件信物或纪念品',
      '在某个场景中特意描写一件物品的细节',
      '物品在某个事件后神秘消失或被收藏起来',
      '提到某件物品的传说或背景故事但未展开'
    ],
    payoffPatterns: [
      '关键时刻物品发挥了意想不到的作用',
      '物品的真实身份或来历被揭开，原来是重要信物',
      '依靠这件物品破解了某个难题或困境',
      '物品成为推动后续剧情发展的关键道具',
      '物品引发了新的冲突或机缘',
      '物品中隐藏的秘密被主角发现'
    ],
    examples: [
      '主角小时候得到的一块普通玉佩，原来是上古神器',
      '路边捡到的一枚铜钱，竟是开启秘境的钥匙',
      '母亲留下的发簪，内藏绝世武功秘籍',
      '看似普通的戒指，里面住着一位老爷爷的灵魂',
      '拍卖会低价拍下的残破画卷，藏有藏宝图'
    ]
  },
  {
    id: 'skill',
    name: '功法/能力伏笔',
    description: '通过修炼功法或特殊能力埋下的伏笔，能力在后期发挥重要作用',
    setupPatterns: [
      '主角早期修炼了一门看似鸡肋的基础功法',
      '获得一部残缺的功法，暂时只能修炼前几层',
      '觉醒了一个看似没用的特殊能力',
      '某门功法有特殊的修炼条件但未说明',
      '提到某功法有隐藏效果但主角还未发现',
      '配角提过某功法的传说但没人当真'
    ],
    payoffPatterns: [
      '鸡肋功法在关键时刻发挥了决定性作用',
      '残缺功法的后半部分被找到，威力大增',
      '看似没用的能力在特定场景下成为神技',
      '功法的隐藏效果被触发，实力暴涨',
      '原来修炼的是顶级功法的简化版',
      '功法与某件物品或血脉产生共鸣'
    ],
    examples: [
      '入门级的基础吐纳法，实则是上古修仙功法的基础篇',
      '能让头发变长的异能，在战斗中出其不意',
      '修炼速度极慢的功法，后期厚积薄发一飞冲天',
      '只会一个小火球的法师，后来发现是神火种子',
      '人人都有的基础技能，主角练出了花'
    ]
  },
  {
    id: 'character',
    name: '人物伏笔',
    description: '通过人物身份、背景或关系埋下的伏笔，人物真实情况在后期揭晓',
    setupPatterns: [
      '某个配角的身份背景神秘，从未详细说明',
      '主角身边的人有一些不为人知的小习惯',
      '提到某个人物但从未正式出场',
      '某角色对主角态度异常但不说原因',
      '人物身上有特殊的标记或特征',
      '某角色知道一些不该知道的秘密'
    ],
    payoffPatterns: [
      '人物的真实身份被揭开，原来是大人物',
      '人物与主角有血缘关系或宿世渊源',
      '人物的过往经历影响当前剧情',
      '人物的隐藏目的或立场暴露',
      '人物之前的反常行为得到合理解释',
      '人物死亡后留下的遗言或遗物引出新剧情'
    ],
    examples: [
      '扫地的老仆原来是隐退的江湖第一高手',
      '身边的小丫鬟其实是敌国派来的公主',
      '从小一起长大的兄弟，真实身份是仇人的儿子',
      '师父从未提起的过往，原来是因为愧对主角家族',
      '路边救下的乞丐，后来成了主角的最大助力'
    ]
  },
  {
    id: 'setting',
    name: '设定伏笔',
    description: '通过世界观设定埋下的伏笔，世界的真相在后期逐步展开',
    setupPatterns: [
      '早期提到某个地域的传说或禁忌',
      '世界设定中有一些模糊不清的地方',
      '历史记载中有缺失或矛盾的部分',
      '某片区域被禁止进入但原因不明',
      '提到上古时期发生过的大事但语焉不详',
      '不同势力对同一事件有不同说法'
    ],
    payoffPatterns: [
      '世界的真相被揭开，远比想象的宏大',
      '传说中的事物真实存在并影响剧情',
      '历史的真相与记载完全不同',
      '禁地中隐藏着关乎世界存亡的秘密',
      '上古时期的因果报应到了现在',
      '主角所在的世界原来是更高层世界的一部分'
    ],
    examples: [
      '凡人界之上还有仙界，仙界之上还有神界',
      '世界其实是上古大能的一件法宝',
      '传说中的灭世大劫其实是人为造成的',
      '万年前的神魔之战并未结束，只是暂时休战',
      '主角所在的宗门原来是上古大教的分支'
    ]
  },
  {
    id: 'event',
    name: '事件伏笔',
    description: '通过某个事件埋下的伏笔，事件的影响在后续显现',
    setupPatterns: [
      '早期发生了一件看似已经结束的小事',
      '某个事件的处理结果有些蹊跷',
      '主角无意中做了一件小事但产生了蝴蝶效应',
      '提到多年前发生过的某件大案要案',
      '某个事件的目击者全部失踪或死亡',
      '事件背后似乎有更大的势力在操控'
    ],
    payoffPatterns: [
      '过去的事件在现在产生了新的影响',
      '事件的真相与表面完全不同',
      '主角当年的无心之举救下了关键人物',
      '当年的凶手或幕后黑手浮出水面',
      '事件引发的因果报应到了主角身上',
      '事件是更大阴谋的一部分'
    ],
    examples: [
      '主角小时候随手救的一个人，后来成了一方大佬来报恩',
      '十年前的灭门惨案，真相比想象的更复杂',
      '上一届宗门大比的内幕，牵涉到宗门高层的斗争',
      '主角无意中破坏的一个小仪式，阻止了魔头降临',
      '前朝灭亡的真相，与主角家族有关'
    ]
  }
];

const GENRES: GenreConfig[] = [
  XUANHUAN_XIANXIA,
  DUSHI_MODERN,
  GUDAI_YANQING,
  XIANDAI_YANQING,
  LISHI_JUNSHI,
  KEHUAN_MOSHI,
  XUANYI_TUILI,
  YOUXI_JINGJI,
  QIHUAN_XIFANG,
  TIYU_JINGJI,
  ERCIYUAN,
  LINGYI_GUIGUAI,
  XIANDAI_DANMEI,
  GUDAI_DANMEI,
  MENGBAO_TIANCHONG,
  ZHICHANG_HUNLIAN,
  QINGXIAOSHUO,
  KONGBU_JINGSONG
];

export class WebnovelKnowledgeBase {
  private genres: Map<string, GenreConfig>;
  private customGenres: Map<string, GenreConfig>;
  private foreshadowCategories: ForeshadowCategoryDef[];

  constructor() {
    this.genres = new Map();
    for (const genre of GENRES) {
      this.genres.set(genre.id, genre);
    }
    this.customGenres = new Map();
    this.foreshadowCategories = [...FORESHADOW_CATEGORIES];
  }

  /**
   * 新增自定义题材。
   *
   * @param genre - 题材
   */
  addCustomGenre(genre: GenreConfig): void {
    this.customGenres.set(genre.id, { ...genre, isCustom: true });
  }

  /**
   * 更新自定义题材。
   *
   * @param id - 标识
   * @param updates - 更新字段
   * @returns 是否更新
   */
  updateCustomGenre(id: string, updates: Partial<GenreConfig>): boolean {
    const existing = this.customGenres.get(id);
    if (!existing) return false;
    this.customGenres.set(id, { ...existing, ...updates, isCustom: true });
    return true;
  }

  /**
   * 删除自定义题材。
   *
   * @param id - 标识
   * @returns 是否删除
   */
  deleteCustomGenre(id: string): boolean {
    return this.customGenres.delete(id);
  }

  /**
   * 读取自定义题材。
   * @returns 题材数组
   */
  getCustomGenres(): GenreConfig[] {
    return Array.from(this.customGenres.values());
  }

  /**
   * 是否自定义题材。
   *
   * @param id - 标识
   * @returns 布尔值
   */
  isCustomGenre(id: string): boolean {
    return this.customGenres.has(id);
  }

  private getMergedGenres(): Map<string, GenreConfig> {
    const merged = new Map(this.genres);
    for (const [id, genre] of this.customGenres) {
      merged.set(id, genre);
    }
    return merged;
  }

  /**
   * 取题材定义。
   *
   * @param id - 标识
   * @returns 题材或 undefined
   */
  getGenre(id: string): GenreConfig | undefined {
    if (this.customGenres.has(id)) {
      return this.customGenres.get(id);
    }
    return this.genres.get(id);
  }

  /**
   * 读取全部题材。
   * @returns 题材数组
   */
  getAllGenres(): GenreConfig[] {
    return Array.from(this.getMergedGenres().values());
  }

  /**
   * 读取题材 id/名称。
   * @returns {id,name} 数组
   */
  getGenreNames(): { id: string; name: string }[] {
    return Array.from(this.getMergedGenres().values()).map(g => ({ id: g.id, name: g.name }));
  }

  /**
   * 按性别向分类取题材。
   *
   * @param category - 分类
   * @returns 题材数组
   */
  getGenresByCategory(category: 'male' | 'female' | 'neutral'): GenreConfig[] {
    return Array.from(this.getMergedGenres().values()).filter(g => g.category === category);
  }

  /**
   * 读取子题材。
   *
   * @param genreId - 题材 ID
   * @returns 子题材数组
   */
  getSubGenres(genreId: string): SubGenreConfig[] {
    const genre = this.getGenre(genreId);
    return genre?.subGenres ?? [];
  }

  /**
   * 取子题材。
   *
   * @param genreId - 题材 ID
   * @param subGenreId - 子题材 ID
   * @returns 子题材或 null
   */
  getSubGenre(genreId: string, subGenreId: string): SubGenreConfig | null {
    const genre = this.getGenre(genreId);
    if (!genre?.subGenres) return null;
    return genre.subGenres.find(sg => sg.id === subGenreId) ?? null;
  }

  /**
   * 读取伏笔分类定义。
   * @returns 分类数组
   */
  getForeshadowCategories(): ForeshadowCategoryDef[] {
    return [...this.foreshadowCategories];
  }

  /**
   * 按关键词匹配题材。
   *
   * @param text - 文本内容
   * @returns {genreId,score} 数组
   */
  matchGenreByKeywords(text: string): { genreId: string; score: number }[] {
    const results: { genreId: string; score: number }[] = [];
    const lowerText = text.toLowerCase();
    const mergedGenres = this.getMergedGenres();

    for (const genre of mergedGenres.values()) {
      let score = 0;
      const textLower = lowerText;

      if (textLower.includes(genre.name.toLowerCase())) {
        score += 10;
      }

      for (const tag of genre.personalityTags) {
        if (textLower.includes(tag.toLowerCase())) {
          score += 1;
        }
      }

      for (const ability of genre.abilityTypes) {
        if (textLower.includes(ability.toLowerCase())) {
          score += 1.5;
        }
      }

      for (const bg of genre.backgroundTypes) {
        if (textLower.includes(bg.toLowerCase())) {
          score += 1.2;
        }
      }

      for (const technique of genre.techniques) {
        for (const keyword of technique.keywords) {
          if (textLower.includes(keyword.toLowerCase())) {
            score += technique.baseConfidence * technique.genreWeight;
          }
        }
      }

      if (score > 0) {
        results.push({ genreId: genre.id, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results;
  }

  /**
   * 默认题材。
   * @returns 题材
   */
  getDefaultGenre(): GenreConfig {
    return this.getGenre('xuanhuan_xianxia')!;
  }
}
