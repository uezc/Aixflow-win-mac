import { useCallback, useMemo, useRef, type MutableRefObject } from 'react';
import type { RealtimeDictationStatus } from './useCloudRealtimeDictation';
import {
  bindPushToTalkPointerHandlers,
  type PushToTalkPointerHandlers,
} from '../utils/pushToTalkPointer';

export type UseDictationPushToTalkOptions = {
  start: () => Promise<boolean>;
  stop: () => void | Promise<unknown>;
  cancel: () => void;
  status: RealtimeDictationStatus;
  disabled?: boolean;
  /** 按下时若返回 false 则不开始（例如尚未聚焦输入框） */
  canStart?: () => boolean;
};

/**
 * 云端实时听写的 push-to-talk：按住 start、松开 stop/cancel；
 * 处理松开过快（connecting 中 cancel）与 start 完成后才发现已松开的竞态。
 */
export function useDictationPushToTalk(opts: UseDictationPushToTalkOptions): {
  pressStart: () => void;
  pressEnd: () => void;
  pointerHandlers: PushToTalkPointerHandlers;
  holdingRef: MutableRefObject<boolean>;
} {
  const heldRef = useRef(false);
  const statusRef = useRef(opts.status);
  statusRef.current = opts.status;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const pressStart = useCallback(() => {
    const o = optsRef.current;
    if (o.disabled || heldRef.current) return;
    const st = statusRef.current;
    // connecting / stopping 允许重入：第二次按住必须能打断卡死的转圈
    if (st === 'listening') return;
    if (o.canStart && !o.canStart()) return;
    heldRef.current = true;
    void o.start().then((ok) => {
      if (!heldRef.current && ok) {
        void o.stop();
      }
    });
  }, []);

  const pressEnd = useCallback(() => {
    if (!heldRef.current) return;
    heldRef.current = false;
    const st = statusRef.current;
    if (st === 'listening' || st === 'stopping') {
      void optsRef.current.stop();
      return;
    }
    // connecting：不要 cancel。否则「按住→等 FC 建连→误以为松开就没了」会把启动掐死，体感完全无效果。
    // start().then 里若发现已松手会自动 stop。
    if (st === 'connecting') return;
    optsRef.current.cancel();
  }, []);

  const pointerHandlers = useMemo(
    () =>
      bindPushToTalkPointerHandlers({
        onPressStart: pressStart,
        onPressEnd: pressEnd,
        disabled: () => !!optsRef.current.disabled,
      }),
    [pressStart, pressEnd],
  );

  return { pressStart, pressEnd, pointerHandlers, holdingRef: heldRef };
}
