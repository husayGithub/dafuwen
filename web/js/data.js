/* 城市资本家 City Tycoon — 游戏配置数据
 * 所有可调参数集中在这里，方便后续做经济平衡。
 */
(function (global) {
  'use strict';

  const RULES = {
    startCash: 10000,
    passStartBonus: 2000,
    diceSides: 6,
    maxLevel: 3,
    groupRentMultiplier: 2,
    stockFee: 0.01,
    maxStockTradesPerTurn: 2,
    depositInterest: 0.02,
    loanInterest: 0.05,
    interestInterval: 5,
    loanCapRatio: 0.5,
    mortgageRatio: 0.5,
    taxRate: 0.05,
    taxMin: 300,
    auctionStartRatio: 0.5,
    auctionStep: 100,
    maxLog: 180,
    maxStockHistory: 40
  };

  const MODES = {
    classic: {
      id: 'classic',
      name: '经典模式',
      short: '经典',
      desc: '其他玩家全部破产即获胜，适合长时间经营',
      maxRounds: 0,
      icon: '👑'
    },
    '40': {
      id: '40',
      name: '限时模式',
      short: '40 回合',
      desc: '40 回合后按总资产排名，推荐完整来一局',
      maxRounds: 40,
      icon: '⏳'
    },
    '20': {
      id: '20',
      name: '快速模式',
      short: '20 回合',
      desc: '20 回合后按总资产排名，约 30～45 分钟',
      maxRounds: 20,
      icon: '⚡'
    }
  };

  const GROUPS = {
    res: { id: 'res', name: '住宅区', color: '#43A047', soft: '#E8F5E9', icon: '🏘️' },
    com: { id: 'com', name: '商业区', color: '#FB8C00', soft: '#FFF3E0', icon: '🏬' },
    fin: { id: 'fin', name: '金融区', color: '#1E88E5', soft: '#E3F2FD', icon: '🏦' },
    cbd: { id: 'cbd', name: 'CBD', color: '#8E24AA', soft: '#F3E5F5', icon: '🌆' }
  };

  // 租金为地价的 20% / 45% / 80%（Lv1～Lv3），空地不收租。
  // 策划案中的数值经过模拟后上调，避免地产收益远低于股票。
  function rentsOf(price) {
    return [
      Math.round(price * 0.2 / 10) * 10,
      Math.round(price * 0.45 / 10) * 10,
      Math.round(price * 0.8 / 10) * 10
    ];
  }

  const PROPERTY_LIST = [
    { id: 'p_res_1', name: '城郊小屋', group: 'res', price: 800, icon: '🏚️' },
    { id: 'p_res_2', name: '城郊公寓', group: 'res', price: 1000, icon: '🏠' },
    { id: 'p_res_3', name: '老街住宅', group: 'res', price: 1200, icon: '🏡' },
    { id: 'p_res_4', name: '社区公寓', group: 'res', price: 1400, icon: '🏢' },
    { id: 'p_res_5', name: '老城区住宅', group: 'res', price: 1600, icon: '🏘️' },
    { id: 'p_res_6', name: '河畔公寓', group: 'res', price: 1800, icon: '🌇' },
    { id: 'p_com_1', name: '商业街角', group: 'com', price: 1800, icon: '🛍️' },
    { id: 'p_com_2', name: '商业步行街', group: 'com', price: 2000, icon: '🏬' },
    { id: 'p_com_3', name: '滨河商铺', group: 'com', price: 2200, icon: '🏪' },
    { id: 'p_com_4', name: '中央商场', group: 'com', price: 2400, icon: '🏛️' },
    { id: 'p_com_5', name: '百货商场', group: 'com', price: 2600, icon: '🛒' },
    { id: 'p_com_6', name: '城市广场商铺', group: 'com', price: 2800, icon: '🎪' },
    { id: 'p_fin_1', name: '写字楼', group: 'fin', price: 3200, icon: '🏢' },
    { id: 'p_fin_2', name: '金融大厦', group: 'fin', price: 3600, icon: '🏦' },
    { id: 'p_fin_3', name: '科技园', group: 'fin', price: 4000, icon: '🛰️' },
    { id: 'p_fin_4', name: '创投大厦', group: 'fin', price: 4400, icon: '🚀' },
    { id: 'p_fin_5', name: '金融中心', group: 'fin', price: 4800, icon: '🏙️' },
    { id: 'p_cbd_1', name: 'CBD 公寓', group: 'cbd', price: 5000, icon: '🌆' },
    { id: 'p_cbd_2', name: 'CBD 写字楼', group: 'cbd', price: 5500, icon: '🏢' },
    { id: 'p_cbd_3', name: '滨江豪宅', group: 'cbd', price: 6000, icon: '🏰' },
    { id: 'p_cbd_4', name: '环球金融塔', group: 'cbd', price: 6500, icon: '🗼' },
    { id: 'p_cbd_5', name: '时代广场', group: 'cbd', price: 7000, icon: '🎡' }
  ];

  const PROPERTIES = {};
  PROPERTY_LIST.forEach(function (p) {
    PROPERTIES[p.id] = Object.assign({}, p, {
      upgradeCost: Math.round(p.price * 0.5 / 10) * 10,
      rents: rentsOf(p.price),
      mortgage: Math.round(p.price * RULES.mortgageRatio)
    });
  });

  // 40 格环形棋盘：0 起点（右下角），顺时针推进
  const BOARD = [
    { index: 0, type: 'start', name: '起点', icon: '🏁', desc: '经过或停留领取 2,000' },
    { index: 1, type: 'property', propertyId: 'p_res_1' },
    { index: 2, type: 'chance', name: '机会', icon: '❓', desc: '抽取一张事件卡' },
    { index: 3, type: 'property', propertyId: 'p_res_2' },
    { index: 4, type: 'tax', name: '税务局', icon: '🧾', desc: '缴纳现金 5% 的税款（最低 300）' },
    { index: 5, type: 'stock', name: '股票交易所', icon: '📈', desc: '买卖股票，每回合最多两笔' },
    { index: 6, type: 'property', propertyId: 'p_res_3' },
    { index: 7, type: 'property', propertyId: 'p_com_1' },
    { index: 8, type: 'chance', name: '机会', icon: '❓', desc: '抽取一张事件卡' },
    { index: 9, type: 'property', propertyId: 'p_res_4' },
    { index: 10, type: 'bank', name: '银行', icon: '🏦', desc: '存款、贷款、抵押与赎回' },
    { index: 11, type: 'property', propertyId: 'p_com_2' },
    { index: 12, type: 'chance', name: '机会', icon: '❓', desc: '抽取一张事件卡' },
    { index: 13, type: 'property', propertyId: 'p_fin_1' },
    { index: 14, type: 'auction', name: '商业拍卖', icon: '🔨', desc: '竞拍一处无主地产' },
    { index: 15, type: 'property', propertyId: 'p_com_3' },
    { index: 16, type: 'transport', name: '地铁枢纽', icon: '🚇', desc: '搭乘地铁前进 4 格' },
    { index: 17, type: 'property', propertyId: 'p_fin_2' },
    { index: 18, type: 'chance', name: '机会', icon: '❓', desc: '抽取一张事件卡' },
    { index: 19, type: 'property', propertyId: 'p_com_4' },
    { index: 20, type: 'rest', name: '城市公园', icon: '🌳', desc: '休息一下，安全地带' },
    { index: 21, type: 'property', propertyId: 'p_fin_3' },
    { index: 22, type: 'stock', name: '股票交易所', icon: '📈', desc: '买卖股票，每回合最多两笔' },
    { index: 23, type: 'property', propertyId: 'p_cbd_1' },
    { index: 24, type: 'property', propertyId: 'p_fin_4' },
    { index: 25, type: 'bank', name: '银行', icon: '🏦', desc: '存款、贷款、抵押与赎回' },
    { index: 26, type: 'property', propertyId: 'p_cbd_2' },
    { index: 27, type: 'auction', name: '商业拍卖', icon: '🔨', desc: '竞拍一处无主地产' },
    { index: 28, type: 'property', propertyId: 'p_fin_5' },
    { index: 29, type: 'transport', name: '地铁枢纽', icon: '🚇', desc: '搭乘地铁前进 4 格' },
    { index: 30, type: 'rest', name: '滨河公园', icon: '🏞️', desc: '休息一下，安全地带' },
    { index: 31, type: 'property', propertyId: 'p_cbd_3' },
    { index: 32, type: 'chance', name: '机会', icon: '❓', desc: '抽取一张事件卡' },
    { index: 33, type: 'property', propertyId: 'p_cbd_4' },
    { index: 34, type: 'tax', name: '税务局', icon: '🧾', desc: '缴纳现金 5% 的税款（最低 300）' },
    { index: 35, type: 'property', propertyId: 'p_cbd_5' },
    { index: 36, type: 'property', propertyId: 'p_res_5' },
    { index: 37, type: 'property', propertyId: 'p_res_6' },
    { index: 38, type: 'property', propertyId: 'p_com_5' },
    { index: 39, type: 'property', propertyId: 'p_com_6' }
  ];

  const STOCKS = {
    tech: {
      id: 'tech', name: '星辰科技', code: '1001', sector: 'tech', sectorName: '科技',
      price: 128.5, anchor: 128.5, volatility: 0.12, drift: 0.008, icon: '💻', color: '#7C4DFF'
    },
    re: {
      id: 're', name: '环球地产', code: '2001', sector: 're', sectorName: '房地产',
      price: 86.2, anchor: 86.2, volatility: 0.08, drift: 0.005, icon: '🏠', color: '#43A047'
    },
    auto: {
      id: 'auto', name: '飞跃汽车', code: '3001', sector: 'auto', sectorName: '汽车',
      price: 54.8, anchor: 54.8, volatility: 0.1, drift: 0.006, icon: '🚗', color: '#FB8C00'
    },
    energy: {
      id: 'energy', name: '阳光能源', code: '4001', sector: 'energy', sectorName: '新能源',
      price: 72.4, anchor: 72.4, volatility: 0.11, drift: 0.007, icon: '🔋', color: '#00ACC1'
    },
    bank: {
      id: 'bank', name: '财富银行', code: '5001', sector: 'bank', sectorName: '金融',
      price: 96.0, anchor: 96.0, volatility: 0.06, drift: 0.0035, icon: '🏦', color: '#1E88E5'
    }
  };

  const EVENT_CATEGORIES = {
    eco: { id: 'eco', name: '经济事件', color: '#43A047', icon: '📊' },
    fin: { id: 'fin', name: '金融事件', color: '#1E88E5', icon: '💹' },
    city: { id: 'city', name: '城市事件', color: '#FB8C00', icon: '🏙️' },
    player: { id: 'player', name: '玩家事件', color: '#8E24AA', icon: '🎭' }
  };

  // 30 张事件卡。effect 由引擎解释执行：
  // cash/cashAll/pctCash/perProperty/dividend/stock/rent
  const EVENTS = [
    { id: 'e01', category: 'eco', title: '经济繁荣', desc: '城市经济高速增长，所有地产租金 +20%，持续 3 回合。', effect: { type: 'rent', scope: 'all', pct: 0.2, rounds: 3 } },
    { id: 'e02', category: 'eco', title: '经济衰退', desc: '市场进入寒冬，所有地产租金 -20%，持续 2 回合。', effect: { type: 'rent', scope: 'all', pct: -0.2, rounds: 2 } },
    { id: 'e03', category: 'eco', title: '通货膨胀', desc: '物价上涨，所有地产租金 +15%，持续 2 回合。', effect: { type: 'rent', scope: 'all', pct: 0.15, rounds: 2 } },
    { id: 'e04', category: 'eco', title: '减税政策', desc: '政府发放减税红包，获得 800 现金。', effect: { type: 'cash', amount: 800 } },
    { id: 'e05', category: 'eco', title: '消费券发放', desc: '全城发放消费券，每位玩家获得 500 现金。', effect: { type: 'cashAll', amount: 500 } },
    { id: 'e06', category: 'eco', title: '产业升级补贴', desc: '获得政府补贴 1,200 现金。', effect: { type: 'cash', amount: 1200 } },
    { id: 'e07', category: 'eco', title: '物价飞涨', desc: '生活成本上升，支付 400 现金。', effect: { type: 'cash', amount: -400 } },
    { id: 'e08', category: 'city', title: '地铁开通', desc: '住宅区迎来利好，住宅区租金 +30%，持续 3 回合。', effect: { type: 'rent', scope: 'res', pct: 0.3, rounds: 3 } },
    { id: 'e09', category: 'city', title: '城市博览会', desc: '商业区客流暴涨，商业区租金 +25%，持续 3 回合。', effect: { type: 'rent', scope: 'com', pct: 0.25, rounds: 3 } },
    { id: 'e10', category: 'city', title: '城市新地标', desc: 'CBD 成为打卡圣地，CBD 租金 +30%，持续 3 回合。', effect: { type: 'rent', scope: 'cbd', pct: 0.3, rounds: 3 } },
    { id: 'e11', category: 'city', title: '金融区扩容', desc: '金融机构加速入驻，金融区租金 +25%，持续 3 回合。', effect: { type: 'rent', scope: 'fin', pct: 0.25, rounds: 3 } },
    { id: 'e12', category: 'city', title: '台风过境', desc: '名下每处地产支付 150 维修费。', effect: { type: 'perProperty', amount: -150 } },
    { id: 'e13', category: 'city', title: '旧城改造补偿', desc: '名下每处地产获得 200 补偿金。', effect: { type: 'perProperty', amount: 200 } },
    { id: 'e14', category: 'city', title: '交通管制', desc: '出行受阻，支付 300 现金。', effect: { type: 'cash', amount: -300 } },
    { id: 'e15', category: 'city', title: '城市狂欢节', desc: '参与庆典并赞助摊位，获得 600 现金。', effect: { type: 'cash', amount: 600 } },
    { id: 'e16', category: 'fin', title: '股市暴跌', desc: '恐慌情绪蔓延，所有股票下跌 10%。', effect: { type: 'stock', sector: 'all', pct: -0.1 } },
    { id: 'e17', category: 'fin', title: '牛市来了', desc: '资金涌入市场，所有股票上涨 8%。', effect: { type: 'stock', sector: 'all', pct: 0.08 } },
    { id: 'e18', category: 'fin', title: '科技突破', desc: '星辰科技发布重磅产品，股价上涨 15%。', effect: { type: 'stock', sector: 'tech', pct: 0.15 } },
    { id: 'e19', category: 'fin', title: '地产泡沫', desc: '环球地产遭遇抛售，股价下跌 15%。', effect: { type: 'stock', sector: 're', pct: -0.15 } },
    { id: 'e20', category: 'fin', title: '汽车召回', desc: '飞跃汽车召回问题车型，股价下跌 12%。', effect: { type: 'stock', sector: 'auto', pct: -0.12 } },
    { id: 'e21', category: 'fin', title: '新能源补贴', desc: '阳光能源获得政策扶持，股价上涨 15%。', effect: { type: 'stock', sector: 'energy', pct: 0.15 } },
    { id: 'e22', category: 'fin', title: '银行分红', desc: '财富银行派发红利，股价上涨 10%，并按持股市值额外获得 2% 分红。', effect: { type: 'stock', sector: 'bank', pct: 0.1, dividend: 0.02 } },
    { id: 'e23', category: 'fin', title: '税务稽查', desc: '被抽查账目，支付现金 8% 的罚款（最低 300）。', effect: { type: 'pctCash', pct: 0.08, min: 300 } },
    { id: 'e24', category: 'fin', title: '央行降息', desc: '流动性宽松，所有股票上涨 3%，并获得 500 现金。', effect: { type: 'stock', sector: 'all', pct: 0.03, cash: 500 } },
    { id: 'e25', category: 'player', title: '中彩票', desc: '好运降临，获得 2,000 现金。', effect: { type: 'cash', amount: 2000 } },
    { id: 'e26', category: 'player', title: '远房亲戚的遗产', desc: '继承一笔遗产，获得 1,500 现金。', effect: { type: 'cash', amount: 1500 } },
    { id: 'e27', category: 'player', title: '违章罚款', desc: '收到罚单，支付 500 现金。', effect: { type: 'cash', amount: -500 } },
    { id: 'e28', category: 'player', title: '慈善晚宴', desc: '慷慨解囊，支付 400 现金，赢得城市声望。', effect: { type: 'cash', amount: -400 } },
    { id: 'e29', category: 'player', title: '股票分红', desc: '获得持股当前市值 3% 的现金分红。', effect: { type: 'dividend', pct: 0.03 } },
    { id: 'e30', category: 'player', title: '合作伙伴赠礼', desc: '获得 1,000 现金，所有股票上涨 2%。', effect: { type: 'stock', sector: 'all', pct: 0.02, cash: 1000 } }
  ];

  const AVATARS = ['🦊', '🐼', '🐯', '🐸'];
  const PLAYER_COLORS = ['#FF5252', '#448AFF', '#FFB300', '#26A69A'];

  const AI_PROFILES = {
    easy: {
      id: 'easy', name: '简单',
      reserve: 1200,
      buyCashRatio: 0.55,
      groupBonus: 0.12,
      upgradeBuffer: 2500,
      stockCashRatio: 0.12,
      stockBuyDip: 0.05,
      stockSellRise: 0.08,
      auctionRatio: 0.7,
      loanAppetite: 0
    },
    normal: {
      id: 'normal', name: '普通',
      reserve: 1800,
      buyCashRatio: 0.78,
      groupBonus: 0.25,
      upgradeBuffer: 3000,
      stockCashRatio: 0.22,
      stockBuyDip: 0.04,
      stockSellRise: 0.07,
      auctionRatio: 0.85,
      loanAppetite: 0.15
    },
    hard: {
      id: 'hard', name: '困难',
      reserve: 2200,
      buyCashRatio: 0.92,
      groupBonus: 0.4,
      upgradeBuffer: 3200,
      stockCashRatio: 0.3,
      stockBuyDip: 0.03,
      stockSellRise: 0.06,
      auctionRatio: 1.05,
      loanAppetite: 0.3
    }
  };

  const CONFIG_VERSION = '1.0.0';

  const Data = {
    RULES, MODES, GROUPS, PROPERTIES, PROPERTY_LIST, BOARD, STOCKS,
    EVENTS, EVENT_CATEGORIES, AVATARS, PLAYER_COLORS, AI_PROFILES,
    CONFIG_VERSION,
    getProperty: function (id) { return PROPERTIES[id]; },
    getTile: function (i) { return BOARD[((i % 40) + 40) % 40]; },
    propertiesInGroup: function (group) {
      return PROPERTY_LIST.filter(function (p) { return p.group === group; }).map(function (p) { return p.id; });
    }
  };

  global.CityTycoonData = Data;
  if (typeof module !== 'undefined' && module.exports) module.exports = Data;
})(typeof window !== 'undefined' ? window : globalThis);