/** MV 选角内置作品参考图（public/director-cast-presets） */

export type DirectorCastArtworkPreset = {
  id: string;
  name: string;
  labelZh: string;
  labelEn: string;
  /** public/director-cast-presets 下文件名 */
  imageFile: string;
  /** 写入角色 prompt 的外观描述（中文） */
  promptZh: string;
};

/** 女角色在前，男角色在后；按 promptZh 关键词区分性别槽 */
export const DIRECTOR_CAST_ARTWORK_PRESETS: readonly DirectorCastArtworkPreset[] = [
  {
    id: 'balc',
    name: 'BALC',
    labelZh: 'Balc',
    labelEn: 'BALC',
    imageFile: 'balc.png',
    promptZh:
      '长波浪深棕发亚裔女性，白色碎花花冠，白蕾丝波西米亚长袖连衣裙，阳光森林柔焦背景，空灵感',
  },
  {
    id: 'boda',
    name: 'BODA',
    labelZh: 'Boda',
    labelEn: 'BODA',
    imageFile: 'boda.png',
    promptZh:
      '短金发亚裔女性，浓妆红唇与右眼下美人痣，彩色抽象图案西装外套，大钻环耳环，高饱和几何背景，时尚 MV 感',
  },
  {
    id: 'eyck',
    name: 'EYCK',
    labelZh: 'Eyck',
    labelEn: 'EYCK',
    imageFile: 'eyck.png',
    promptZh:
      '高马尾亚裔女性，金环耳环，蓝白黄拼色复古运动夹克，黄昏城市屋顶散景，冷艳都市气质',
  },
  {
    id: 'horer',
    name: 'HORER',
    labelZh: 'Horer',
    labelEn: 'HORER',
    imageFile: 'horer.png',
    promptZh:
      '湿发背头亚裔女性，苍白肤色，哥特黑眼妆与黑唇，黑色高领蕾丝裙，烛台与哥特拱窗暗调背景',
  },
  {
    id: 'grl',
    name: 'GRL',
    labelZh: 'Grl',
    labelEn: 'GRL',
    imageFile: 'grl.png',
    promptZh:
      '凌乱中长发与碎刘海亚裔女性，黑色机车皮夹克与图案 T 恤，多层银链大环耳环，粉蓝霓虹巷弄夜景',
  },
  {
    id: 'coco',
    name: 'COCO',
    labelZh: 'Coco',
    labelEn: 'COCO',
    imageFile: 'coco.png',
    promptZh:
      '长深色湿感头发亚裔女性，黑色铆钉机车皮夹克与细银链，工业灰墙墨迹背景，冷峻街头气质',
  },
  {
    id: 'ealis',
    name: 'EALIS',
    labelZh: 'Ealis',
    labelEn: 'EALIS',
    imageFile: 'ealis.png',
    promptZh:
      '长波浪深棕发亚裔女性，回眸看镜头，白色蕾丝吊带上衣，户外绿植逆光，柔和浪漫气质',
  },
  {
    id: 'mas',
    name: 'MAS',
    labelZh: 'Mas',
    labelEn: 'MAS',
    imageFile: 'mas.png',
    promptZh:
      '短黑发波波头亚裔女性，下巴托于袖口，奶油色毛绒开衫与浅色吊带，竹影光斑浅色墙，清新氛围',
  },
  {
    id: 'sasm',
    name: 'SASM',
    labelZh: 'Sasm',
    labelEn: 'SASM',
    imageFile: 'sasm.png',
    promptZh:
      '长波浪深发亚裔女性，黑色闪片挂脖上衣，深蓝暗调与银色迪斯科球，夜店华丽气质',
  },
  {
    id: 'yepa',
    name: 'YEPA',
    labelZh: 'Yepa',
    labelEn: 'YEPA',
    imageFile: 'yepa.png',
    promptZh:
      '长直黑发齐刘海亚裔女性，手托脸颊，白色露肩针织毛衣，暖光室内柔焦背景，温柔气质',
  },
  {
    id: 'lisa',
    name: 'LISA',
    labelZh: 'Lisa',
    labelEn: 'LISA',
    imageFile: 'lisa.png',
    promptZh:
      '高丸子头亚裔女性，银饰发夹，黑色薄纱荷叶肩服装，回眸蓝光舞台背景，优雅冷调',
  },
  {
    id: 'zhuli',
    name: 'ZHULI',
    labelZh: 'Zhuli',
    labelEn: 'ZHULI',
    imageFile: 'zhuli.png',
    promptZh:
      '侧辫与碎刘海亚裔女性，淡粉红蕾丝 V 领上衣，浅粉紫柔光背景，空灵浪漫气质',
  },
  {
    id: 'mavy',
    name: 'MAVY',
    labelZh: 'Mavy',
    labelEn: 'MAVY',
    imageFile: 'mavy.png',
    promptZh:
      '湿发刘海亚裔青年，黑色机车皮夹克与黑 T 恤，粗银链与小环耳环，粉蓝霓虹夜景，冷峻偶像感',
  },
  {
    id: 'giuf',
    name: 'GIUF',
    labelZh: 'Giuf',
    labelEn: 'GIUF',
    imageFile: 'giuf.png',
    promptZh:
      '中长发微须亚裔青年，手托下巴，浅棕西装外套与黑色衬衫，浅色影棚背景，成熟沉稳气质',
  },
  {
    id: 'chen',
    name: 'CHEN',
    labelZh: 'Chen',
    labelEn: 'CHEN',
    imageFile: 'chen.png',
    promptZh:
      '短发微须亚裔青年，黑色西装外套与开领黑衬衫，暗调侧光影棚，成熟都市男主气质',
  },
  {
    id: 'yanc',
    name: 'YANC',
    labelZh: 'Yanc',
    labelEn: 'YANC',
    imageFile: 'yanc.png',
    promptZh:
      '凌乱刘海亚裔青年，黑白图案开领衬衫，金色粗链与小环耳环，城市夜景散景暖光，时尚偶像感',
  },
  {
    id: 'axx',
    name: 'AXX',
    labelZh: 'Axx',
    labelEn: 'AXX',
    imageFile: 'axx.png',
    promptZh:
      '银灰金发亚裔青年，黑色宽驳头西装，多层银链与小环耳环，粉紫霓虹几何背景，酷感偶像气质',
  },
  {
    id: 'pock',
    name: 'POCK',
    labelZh: 'Pock',
    labelEn: 'POCK',
    imageFile: 'pock.png',
    promptZh:
      '蓬松波浪发亚裔青年，灰黑大理石纹衬衫，双层银链与吊坠小环耳环，冷灰影棚，潮流偶像气质',
  },
  {
    id: 'sxae',
    name: 'SXAE',
    labelZh: 'Sxae',
    labelEn: 'SXAE',
    imageFile: 'sxae.png',
    promptZh:
      '凌乱深发亚裔青年，白色纹理透感衬衫，双层银链与吊坠小环耳环，户外绿植暖金光，柔和浪漫气质',
  },
  {
    id: 'xtcf',
    name: 'XTCF',
    labelZh: 'Xtcf',
    labelEn: 'XTCF',
    imageFile: 'xtcf.png',
    promptZh:
      '厚黑发刘海亚裔青年，白色开领衬衫，浅灰影棚柔光，干净清爽少年偶像气质',
  },
  {
    id: 'hailun',
    name: 'HAILUN',
    labelZh: 'Hailun',
    labelEn: 'HAILUN',
    imageFile: 'hailun.png',
    promptZh:
      '湿感乱发亚裔青年，黑色纹理开领衬衫，双层银链与环耳环，暖侧光沙色背景，强烈冷峻气质',
  },
  {
    id: 'hpi',
    name: 'HPI',
    labelZh: 'Hpi',
    labelEn: 'HPI',
    imageFile: 'hpi.png',
    promptZh:
      '中分蓬松黑发亚裔青年，黑色高领毛衣与西装外套，浅色影棚侧光，精致成熟男主气质',
  },
  {
    id: 'loopr',
    name: 'LOOPR',
    labelZh: 'Loopr',
    labelEn: 'LOOPR',
    imageFile: 'loopr.png',
    promptZh:
      '侧脸仰望的亚裔青年，白色开领衬衫，双层银链吊坠，海边阴天柔光，忧郁空灵感',
  },
  {
    id: 'eub',
    name: 'EUB',
    labelZh: 'Eub',
    labelEn: 'EUB',
    imageFile: 'eub.png',
    promptZh:
      '侧脸凝视的亚裔青年，黑色高领毛衣与纹理外套，小环耳环，窗纱冷调背景，忧郁时尚气质',
  },
];

export function directorCastArtworkImageUrl(imageFile: string | undefined | null): string {
  const file = String(imageFile || '').trim();
  if (!file) return '';
  return `./director-cast-presets/${file}`;
}

export function getDirectorCastArtworkPreset(id: string | undefined | null): DirectorCastArtworkPreset | null {
  const key = String(id || '').trim();
  if (!key) return null;
  return DIRECTOR_CAST_ARTWORK_PRESETS.find((p) => p.id === key) || null;
}
