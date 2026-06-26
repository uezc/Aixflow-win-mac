import React, { useState } from 'react';
import brandLogoUrl from '../assets/brandLogo';

/** 与 FC db-tablestore RECHARGE_TIERS_CNY、兑换入账档位一致 */
const COUPON_AMOUNT_TIERS = [50, 100, 300, 1000] as const;

/**
 * 管理员后台：激活码 + 云端兑换码签发
 * 访问方式：应用内 Hash 路由 #/admin
 * 兑换码签发依赖 .env 与 FC 中相同的 NX_ADMIN_ISSUE_COUPON_SECRET
 * embedded：嵌入运营控制台内页时不占满整屏
 */
const AdminActivationGenerator: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const [days, setDays] = useState(30);
  const [code, setCode] = useState('');
  const [toast, setToast] = useState('');
  const [generating, setGenerating] = useState(false);
  const [iconError, setIconError] = useState(false);

  const [couponTier, setCouponTier] = useState<(typeof COUPON_AMOUNT_TIERS)[number]>(100);
  const [couponCode, setCouponCode] = useState('');
  const [couponToast, setCouponToast] = useState('');
  const [couponBusy, setCouponBusy] = useState(false);

  const handleGenerate = async () => {
    if (!window.electronAPI?.generateActivationCode) {
      setToast('当前环境不支持生成');
      return;
    }
    setGenerating(true);
    setToast('');
    try {
      const { code: newCode } = await window.electronAPI.generateActivationCode(days);
      setCode(newCode);
      setToast('已复制到剪贴板');
      setTimeout(() => setToast(''), 2500);
    } catch {
      setToast('生成失败，请重试');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = () => {
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      setToast('已复制到剪贴板');
      setTimeout(() => setToast(''), 2500);
    });
  };

  const handleIssueCoupon = async () => {
    if (!window.electronAPI?.adminIssueCoupon) {
      setCouponToast('当前环境不支持签发兑换码');
      return;
    }
    setCouponBusy(true);
    setCouponToast('');
    try {
      const r = await window.electronAPI.adminIssueCoupon(couponTier);
      setCouponCode(r.code);
      setCouponToast(`已生成 ${r.amount_cny} 元档兑换码并复制到剪贴板`);
      setTimeout(() => setCouponToast(''), 3500);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setCouponToast(msg || '签发失败');
    } finally {
      setCouponBusy(false);
    }
  };

  const handleCopyCoupon = () => {
    if (!couponCode) return;
    navigator.clipboard.writeText(couponCode).then(() => {
      setCouponToast('已复制到剪贴板');
      setTimeout(() => setCouponToast(''), 2500);
    });
  };

  return (
    <div
      className={
        embedded
          ? 'bg-transparent text-white flex flex-col items-center py-4 px-2 gap-10 w-full'
          : 'min-h-screen bg-black text-white flex flex-col items-center py-10 px-6 gap-12'
      }
    >
      <div className="flex flex-col items-center w-full max-w-md">
        <div className="flex justify-center mb-6">
          {!iconError ? (
            <img
              src={brandLogoUrl}
              alt="Aixflow"
              onError={() => setIconError(true)}
              className="max-w-[256px] max-h-[256px] w-auto h-auto object-contain select-none"
            />
          ) : (
            <div className="w-32 h-32 rounded-full bg-white/10 flex items-center justify-center text-white/50 text-4xl font-bold">
              A
            </div>
          )}
        </div>
        <h1 className="text-2xl font-bold text-center mb-6 tracking-wide text-white">管理员后台</h1>

        <h2 className="text-lg font-semibold text-white/90 w-full mb-3">激活码（本地授权）</h2>
        <div className="w-full space-y-6 rounded-2xl bg-white/5 border border-white/10 p-6 mb-10">
          <div>
            <label className="block text-sm text-white/80 mb-2">授权天数</label>
            <input
              type="number"
              min={1}
              max={3650}
              value={days}
              onChange={(e) => setDays(Math.max(1, Math.min(3650, Number(e.target.value) || 30)))}
              className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-white/50"
              aria-label="授权天数"
              placeholder="30"
            />
          </div>

          <div>
            <label className="block text-sm text-white/80 mb-2">生成的激活码</label>
            <input
              readOnly
              value={code}
              placeholder="点击下方按钮生成"
              className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-xl text-white placeholder-white/30 font-mono text-sm"
              aria-label="生成的激活码"
            />
            {code ? (
              <button
                type="button"
                onClick={handleCopy}
                className="mt-2 text-sm text-white/70 hover:text-white underline"
              >
                再次复制
              </button>
            ) : null}
          </div>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            aria-label="生成激活码并复制到剪贴板"
            className="w-full py-4 bg-white text-black font-semibold rounded-xl hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {generating ? '生成中...' : '生成并复制'}
          </button>

          {toast ? <p className="text-center text-sm text-white/80">{toast}</p> : null}
        </div>

        <h2 className="text-lg font-semibold text-white/90 w-full mb-3">云端兑换码（Tablestore）</h2>
        <div className="w-full space-y-5 rounded-2xl bg-white/5 border border-amber-500/25 p-6">
          <p className="text-xs text-white/45 leading-relaxed">
            需在项目根目录 <span className="font-mono text-white/60">.env</span> 与函数计算环境中配置相同的{' '}
            <span className="font-mono text-amber-200/80">NX_ADMIN_ISSUE_COUPON_SECRET</span>
            ，并部署含 <span className="font-mono">POST /internal/issue-coupon</span> 的 FC 版本。
          </p>
          <div>
            <label className="block text-sm text-white/80 mb-2">面值（人民币，入账档位）</label>
            <div className="flex flex-wrap gap-2">
              {COUPON_AMOUNT_TIERS.map((yuan) => (
                <button
                  key={yuan}
                  type="button"
                  onClick={() => setCouponTier(yuan)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    couponTier === yuan
                      ? 'bg-amber-500 text-black'
                      : 'bg-white/10 text-white/80 hover:bg-white/15'
                  }`}
                >
                  {yuan} 元
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm text-white/80 mb-2">生成的兑换码</label>
            <input
              readOnly
              value={couponCode}
              placeholder="选择档位后点击生成"
              className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-xl text-white placeholder-white/30 font-mono text-sm"
              aria-label="生成的兑换码"
            />
            {couponCode ? (
              <button
                type="button"
                onClick={handleCopyCoupon}
                className="mt-2 text-sm text-white/70 hover:text-white underline"
              >
                再次复制
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={handleIssueCoupon}
            disabled={couponBusy}
            className="w-full py-4 bg-amber-500 text-black font-semibold rounded-xl hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {couponBusy ? '签发中…' : '生成兑换码并复制'}
          </button>
          {couponToast ? (
            <p className="text-center text-sm text-amber-200/90 whitespace-pre-wrap">{couponToast}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default AdminActivationGenerator;
