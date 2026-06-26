import React from 'react';
import { Outlet } from 'react-router-dom';

/** 与快捷键逻辑一致：解锁后写入 sessionStorage */
export const ADMIN_OPS_SESSION_KEY = 'nexflow_admin_ops';

type Props = { unlockBump: number };

/**
 * 未解锁时仅展示提示；解锁后渲染子路由（运营控制台布局）。
 * unlockBump 由父级在快捷键触发后递增，以触发本组件重新读取 sessionStorage。
 */
const AdminRouteGate: React.FC<Props> = ({ unlockBump }) => {
  void unlockBump;
  const ok = typeof sessionStorage !== 'undefined' && sessionStorage.getItem(ADMIN_OPS_SESSION_KEY) === '1';
  if (!ok) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-4 px-6">
        <p className="text-white/85 text-center max-w-md text-lg">运营控制台已隐藏</p>
        <p className="text-white/50 text-sm text-center leading-relaxed">
          请使用快捷键解锁后再访问本页。
          <br />
          Windows / Linux：<span className="text-white/70">Ctrl + Shift + A</span>
          <br />
          macOS：<span className="text-white/70">⌘ + Shift + A</span>
        </p>
      </div>
    );
  }
  return <Outlet />;
};

export default AdminRouteGate;
