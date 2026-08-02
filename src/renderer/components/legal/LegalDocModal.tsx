import React from 'react';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { legalUiT } from '../../legal/legalI18n';
import type { LegalDocId } from '../../legal/legalDocs';
import {
  DarkModalFrame,
  darkModalBtnOkClass,
  darkModalFooterClass,
  darkModalHeaderClass,
  DARK_MODAL_Z,
} from '../darkModalShell';
import { LegalDocViewer } from './LegalDocViewer';

type Props = {
  open: boolean;
  docId: LegalDocId | null;
  onClose: () => void;
  /** 叠在首次确认弹窗之上时使用 */
  stackZClass?: string;
};

export const LegalDocModal: React.FC<Props> = ({
  open,
  docId,
  onClose,
  stackZClass = DARK_MODAL_Z,
}) => {
  const { locale } = useAppLocale();
  const t = legalUiT(locale);
  if (!open || !docId) return null;

  return (
    <DarkModalFrame
      open={open}
      onBackdropClick={onClose}
      stackZClass={stackZClass}
      panelClassName="nexflow-glass-panel flex w-full max-w-[min(92vw,720px)] flex-col overflow-hidden rounded-2xl border border-white/[0.12] shadow-2xl mx-4 max-h-[min(88vh,680px)]"
      brandLabel="Aixflow"
      showBrandHeader={false}
      footer={
        <div className={darkModalFooterClass}>
          <button type="button" onClick={onClose} className={darkModalBtnOkClass}>
            {t.close}
          </button>
        </div>
      }
    >
      <div className={darkModalHeaderClass}>{t.docTitle(docId)}</div>
      <div className="min-h-0 flex-1 overflow-hidden px-5 py-4">
        <LegalDocViewer docId={docId} />
      </div>
    </DarkModalFrame>
  );
};
