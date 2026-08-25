import React from 'react';
import ReactDOM from 'react-dom/client';
import KaraokeBurnOverlayApp from './KaraokeBurnOverlayApp';

document.documentElement.style.cssText =
  'margin:0;padding:0;background:transparent;overflow:hidden;';
document.body.style.cssText =
  'margin:0;padding:0;background:transparent;overflow:hidden;width:100vw;height:100vh;';

const rootEl = document.getElementById('root');
if (rootEl) {
  // 勿用 StrictMode：双挂载会重复 boot，干扰主进程握手
  ReactDOM.createRoot(rootEl).render(<KaraokeBurnOverlayApp />);
}
