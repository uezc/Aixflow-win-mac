/**
 * 实时听写 PCM 采集（AudioWorklet）。
 * 须为独立静态文件：Electron CSP 禁止 blob: script-src，内联 Blob URL 会加载失败。
 */
class NexflowPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Float32Array(2048);
    this._off = 0;
  }
  process(inputs) {
    const ch0 = inputs[0] && inputs[0][0];
    if (ch0 && ch0.length > 0) {
      let i = 0;
      while (i < ch0.length) {
        const space = this._buf.length - this._off;
        const n = Math.min(space, ch0.length - i);
        this._buf.set(ch0.subarray(i, i + n), this._off);
        this._off += n;
        i += n;
        if (this._off >= this._buf.length) {
          const copy = this._buf.slice();
          this.port.postMessage(copy);
          this._off = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('nexflow-pcm-capture', NexflowPcmCaptureProcessor);
