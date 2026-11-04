/**
 * mock-ai-server.mjs — 本地 OpenAI 兼容模拟服务（E2E 专用）
 *
 * 默认监听 127.0.0.1 的随机端口，只提供确定性的固定响应，避免 E2E 依赖真实 API。
 *
 * 端点：
 *   POST /v1/chat/completions   OpenAI Chat Completions（stream=true 时返回 SSE）
 *   POST /api/generate          Ollama 原生兼容（万一端点被插件改写也能工作）
 *   GET  /v1/models             模型列表
 *   GET  /__mock/stats          请求计数（按步骤类型）
 *   POST /__mock/reset          清零计数
 *   POST /__mock/config         { delayMs } 控制响应延迟
 *
 * 启动成功后向 stdout 打印一行：MOCK_AI_READY {"port":12345}
 */

import http from 'node:http';

const state = {
    delayMs: 0,
    total: 0,
    byKind: Object.create(null),
    lastRequests: [],
};

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, X-Requested-With',
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Max-Age': '86400',
};

function sendJson(res, payload, status = 200) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        ...CORS_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
    });
    res.end(body);
}

function sendEmpty(res, status = 204) {
    res.writeHead(status, { ...CORS_HEADERS, 'Content-Length': '0' });
    res.end();
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            if (!raw) return resolve({});
            try {
                resolve(JSON.parse(raw));
            } catch {
                resolve({ __raw: raw });
            }
        });
        req.on('error', reject);
    });
}

function normalizeMessages(body) {
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    let system = '';
    let user = '';
    for (const message of messages) {
        const content = typeof message?.content === 'string'
            ? message.content
            : Array.isArray(message?.content)
                ? message.content.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('\n')
                : '';
        if (message?.role === 'system') system += `${content}\n`;
        else if (message?.role === 'user') user += `${content}\n`;
        else user += `${content}\n`;
    }
    // Ollama 原生请求体：system + prompt
    if (!system && typeof body?.system === 'string') system = body.system;
    if (!user && typeof body?.prompt === 'string') user = body.prompt;
    return { system, user };
}

/**
 * 按 system/user 关键词识别步骤。顺序很重要：越具体的规则越靠前。
 * @param {string} system - 系统提示词
 * @param {string} user - 用户提示词
 * @returns {string} 步骤类型
 */
function detectKind(system, user) {
    const all = `${system}\n${user}`;
    if (/复盘搭档|六块引导|镜头一致性/.test(all)) return 'qualityControl';
    if (/信息论分析师|新元素提取|大纲对照检测/.test(all)) return 'analysisReport';
    if (/角色灵魂分析师|角色灵魂提取/.test(all)) return 'characterSoul';
    // 规划步骤的 user 会互相引用「大纲摘要/情节蒸馏」，只匹配 all 会把 outline 误判成 plotDistill。
    // 先用 system 的职责描述与 user 的输出标题做精确判据。
    if (/信息释放节奏规划|章节信息规划/.test(system)) return 'infoPlan';
    if (/叙事者|刚经历的第\s*\d+\s*章|正文生成|台词清单|录音机|小说家，写中文长篇小说|你活在他身体里|刚刚经历的这段|最终写作指令/.test(all)) return 'bodyGeneration';
    if (/情绪规划师/.test(system) || /##\s*总体情绪曲线/.test(user)) return 'emotionPlan';
    if (/预演你即将经历|场景卡|记忆碎片和当前场景/.test(all)) return 'sceneExpand';
    if (/故事大纲编辑|大纲摘要编辑/.test(system) || /##\s*全书定位/.test(user)) return 'outline';
    if (/故事节奏设计师|情节蒸馏分析师/.test(system) || /##\s*情节蒸馏/.test(user)) return 'plotDistill';
    if (/势力卡/.test(all)) return 'faction';
    if (/地点卡/.test(all)) return 'location';
    if (/物品功法卡|物品卡/.test(all)) return 'item';
    if (/人物卡|角色卡/.test(all)) return 'character';
    if (/故事核编辑|分节大纲编辑|场景圣经编辑|分集大纲编辑|分镜表编辑|短篇小说策划编辑|短剧剧本策划编辑/.test(system)) return 'modeDocument';
    if (/短篇小说写作引擎|短剧剧本写作引擎|【本[节集]大纲】/.test(all)) return 'unitBody';
    if (/世界观|世界层级体系/.test(all)) return 'worldview';
    if (/结算表|章节结算|结算结果/.test(all)) return 'settlement';
    return 'generic';
}

function chapterNumberFrom(text) {
    const match = String(text || '').match(/第\s*(\d+)\s*章/);
    return match ? parseInt(match[1], 10) : 1;
}

function unitNumberFrom(text) {
    const match = String(text || '').match(/第\s*(\d+)\s*([节集])/);
    return { number: match ? parseInt(match[1], 10) : 1, label: match ? match[2] : '节' };
}

function buildUnitBody(system, user) {
    const isScript = /短剧剧本写作引擎|【本集大纲】|第\s*\d+\s*集/.test(`${system}
${user}`);
    const { number, label } = unitNumberFrom(`${system}
${user}`);
    if (isScript) {
        return `# 第${number}集 测试集

第1场 日 内 咖啡馆
△ 林晚推门而入，把合同拍在桌上。
林晚：（压着声音）签字，或者我现在就走。
顾沉：（抬眼）你确定要在这个时间点撕破脸？
△ 顾沉把手机推到桌边，屏幕亮起录音界面。

第2场 夜 外 天台
△ 风把两人的衣角吹得猎猎作响。
顾沉：你想要的从来不是合同。
林晚：（停顿）我想要的是你亲口承认。
△ 远处霓虹熄灭，只剩安全出口的绿光。

第3场 日 内 电梯
△ 电梯门合上前，林晚伸手挡住。
林晚：明天之前，给我答案。
△ 门合上，顾沉的表情被切成两半。
`;
    }
    return `# 第${number}${label} 测试${label}

林晚把那份合同推到桌子中央时，咖啡馆的暖气正嗡嗡作响。她没有看顾沉，只盯着杯沿那道细小的缺口，像盯着一件已经决定的事。

“签字。”她说。

顾沉没有动。他的手指搭在杯壁上，指节因为用力而发白。窗外有人撑伞走过，雨声把两个人的沉默填得很满。

“你确定？”他问。

林晚终于抬眼。她看见他眼底那一点没藏好的疲惫，也看见他身后的玻璃上，自己那张过分平静的脸。她想起三年前同样的雨天，他把伞偏到她这边，自己半边肩膀湿透。那时候她以为，有些事可以一直不说。

“我不是来商量的。”她说。

顾沉笑了一下，笑意没有到眼睛里。他把合同翻到最后一页，那里空着一行签名。他拿起笔，又放下。

“如果我签了，”他说，“你是不是就再也不回来？”

林晚没有回答。她伸手把合同抽回来，折好，放进包里。动作很慢，像在给彼此留最后一点反悔的时间。

“明天之前，”她站起来，“给我答案。”

她走到门口时，听见身后椅子轻轻一动。她没有回头。雨还在下，玻璃门映出两个人一坐一站的影子，中间隔着一张空桌子。

直到她推开门，冷风灌进来，她才听见他很轻地说了一句什么。雨声太大，她没有听清。
`;
}

function buildModeDocument(system, user) {
    const all = `${system}
${user}`;
    if (/编写故事核|故事核编辑/.test(system)) {
        return `## 一句话前提
一个替人收拾残局的女人，在最后一次交易里发现委托人正是三年前不告而别的人。

## 核心冲突
她想拿钱走人，他想让她留下；两人都不肯先承认当年的真相。

## 主角欲望与阻力
欲望：完成交易，离开这座城市。阻力：对方掌握她最不想被翻出的旧事。

## 情绪曲线
克制 → 试探 → 撕开 → 短暂和解 → 再次选择。

## 关键反转
合同最后一页不是签名，而是一张旧车票。

## 结尾兑现
她烧掉车票，却把回程日期改成了明天。
`;
    }
    if (/编写分镜表|分镜表编辑/.test(system)) {
        return `## 第1集

### 第1场 日 内 咖啡馆
- 画面：雨窗、合同、两杯未动的咖啡
- 动作：林晚推合同；顾沉按住纸角
- 台词：林晚“签字。”
- 时长：35s

### 第2场 夜 外 天台
- 画面：霓虹、风声、两人隔着一步
- 动作：顾沉递出旧车票
- 台词：顾沉“你想要的从来不是合同。”
- 时长：45s
`;
    }
    if (/编写场景圣经|场景圣经编辑/.test(system)) {
        return `## 主要人物
- 林晚：替人处理麻烦的中间人，嘴硬，怕被看穿。
- 顾沉：表面温和的委托人，习惯用沉默逼人先开口。

## 核心场景
- 咖啡馆：雨窗、暖光、靠角落的桌子；两人始终隔桌而坐。
- 天台：夜、霓虹、安全出口绿光；风把对话吹碎。

## 视觉与表演规则
- 不用大哭大闹；情绪压在停顿和手上。
- 每场至少一个可拍的动作细节（推合同、按纸角、挡电梯门）。

## 反复意象
- 旧车票、雨、两杯未动的咖啡。
`;
    }
    return `第1节：雨夜咖啡馆，林晚替人送合同，发现委托人是三年前的旧识；结尾对方拒签，她拿走合同。
第2节：林晚查旧车票，确认当年离开的真相；顾沉跟踪她到天台，两人第一次正面冲突。
第3节：合同最后一页被翻开，林晚必须在拿钱走人和留下对质之间选择；结尾她改签了回程票。
`;
}

function buildInfoPlan() {
    return `## 章名与核心冲突
章名：第N章 测试章
核心冲突：林玄在外门考核中被王虎当众逼迫认输，必须在暴露实力与继续隐忍之间做出选择。

## 情感与冲突量化
情感温度：7级（0-10级）— 紧张中带着压抑的期待
冲突强度：4/5（1-5级）— 公开对峙，随时可能升级
节奏节拍：起承转爽

## 信息释放计划
- 新信息点1：考核规则公布时，埋下林玄迟到与令牌发热的疑点
- 新信息点2：王虎挑衅时，释放林玄灵根异常的线索
- 新信息点3：结尾长老出现，抛出关于姓氏的新悬念

## 熵预算
- 本章需解决的不确定性（降熵）：林玄是否会被逐出外门
- 本章新增的不确定性（提熵）：长老为何单独召见他
- 预计章末信息熵水平：中

## 开头承接
- 上一章末句：“他握紧了那枚发烫的令牌。”
- 本章首句承接方式：从掌心灼热与山道露水的感觉接着写

## 章末钩子
- 钩子类型：悬念
- 钩子内容：长老低声念出一个林玄从未听过的姓氏。

## 伏笔操作
- 需回收的旧伏笔：无
- 需埋下的新伏笔：发烫令牌的来历

## 关系推进
- 林玄与苏晚：从同门竞争转为短暂联手

## 承诺推进
- 本章兑现“外门考核必有一战”的承诺

## 角色弧线
- 推进对象：林玄从隐忍到主动出手，变化通过他当众抬眼与半步前踏体现
`;
}

function buildPlotDistill() {
    return `## 情节蒸馏

### 场景节奏设计
- 【急起急落】直接切入冲突 → 快速升级 → 高潮 → 戛然而止，适合本章的考核对峙。

### 情节节点规划
- 节点1：铜钟响起，林玄被王虎当众点名上台
- 节点2：王虎以言语逼他认输，围观弟子起哄
- 节点3：林玄故意露出破绽，引王虎冒进
- 节点4：王虎祭出第三招，林玄以半步反制
- 节点5：执事长老喝止并单独召见，抛出新的悬念

### 爽点设计
- 核心爽点：被压制到极点后的当众反制
- 爽点类型：逆袭
- 铺垫方式：前三个节点持续压制，第四节点集中爆发

### 冲突升级路径
- 初始状态：口角试探，围观者起哄
- 升级点1：王虎动手撕破袖口
- 升级点2：第三招裹着灵力砸下
- 高潮点：林玄半步贴入，一掌逼退王虎
- 回落/悬念：长老介入，点名去藏经阁

### 信息密度指标
- 预计章节字数：3200
- 情节节点：5
- 信息增量：高
`;
}

function buildOutline() {
    return `## 全书定位
全书定位：本章处于开端阶段，负责推进主角成长线并揭示其隐藏灵根。

## 关键场景
### 场景1
地点：青云宗外门演武台
人物：林玄、王虎、苏晚
冲突：王虎当众逼林玄认输
目的：建立主角困境与考核压力
信息增量：林玄的令牌在靠近灵力时发热

### 场景2
地点：青云宗外门演武台
人物：林玄、王虎
冲突：王虎连续出手，林玄被逼到台角
目的：制造压制感并为反制铺垫
信息增量：林玄能看见对手发力前的重心习惯

### 场景3
地点：青云宗外门演武台
人物：林玄、王虎、执事长老
冲突：林玄半步反制，长老介入
目的：完成第一次小高潮并抛出更大悬念
信息增量：长老对林玄的姓氏与令牌产生反应

## 结尾钩子
钩子类型：悬念式
钩子内容：长老低声念出一个被抹去的姓氏，并让林玄次日卯时去藏经阁。
`;
}

function buildEmotionPlan() {
    return `## 总体情绪曲线
开篇情绪: 压抑(4/10) | 高潮情绪: 决绝(8/10) | 结尾情绪: 惊疑(6/10)
情绪总变化次数: 3

## 场景级情绪规划

### scene1: 演武台点名
emotion_start: 压抑(4/10) — 被当众围观的窘迫
emotion_end: 隐忍(5/10) — 王虎挑衅后强压怒火
emotion_delta: +1
body_reaction: 指甲一点点掐进掌心，留下月牙形的印子
relationship_change: 与王虎的敌意公开化

### scene2: 半步反制
emotion_start: 隐忍(5/10) — 等待对手露出习惯
emotion_end: 决绝(8/10) — 决定用一掌换一个立足之地
emotion_delta: +3
body_reaction: 呼吸短促，肩头旧伤在发力时抽痛
relationship_change: 围观弟子从嘲笑转为忌惮

### scene3: 长老召见
emotion_start: 决绝(8/10) — 还沉浸在反制后的紧绷
emotion_end: 惊疑(6/10) — 长老念出陌生姓氏后的不安
emotion_delta: -2
body_reaction: 后背发凉，掌心被令牌烫出一圈红痕
relationship_change: 苏晚从旁观转为主动陪同
`;
}

function buildSceneExpand() {
    return `## 场景1：演武台点名
pov: 林玄
time: 清晨
location: 青云宗外门演武台
objective: 通过外门考核，保住留在青云宗的资格
entry_state: 站在台阶下，掌心令牌发烫，袖口带着山道湿泥
conflict: 王虎当众逼他认输，围观弟子起哄
turn: 王虎推搡时撕破他的袖口，露出肩头旧伤
exit_state: 被逼到台角，丹田灵力外泄，决定不再退让
emotion_arc: 压抑(4/10) → 隐忍(5/10) — 强压怒火寻找时机
sensory_hook: 晨露的凉意、令牌隔着衣料传来的灼热
memory_trigger: 触发 m001 — 灼热让他想起父亲离开那晚的火盆
body_reaction: 拳头自己收紧，指甲掐进掌心
subtext: 嘴上说“我认输”，心里想的是再等一息
relationship_shift: 与苏晚短暂对视，得到不要动手的提醒
key_scene: ⭐ 名场面 — 当众抬眼，第一次不再回避
dialogue_function: 揭露王虎的靠山与考核规则
dialogue_beats: 王虎→林玄｜“外门考核也敢迟到”｜逼他低头
cliffhanger: 无
craft_notes: 用身体反应替代情绪词

## 场景2：半步反制
pov: 林玄
time: 同日上午
location: 青云宗外门演武台中央
objective: 在第三招前找到王虎发力习惯的破绽
entry_state: 肩头受伤，被逼到台角，灵力所剩不多
conflict: 王虎第三招裹着灵力正面砸下
turn: 林玄向前半步，以侧肩沉腰贴入，一掌按在对方肋下
exit_state: 王虎连退数步，林玄站定，全场安静
emotion_arc: 隐忍(5/10) → 决绝(8/10) — 用一次冒险换回主动
sensory_hook: 拳头破风的声音、靴底擦过青石的刺响
memory_trigger: 无
body_reaction: 呼吸短促，肩头旧伤在发力时抽痛
subtext: 他说“请”，心里已经决定不再留手
relationship_shift: 围观弟子从嘲笑转为忌惮
key_scene: 否
dialogue_function: 用一句“你教我的，三招”完成反击宣言
dialogue_beats: 林玄→王虎｜“你教我的，三招”｜宣告不再退让
cliffhanger: 无
craft_notes: 动作短句加快节奏

## 场景3：长老召见
pov: 林玄
time: 考核结束后
location: 青云宗藏经阁
objective: 弄清长老为何单独召见自己
entry_state: 刚赢下半招，掌心令牌仍在发热
conflict: 长老要求查看令牌，并念出一个陌生姓氏
turn: 长老确认令牌“认”林玄，却不肯解释原因
exit_state: 林玄带着更多疑问离开，决定次日卯时再来
emotion_arc: 决绝(8/10) → 惊疑(6/10) — 新的谜团压过胜利的余温
sensory_hook: 旧书的霉味、天窗光柱里浮动的灰尘
memory_trigger: 触发 m002 — 姓氏的尾音与母亲临终的话重合
body_reaction: 后背发凉，掌心被令牌烫出红痕
subtext: 他问“为什么”，心里已经知道自己不会得到答案
relationship_shift: 苏晚从旁观转为主动陪同
key_scene: ⭐ 名场面 — 长老念出被抹去的姓氏
dialogue_function: 抛出主线悬念，建立长老与令牌的关联
dialogue_beats: 长老→林玄｜“令牌带在身上？”｜确认身份
cliffhanger: 长老说“明天卯时再来”，却不解释姓氏
craft_notes: 结尾留白
`;
}

const BODY_PARAGRAPHS = [
    '演武台的青石被晨露打得发亮，林玄站到台阶下时，鞋底还带着山道上的湿泥。四周弟子让出一圈空地，谁也没说话，只有风声从旗杆顶上掠过去。他抬手按了按胸口，那枚令牌贴着皮肉，热得像刚从炉火里夹出来。',
    '王虎从人群里走出来，外门弟子的灰袍被他穿得松垮，腰间却挂着一枚亮银腰牌。他围着林玄转了半圈，忽然笑了一声：“迟到的人还想上台？你是没睡醒，还是觉得外门没人了？”围观的人群跟着低低笑起来，笑声像细针一样落在林玄背上。',
    '林玄没有看他，目光落在演武台中央那道被剑痕劈开的裂缝上。三年前他第一次上山，也是站在这个位置，那时候他连引气入体都做不到。如今丹田里那缕灵力明明灭灭，像一盏随时会被风吹熄的灯，他必须让它亮到考核结束。',
    '“我在跟你说话。”王虎伸手推了他一把，力道不大，却故意推在肩头旧伤上。林玄踉跄半步，袖口被扯开一道口子，露出底下尚未消退的青紫。人群安静了一瞬，随即有人吹了声口哨，像是在等一场好戏。',
    '苏晚站在人群最外侧，怀里抱着一卷竹简。她没有笑，也没有出声，只在林玄抬眼时极轻地摇了摇头。那意思很清楚：别在这里动手。林玄看懂了她，却也知道自己已经没有退路，王虎要的不是一场比试，是让他当众低头。',
    '执事长老敲响铜钟，钟声在群山之间荡开，惊起一片飞鸟。王虎率先跃上演武台，脚尖在石面上一点，整个人便稳稳落定。他回头朝林玄勾了勾手指：“上来。三招之内，你若还能站着，我认你赢。”',
    '林玄慢慢走上台阶，每走一步，胸口的令牌就更烫一分。他能感觉到那道热意顺着经脉往下走，撞在丹田的封印上，又被弹回来。疼是疼的，却也让他混沌的脑子清醒过来。他站定，拱手：“请。”',
    '王虎没有客气。第一招是扫堂腿，带着风声贴地而来；第二招是肘击，直取林玄面门。林玄侧身避开第一下，第二下却躲得狼狈，肩头被擦中，整个人向后滑出三步。台下响起一阵哄笑，有人喊：“认输吧，别丢人了！”',
    '林玄抹掉嘴角的血，抬眼看向王虎。就在这一瞬间，他忽然发现对方的脚步有一个极小的停顿——每一次发力之前，王虎都会先把重心压在左脚。那不是破绽，是习惯。习惯比破绽更容易利用。',
    '王虎第三招已经蓄势，右拳裹着灵力砸下来。林玄没有退，反而向前踏了半步，故意把胸口送到拳锋前。台下有人惊呼。就在拳头临身的刹那，他侧肩、沉腰，以一条几乎不像外门功法的弧线贴了上去。',
    '那一拳落空，王虎重心前倾，眼里第一次露出错愕。林玄的手掌已经按在他的肋下，灵力不多，却准得可怕。他听见自己说：“你教我的，三招。”声音很轻，却让整个演武台安静下来。',
    '王虎闷哼一声，连退数步，靴底在石面上擦出刺耳的声响。他稳住身形，脸色由红转白，又由白转青，显然没想到自己会被一个迟到的新人逼退。台下的笑声消失了，取而代之的是压低的议论，像水底暗流。',
    '林玄没有追。他站在原地，呼吸急促，丹田里那点灵力已经见底。他很清楚，刚才那一下若再慢半息，倒下的就是自己。可他也知道，今天这一掌必须打出去，否则往后每一次考核，王虎都会踩在他头上。',
    '“够了。”执事长老的声音从高台上落下来，不大，却让所有人闭了嘴。老人缓步走到台边，目光在林玄身上停了很久，久到林玄后背发凉。长老忽然问：“你方才那一转，是谁教你的？”',
    '林玄垂下手，掌心的令牌烫得几乎握不住。他本想说没人教，话到嘴边却变成了：“我自己琢磨的。”长老没有追问，只伸手在他腕上搭了一息，眉头慢慢皱起来。台下的人看不清，林玄却看见老人的指尖微微一颤。',
    '“考核继续。”长老收回手，转身时丢下一句，“林玄，考完后到藏经阁来。”这句话比任何胜负都更让人震动。王虎猛地抬头，苏晚也攥紧了竹简。林玄站在原地，听见自己的心跳一下比一下重。',
    '他走下演武台时，人群自动分开一条路。有人避开他的目光，有人偷偷打量他的手腕，还有人凑在一起低声说着什么。林玄没有停，他走到苏晚身边，苏晚把竹简往怀里收了收，轻声问：“你没事吧？”',
    '“没事。”林玄答得很快，快得连自己都不太信。他抬起手，看见掌心被令牌烫出一圈浅浅的红痕，像是某种被强行按回去的印记。远处钟声又响了一次，山风把演武台上的尘土吹起来，他忽然觉得，真正的考核才刚刚开始。',
    '苏晚跟在他半步之后，声音压得很低：“长老很少单独叫人去藏经阁。上一次被叫去的，是现在的大师兄。”林玄脚步没停，只问：“你觉得是好事？”苏晚沉默了一会儿，说：“我不知道。但王虎不会善罢甘休。”',
    '山道两侧的松树被风吹得沙沙响，石阶上落着一层薄薄的松针。林玄低头走路，脑子里反复回放长老搭脉时的神情。那一颤不像惊讶，更像是确认了什么。他想起父亲留下的令牌，想起母亲临终前反复叮嘱的那句“别让人看见”，胸口忽然发紧。',
    '“你父亲的事，你还在查？”苏晚忽然问。林玄嗯了一声。苏晚没有再劝，她知道劝也没有用。两个人沿着山道往上走，影子被午后的日头拉得很长，一前一后落在青石上。',
    '藏经阁在山腰最深处，屋檐被古松遮去大半，远远看去像一块沉默的黑色石头。林玄在门前停下，回头看了苏晚一眼。苏晚朝他点头：“我在外面等。”他吸了口气，抬手推门。',
    '门轴发出很轻的一声响。阁内没有点灯，只有天窗漏下的一束光，照在满架旧书上。长老背对着他站在光里，手里捧着一卷发黄的册子，听见脚步也没有回头，只问：“令牌带在身上？”',
    '林玄的呼吸停了一拍。他下意识按住胸口，隔着衣料，那枚令牌依旧温热。长老终于转过身，目光落在他手掌的位置：“拿出来。我不抢你的东西，只想看看它认不认你。”',
    '林玄犹豫了一瞬，还是把令牌取了出来。黑色石面在光下没有反光，边缘却浮出一线极淡的金色。长老看了很久，忽然低声念出一个姓氏。那声音太轻，林玄只听清了最后一个字，却觉得整个藏经阁都跟着震了一下。',
    '“回去吧。”长老把册子合上，像什么都没发生过，“明天卯时再来。”林玄想问，话到嘴边又咽了回去。他把令牌收回怀里，转身出门时，听见身后传来一声很轻的叹息。',
    '门外阳光刺眼，苏晚还站在原地。她看见他的脸色，什么都没问，只把竹简递过来：“先吃饭。天大的事，也得吃饱了再说。”林玄接过竹简，忽然笑了一下，绷了一路的肩膀终于松下来。',
    '两人沿着山道往下走，远处演武台已经空了，只剩下风吹旗面的猎猎声。林玄把令牌握在掌心，热度正在一点点退去，像某种苏醒后的余温。他忽然想，父亲当年把它留下时，是不是也站在这样的山道上，听过同样的风声。',
    '走到岔路口，苏晚往东，他往西。分别前，苏晚回头说：“明天卯时，我陪你去。”林玄想说不用，最后只点了点头。她笑了一下，转身走进暮色里，竹简在背后轻轻晃动。',
    '林玄独自回到外门住处，推开门，屋里还是早上的样子。他把令牌放在桌上，盯着那圈红痕看了很久，直到窗外的天色彻底暗下来。远处传来夜钟，他吹灭灯，在黑暗里轻声说：“爹，我好像找到一点线索了。”',
    '第二天卯时，天还没有全亮，山道上浮着一层薄雾。林玄到藏经阁时，苏晚已经等在门外，手里提着两盏灯笼。她把其中一盏递给他，什么也没问，只说：“走吧，别让长老等。”',
    '阁内比昨天更暗，长老坐在窗下的木案后，案上摊着那卷发黄的册子。他抬眼看两人，目光在苏晚身上停了一瞬，没有赶人，只把册子往前推了推：“你们自己看。”',
    '册子上的字迹被水浸过，许多地方只剩模糊的墨痕。林玄一页页翻过去，忽然在一行小字前停住。那行字写着一个姓氏，和他昨夜听到的尾音一模一样，后面跟着四个字：灵根可封。',
    '“看懂了？”长老问。林玄摇头，又点头。他确实看懂了那四个字，却不明白为什么会写在这里。长老叹了口气：“你父亲当年也问过同样的问题。我没答他，现在也不能答你。”',
    '苏晚忽然伸手按住册子的另一角，指着一处被朱笔圈过的名字：“这个人还活着吗？”长老沉默了很久，久到窗外的雾都散了些，才说：“活着。但你们找不到他。”',
    '从藏经阁出来时，日头已经升到山脊上。林玄把册子里的那行字在心里默念了一遍，掌心的令牌没有发热，却像有什么东西在皮肤底下轻轻跳了一下。他抬头看向远处的云海，第一次觉得前路虽然看不清，却不再是一片空白。',
    '苏晚走在他旁边，忽然说：“你昨晚没睡。”林玄嗯了一声。她没再追问，只把灯笼吹灭，收进袖子里：“那就白天补。今晚我替你守着，你睡。”',
    '林玄想说不用，最后只低声说了句“多谢”。山风从两人之间穿过去，带着松针和湿土的气味。他把令牌重新按回胸口，脚步比来时稳了一些。',
];

function buildBody(userPrompt) {
    const chapter = chapterNumberFrom(userPrompt);
    return `# 第${chapter}章 测试章\n\n${BODY_PARAGRAPHS.join('\n\n')}`;
}

function buildQualityControl() {
    return `## 一、镜头一致性
✅ 通过：全章始终贴着林玄的感知，没有跳进王虎或苏晚的内心，也没有“与此同时”式的全知补充。

## 二、承接与钩子
✅ 通过：开篇从掌心灼热与山道露水接上一章末句，结尾用长老念出的姓氏留下翻页动力。

## 三、人物动机与变化
✅ 通过：林玄从隐忍到半步反制有明确触发——肩头旧伤被推、灵根秘密面临暴露；王虎的挑衅也有面子与靠山动机。

## 四、世界与设定观感
⚠️ 待改进：外门考核的规则只在对话里提了一句，建议补一句“三招内站住即算过关”的明文规则。

## 五、节奏与阅读冲动
✅ 通过：冲突在第三个场景集中升级，动作短句与对话交替，没有长时间静态说明。

## 六、语言质感
✅ 通过：情绪多落在身体反应与动作上，解释性句子少；个别形容可以再收一点。

## 修改建议汇总
- 🔴 影响阅读：补一句演武台考核规则，避免读者疑惑胜负标准。
- 🟡 值得改：王虎的靠山可以再具体半句。
- 🟢 可选：结尾增加一个与令牌温度相关的感官细节。
`;
}

function buildAnalysisReport() {
    return `UPDATE_CHARACTER: [[林玄]] | 当前状态 | 外门考核中暴露部分实力
UPDATE_CHARACTER: [[林玄]] | 修为等级 | 炼气二层
NEW_CHARACTER: 林玄 | 青云宗外门弟子，身怀被封印的上古灵根，正在追查父亲失踪的真相
NEW_CHARACTER: 苏晚 | 青云宗外门弟子，心思细密，在林玄被针对时选择站在他身边
NEW_LOCATION: 青云宗外门演武台 | 外门弟子考核与比试的青石高台，四周立有旗杆
NEW_FACTION: 青云宗 | 东域三宗之一，以剑修与灵脉阵法闻名
NEW_ITEM: 发烫的令牌 | 林玄父亲留下的黑色令牌，遇险或接近灵力时会发热
NEW_FORESHADOW: 令牌的来历 | 第1章 | 第3章 | 林玄 | 身世主线
NEW_TIMELINE: 清晨 | 外门考核开始，林玄被王虎当众点名登台
RELATION: 林玄|苏晚|同门|短暂对视后形成默契，苏晚主动提出陪同
CHARACTER_BEHAVIOR: 林玄 | 在外门考核中以半步反制王虎，随后被执事长老单独召见
EMOTION: [[林玄]] | 惊疑 | 长老念出陌生姓氏后既不安又隐隐期待

## 问题分析
✅ 未发现严重问题；⚠️ 演武台规则交代略少，读者需要自行推断胜负标准。

## 总结评价
整体节奏紧凑，冲突升级清晰，林玄的隐忍与反制有因果；建议在开篇补一句考核规则。

## 具体细节
第1章场景2的转折有效，半步反制与“三招”承诺形成呼应；问题1为规则说明不足。
`;
}

function buildWorldview() {
    return `---
世界名称: "九霄测试界"
项目名称: "E2E 测试项目"
tags: [世界观, nw/设定/世界观]
世界类型: 玄幻
创作阶段: 世界观设定
---

## 世界层级体系
- **层级数量**：三重
- **各层级概要**：凡界、灵界、天界依次递升
- **跨层级关系**：修士通过飞升跨越层级，失败者滞留凡界

## 力量体系
- **修炼体系名称**：九霄灵脉
- **境界划分**：炼气、筑基、金丹、元婴、化神
- **力量来源**：天地灵气与自身灵根
- **特殊力量规则**：灵根可被封印，解封时伴随剧烈反噬

## 货币体系
- **通用货币**：灵石
- **各层级货币**：凡界用金银，灵界用下品灵石，天界用上品灵石
- **兑换关系**：一百下品灵石折一上品灵石

## 势力分类
- **主要势力类型**：宗门、王朝、商会
- **势力分布**：东域以剑修宗门为主，西域多商会
- **势力关系格局**：三宗鼎立，王朝附庸宗门

## 地理格局
- **地理概要**：东域多山，西域多荒漠，中州为灵脉汇聚之地
- **重要区域**：青云宗、藏经阁、外门演武台

## 历史大事记
### 远古
- 九霄灵脉初现
### 近代
- 三宗立约，划分东域
### 近期
- 林玄父亲失踪，令牌流落外门

## 特殊规则
- **世界法则**：灵力不可凭空产生，只能转移或储存
- **禁忌/限制**：封印灵根者不得进入藏经阁内层

## 文化与社会
- **社会结构**：宗门长老—执事—内门—外门
- **价值观念**：强者为尊，但同门不得相残
- **风俗禁忌**：不得直呼被抹去的姓氏

## 与主线关联
- **世界观对主线的推动**：灵根封印与令牌来历构成主角身世主线
- **世界观的潜在变化**：灵脉枯竭可能迫使宗门向外扩张
`;
}

function buildCharacter() {
    return `---
tags: [人物, 主角]
姓名: 林玄
年龄: 十八
身份: 青云宗外门弟子
人物背景: 出身山村，父亲在他幼年时失踪，母亲临终前留下“别让人看见”的叮嘱
外貌特征: 身形清瘦，眉眼沉静，肩头有一道旧伤
当前目标: 通过外门考核并查清父亲失踪的真相
核心动机: 找到父亲并弄明白令牌的来历
核心驱动力_软肋: 对亲情极度执着，亲人受威胁时会失去冷静
习惯性小动作: 思考时用拇指摩挲令牌边缘
当前状态: 外门考核中暴露部分实力
当前情绪: 惊疑
性格标签: [隐忍, 果决, 重情]
金手指/特殊能力: 被封印的上古灵根
功法/技能树: 九霄引气诀、半步贴靠
所属势力: 青云宗
entity_status: active
entity_created_at: 2026-11-04
character_core:
  desire: 找到父亲并确认他还活着
  fear: 再次失去重要的人
  obsession: 追查令牌与被抹去的姓氏
  shame: 曾无力保护妹妹
  trauma: 目睹父亲被陌生人带走
  weakness: 亲人受威胁时容易失去判断
  soft_spot: 妹妹与苏晚
  rage_trigger: 有人伤害无辜孩童
  moral_boundary: 不滥杀，不牵连无辜
性格三层:
  表层_面具: 沉默寡言，尽量不引人注意
  中层_真实: 重情重义，愿意为信任的人冒险
  深层_内核: 害怕自己终究会像父亲一样被抹去
角色弧光:
  起点状态: 隐忍求全，只求留在外门
  成长触发点: 考核受辱与长老召见
  终点状态: 主动承担身世带来的责任
  弧光类型: 成长
---
# 林玄

## 确定性设定（已揭露，不可违背）
林玄是青云宗外门弟子，身怀被封印的上古灵根，父亲失踪多年。

## 不确定性（未解之谜 / 角色弧光）
令牌为何认他、被抹去的姓氏意味着什么，仍未有答案。

## 与其他角色的互信息
与苏晚是同门，彼此有隐约的信任；与王虎结下公开的梁子。

## 自信息事件储备（低概率但合理的惊喜行为）
在绝境中主动暴露一部分实力，以换取继续留在宗门的资格。

## 功法/技能树
九霄引气诀入门，擅长观察对手发力习惯，以半步贴靠反制。

## 角色灵魂层（欲望/恐惧/创伤/底线）
欲望是找到父亲；恐惧是再次失去亲人；底线是不滥杀无辜。

## 变更记录
- 2026-11-04：外门考核中暴露部分实力，被长老单独召见。
`;
}

function buildFaction() {
    return `---
tags: [势力]
名称: 青云宗
别称: 青云剑宗
类型: 宗门
描述: 东域三宗之一，以剑修与灵脉阵法闻名，外门弟子众多
领袖: 青阳真人
地位/排名: 东域第三
entity_status: active
entity_created_at: 2026-11-04
---
# 青云宗

## 确定性设定（已揭露，不可违背）
青云宗是东域三宗之一，山门位于青云山，外门与内门分立。

## 不确定性（未解之谜 / 剧情潜力）
宗门对被抹去的姓氏讳莫如深，藏经阁内层封存着旧档。

## 与其他元素的互信息
掌控外门演武台与藏经阁，与王室保持若即若离的关系。

## 变更记录
- 2026-11-04：外门考核期间长老注意到林玄。
`;
}

function buildLocation() {
    return `---
tags: [地点]
名称: 青云宗外门演武台
别称: 外门试剑台
类型: 演武场
描述: 外门弟子考核与比试的青石高台，四周立有旗杆
重要程度: 高
地理特征: 位于青云山南麓，青石铺地，中央有一道剑痕裂缝
主要居民/势力: 外门弟子、执事长老
所在世界/区域: 九霄测试界 / 东域青云山
entity_status: active
entity_created_at: 2026-11-04
---
# 青云宗外门演武台

## 确定性设定（已揭露，不可违背）
外门演武台是外门弟子考核与日常比试的场所，中央剑痕为旧战遗迹。

## 不确定性（未解之谜 / 剧情潜力）
剑痕的来历与藏经阁旧档可能存在关联。

## 与其他元素的互信息
青云宗在此举行考核，王虎与林玄的对峙发生于此。

## 变更记录
- 2026-11-04：外门考核在此举行，林玄当众反制王虎。
`;
}

function buildItem() {
    return `---
tags: [物品功法]
名称: 发烫的令牌
类型: 信物
描述: 林玄父亲留下的黑色令牌，遇险或接近灵力时会发热
效果: 在危急时引导灵力，似乎能绕过部分封印
品阶/等级: 未知
所属/归属: 林玄
entity_status: active
entity_created_at: 2026-11-04
---
# 发烫的令牌

## 确定性设定（已揭露，不可违背）
令牌为黑色石质，遇险发热，长老确认它“认”林玄。

## 不确定性（未解之谜 / 剧情潜力）
令牌的铸造者、与上古灵根的关系，以及被抹去的姓氏。

## 与其他元素的互信息
与林玄的身世主线、藏经阁旧档、长老的态度均有联系。

## 变更记录
- 2026-11-04：长老在藏经阁查看令牌，念出陌生姓氏。
`;
}

function buildCharacterSoul() {
    return `【林玄】
欲望：找到父亲并确认他还活着
恐惧：再次失去重要的人
底线：不滥杀，不牵连无辜

【苏晚】
欲望：在宗门里站稳脚跟并保护在意的人
恐惧：被家族当作联姻筹码
底线：不出卖同门
`;
}

function buildGeneric() {
    return `## 模拟响应
这是本地模拟 AI 返回的确定性内容，用于端到端测试。

## 说明
未识别到具体步骤关键词，已返回安全占位内容。
`;
}

function buildSettlement() {
    const timestamp = new Date().toISOString();
    return `---
tags: [结算表]
卷: "第1卷"
章: "第1章"
step_status: generated
step_model: "mock-model"
step_timestamp: ${timestamp}
结算时间: ${timestamp}
结算状态: completed
settlement_mode: full
---

# 第1章 结算表

## 更新状态
- 人物状态更新：1 人
- 伏笔状态更新：0 个

## 新建元素
- 新建人物：1 个
- 新建地点：1 个
- 新建势力：1 个
- 新建物品功法：1 个
- 新建伏笔：1 个
- 新建时间线事件：1 个
`;
}

function buildContent(kind, system, user) {
    switch (kind) {
        case 'infoPlan': return buildInfoPlan();
        case 'plotDistill': return buildPlotDistill();
        case 'outline': return buildOutline();
        case 'emotionPlan': return buildEmotionPlan();
        case 'sceneExpand': return buildSceneExpand();
        case 'bodyGeneration': return buildBody(user);
        case 'qualityControl': return buildQualityControl();
        case 'analysisReport': return buildAnalysisReport();
        case 'worldview': return buildWorldview();
        case 'character': return buildCharacter();
        case 'faction': return buildFaction();
        case 'location': return buildLocation();
        case 'item': return buildItem();
        case 'characterSoul': return buildCharacterSoul();
        case 'settlement': return buildSettlement();
        case 'unitBody': return buildUnitBody(system, user);
        case 'modeDocument': return buildModeDocument(system, user);
        default: return buildGeneric();
    }
}

function recordRequest(kind, stream) {
    state.total += 1;
    state.byKind[kind] = (state.byKind[kind] || 0) + 1;
    state.lastRequests.unshift({ kind, stream: Boolean(stream), at: Date.now() });
    if (state.lastRequests.length > 40) state.lastRequests.length = 40;
}

function openAiChunk(model, content, finishReason = null) {
    return {
        id: `chatcmpl-mock-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{
            index: 0,
            delta: content ? { content } : {},
            finish_reason: finishReason,
        }],
    };
}

async function handleChat(req, res, isOllama) {
    const body = await readBody(req);
    const { system, user } = normalizeMessages(body);
    const kind = detectKind(system, user);
    const stream = body?.stream === true;
    recordRequest(kind, stream);

    if (state.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, state.delayMs));
    }

    const content = buildContent(kind, system, user);
    const model = body?.model || 'mock-model';

    if (isOllama) {
        if (stream) {
            res.writeHead(200, {
                ...CORS_HEADERS,
                'Content-Type': 'application/x-ndjson; charset=utf-8',
                'Cache-Control': 'no-cache',
            });
            const chunkSize = 160;
            for (let i = 0; i < content.length; i += chunkSize) {
                res.write(`${JSON.stringify({ model, response: content.slice(i, i + chunkSize), done: false })}\n`);
            }
            res.write(`${JSON.stringify({ model, response: '', done: true, done_reason: 'stop' })}\n`);
            res.end();
            return;
        }
        sendJson(res, { model, response: content, done: true, done_reason: 'stop' });
        return;
    }

    if (stream) {
        res.writeHead(200, {
            ...CORS_HEADERS,
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        const chunkSize = 160;
        for (let i = 0; i < content.length; i += chunkSize) {
            res.write(`data: ${JSON.stringify(openAiChunk(model, content.slice(i, i + chunkSize)))}\n\n`);
        }
        res.write(`data: ${JSON.stringify(openAiChunk(model, '', 'stop'))}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
    }

    sendJson(res, {
        id: `chatcmpl-mock-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{
            index: 0,
            message: { role: 'assistant', content },
            finish_reason: 'stop',
        }],
        usage: {
            prompt_tokens: Math.max(1, Math.ceil((system.length + user.length) / 2)),
            completion_tokens: Math.ceil(content.length / 2),
            total_tokens: Math.ceil((system.length + user.length + content.length) / 2),
        },
    });
}

const server = http.createServer(async (req, res) => {
    try {
        if (req.method === 'OPTIONS') {
            sendEmpty(res);
            return;
        }

        const url = new URL(req.url || '/', 'http://127.0.0.1');
        const pathname = url.pathname.replace(/\/+$/, '') || '/';

        if (req.method === 'GET' && (pathname === '/v1/models' || pathname === '/models')) {
            sendJson(res, {
                object: 'list',
                data: [{
                    id: 'mock-model',
                    object: 'model',
                    created: Math.floor(Date.now() / 1000),
                    owned_by: 'novel-writer-ai-e2e',
                }],
            });
            return;
        }

        if (req.method === 'GET' && pathname === '/__mock/stats') {
            sendJson(res, {
                total: state.total,
                byKind: { ...state.byKind },
                delayMs: state.delayMs,
                lastRequests: [...state.lastRequests],
            });
            return;
        }

        if (req.method === 'POST' && pathname === '/__mock/reset') {
            state.total = 0;
            state.byKind = Object.create(null);
            state.lastRequests = [];
            sendJson(res, { ok: true });
            return;
        }

        if (req.method === 'POST' && pathname === '/__mock/config') {
            const body = await readBody(req);
            if (typeof body?.delayMs === 'number' && body.delayMs >= 0) {
                state.delayMs = body.delayMs;
            }
            sendJson(res, { ok: true, delayMs: state.delayMs });
            return;
        }

        if (req.method === 'POST' && (pathname === '/v1/chat/completions' || pathname === '/chat/completions')) {
            await handleChat(req, res, false);
            return;
        }

        if (req.method === 'POST' && pathname === '/api/generate') {
            await handleChat(req, res, true);
            return;
        }

        sendJson(res, { error: `未实现的 mock 端点：${req.method} ${pathname}` }, 404);
    } catch (error) {
        if (!res.headersSent) {
            sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
        } else {
            res.end();
        }
    }
});

server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    process.stdout.write(`MOCK_AI_READY ${JSON.stringify({ port })}\n`);
});

function shutdown() {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('disconnect', shutdown);
