/** RunningHub RVC 翻唱 App 2073040724471406593 预置 model_name 列表（47 项） */
export const RH_RVC_PRESET_MODEL_PATHS: readonly string[] = [
  '1000shenzi/ouximei.pth',
  '1000tianmeiV2/mi-test.pth',
  '1haomoxing/1.pth',
  '2888萝莉音/2888.pth',
  '2haomoxing/2.pth',
  '3haomoxing/3.pth',
  'JapanTatoeb/mi-tatoeba-yomi.pth',
  'JapanmoxingCommonVoice/cv-corpus-woman-cool-02a8.pth',
  'Shaoyu/Shaoyu.pth',
  'XiaoM48/XiaoM48.pth',
  'bachong/BACHONGSHENZI1.pth',
  'chuxuenew/chuxuenew.pth',
  'chuxuetest/chuxuetest.pth',
  'chuxuexue/chuxuexue.pth',
  'default/default.pth',
  'diantai/diantai.pth',
  'jianmo/ayjm1_e240.pth',
  'jiu/qunmei.pth',
  'jiuyue/jiuyue.pth',
  'keruan/keruan.pth',
  'keruanv2/keruanv2.pth',
  'lanyangyang/lanyangyang.pth',
  'lingyin/lins.pth',
  'nanshen/ddly.pth',
  'naxida/Nahida.pth',
  'shaoluo/shaoluo.pth',
  'shaoluoqiqiplus/shaoluoqiqiplus.pth',
  'shaonvyin/shaonvyin.pth',
  'v1jiujiruanmei/keruan4.pth',
  'wenrounvsheng/mi-test2333.pth',
  'wenrouyujie/wenrou.pth',
  'xiaojuDLC/xiaojuDLC.pth',
  'xinguaiV1/xinguaiV1.pth',
  'xinguaiV2/xinguaiV2.pth',
  'xinhai/xinhai_e500.pth',
  'xuegao/xuegao.pth',
  'yezi/yezi.pth',
  'yin/shaonv.pth',
  'yujie-rvc/yujie.pth',
  'yves/yves.pth',
  'zhenxun/yuejie.pth',
  'zhj/zhj.pth',
  'zhoushuyi/zhoujie.pth',
  'zhouzhou/zhouzhou.pth',
  '极品少女/青雀.pth',
  '纯真少女三月/三月七.pth',
  '罕见少萝(自练)/kekev2_e300.pth',
];

export function isRhRvcPresetModelPath(path: string | undefined | null): boolean {
  const p = String(path ?? '').trim();
  if (!p) return false;
  return RH_RVC_PRESET_MODEL_PATHS.includes(p);
}

/** RH RunningHubRVCModelLoader 仅接受上表 47 项；openapi/ 上传也会 805 */
export const RH_RVC_COVER_CUSTOM_MODEL_BLOCKED_MSG =
  'RunningHub「RVC 翻唱」API 目前只接受官方 47 个预置 model_name，自训练/导入的 .pth 即使上传到媒体库（openapi/…）也会被拒绝（805 Value not in list）。请在 RVC 翻唱面板填写预置路径（如 zhouzhou/zhouzhou.pth），或联系 RunningHub 开放自训练模型。';

export function assertRhRvcCoverModelFieldAllowed(modelField: string): void {
  const p = String(modelField ?? '').trim();
  if (!p) throw new Error('RVC 翻唱缺少 model_name');
  if (isRhRvcPresetModelPath(p)) return;
  throw new Error(RH_RVC_COVER_CUSTOM_MODEL_BLOCKED_MSG);
}
