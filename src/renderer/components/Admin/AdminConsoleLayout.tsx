import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `text-sm font-medium transition-colors ${isActive ? 'text-sky-400' : 'text-white/55 hover:text-white/85'}`;

const AdminConsoleLayout: React.FC = () => {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <header className="border-b border-white/10 px-6 py-4 flex flex-wrap gap-4 items-center justify-between">
        <div className="flex flex-wrap items-center gap-6">
          <h1 className="text-lg font-semibold tracking-tight">Aixflow 运营控制台</h1>
          <nav className="flex gap-5">
            <NavLink to="/admin" end className={linkClass}>
              概览
            </NavLink>
            <NavLink to="/admin/tasks" className={linkClass}>
              任务运维
            </NavLink>
            <NavLink to="/admin/models" className={linkClass}>
              模型定价
            </NavLink>
            <NavLink to="/admin/users" className={linkClass}>
              用户管理
            </NavLink>
            <NavLink to="/admin/finance" className={linkClass}>
              财务分析
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="flex-1 p-6 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
};

export default AdminConsoleLayout;
