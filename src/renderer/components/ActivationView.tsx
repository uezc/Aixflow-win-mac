import React, { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Key, ArrowLeft } from 'lucide-react';
import brandLogoUrl from '../assets/brandLogo';
import AppUpdatePanel from './AppUpdatePanel';
import { useAppUpdate } from '../hooks/useAppUpdate';

/** 新安装占位示例：不预填真实格式，仅展示结构 */
const PLACEHOLDER = 'XXX-XXXXXX-XXXXXX-XXXXXXXX';

const ActivationView: React.FC<{
  activationStatus?: string;
  onActivated: () => void;
  /** 授权到期时从画布入口进入，可提供返回项目列表的回调 */
  onBack?: () => void;
}> = ({ activationStatus = 'NOT_ACTIVATED', onActivated, onBack }) => {
  const appUpdate = useAppUpdate();
  const [activationCode, setActivationCode] = useState('');
  const [validating, setValidating] = useState(false);
  const [result, setResult] = useState<{ valid: boolean; message?: string; expireAt?: number } | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [iconError, setIconError] = useState(false);

  // 检查是否已激活
  useEffect(() => {
    const checkActivation = async () => {
      if (window.electronAPI) {
        try {
          const status = await window.electronAPI.checkActivation();
          if (status.skipped || status.activated) {
            onActivated();
            return;
          }
          // 已激活过但当前状态异常（过期/设备不符/时间篡改）可在此提示，暂无额外 UI
        } catch (error) {
          console.error('检查激活状态失败:', error);
        }
      }
    };

    const timer = setTimeout(checkActivation, 100);
    return () => clearTimeout(timer);
  }, [onActivated]);

  // 格式：NXF-序列号(6位)-生成时间编码-[核销小时]-时长(1–3位)-签名(8位)，支持 3 位数授权天数
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 40);
    setActivationCode(value);
    setResult(null);
  };

  const handleValidate = async () => {
    if (!activationCode.trim()) {
      setResult({ valid: false, message: '请输入激活码' });
      return;
    }

    if (!window.electronAPI) {
      setResult({ valid: false, message: '系统未就绪，请稍后重试' });
      return;
    }

    setValidating(true);
    setResult(null);

    try {
      const validationResult = await window.electronAPI.validateActivation(activationCode);
      setResult({
        valid: validationResult.valid,
        message: validationResult.message,
        expireAt: validationResult.expireAt,
      });

      if (validationResult.valid) {
        setShowSuccess(true);
        setTimeout(() => {
          onActivated();
        }, 1500);
      }
    } catch (error) {
      setResult({ valid: false, message: '验证失败，请重试' });
    } finally {
      setValidating(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !validating) handleValidate();
  };

  const formatExpire = (expireAt?: number) => {
    if (expireAt == null) return '';
    try {
      const d = new Date(expireAt * 1000);
      return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-2xl bg-white/5 border border-white/10 p-8 space-y-6">
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            {!iconError ? (
              <img
                src={brandLogoUrl}
                alt="Aixflow"
                onError={() => setIconError(true)}
                className="max-w-[256px] max-h-[256px] w-auto h-auto object-contain select-none"
              />
            ) : (
              <Key className="w-20 h-20 text-white/70" />
            )}
          </div>
          <h2 className="text-2xl font-bold text-white tracking-wide">
            Aixflow-Bate 激活
          </h2>
          <p className="text-sm text-white/60">
            {activationStatus === 'EXPIRED'
              ? '授权已到期，无法进入画布。请重新激活以继续使用。'
              : '请输入激活码以继续使用'}
          </p>
          {activationStatus === 'EXPIRED' && (
            <p className="text-xs text-white/50">
              再次激活不会影响之前的草稿
            </p>
          )}
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-white/80">
              激活码
            </label>
            <input
              type="text"
              value={activationCode}
              onChange={handleInputChange}
              onKeyPress={handleKeyPress}
              placeholder={PLACEHOLDER}
              className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30 focus:border-white/30 text-center text-lg font-mono tracking-wider"
              disabled={validating || showSuccess}
            />
            <p className="text-xs text-white/50">
              格式：XXX-序列号(6位)-生成时间编码-[核销小时]-时长(如30/999)-签名(8位)
            </p>
          </div>

          {result && (
            <div
              className={`p-3 rounded-xl flex items-center gap-2 ${
                result.valid
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                  : 'bg-red-500/20 text-red-400 border border-red-500/30'
              }`}
            >
              {result.valid ? (
                <CheckCircle className="w-5 h-5 flex-shrink-0" />
              ) : (
                <XCircle className="w-5 h-5 flex-shrink-0" />
              )}
              <span className="text-sm">
                {result.message}
                {result.valid && result.expireAt != null && formatExpire(result.expireAt) && (
                  <span className="ml-1">（到期：{formatExpire(result.expireAt)}）</span>
                )}
              </span>
            </div>
          )}

          {showSuccess && (
            <div className="flex flex-col items-center justify-center py-4 space-y-2">
              <CheckCircle className="w-14 h-14 text-green-400" />
              <p className="text-green-400 font-medium">激活成功！</p>
              {result?.expireAt != null && formatExpire(result.expireAt) && (
                <p className="text-sm text-white/50">到期日：{formatExpire(result.expireAt)}</p>
              )}
            </div>
          )}

          <button
            onClick={handleValidate}
            disabled={validating || showSuccess || !activationCode.trim()}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white text-black font-medium rounded-xl hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {validating ? (
              <span>验证中...</span>
            ) : showSuccess ? (
              <>
                <CheckCircle className="w-4 h-4" />
                <span>激活成功</span>
              </>
            ) : (
              <span>验证激活码</span>
            )}
          </button>

          {activationStatus === 'EXPIRED' && onBack && (
            <button
              type="button"
              onClick={onBack}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-white/70 hover:text-white border border-white/20 rounded-xl hover:bg-white/5 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>返回项目列表</span>
            </button>
          )}
        </div>

        <div className="border-t border-white/10 pt-4">
          <AppUpdatePanel update={appUpdate} variant="compact" align="left" />
        </div>
      </div>
    </div>
  );
};

export default ActivationView;
