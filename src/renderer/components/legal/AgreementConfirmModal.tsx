import React, { useState } from 'react';
import { FileText } from 'lucide-react';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { legalUiT } from '../../legal/legalI18n';
import { setAgreementConfirmed } from '../../legal/agreementStorage';
import type { LegalDocId } from '../../legal/legalDocs';
import {
  DarkModalFrame,
  darkModalBtnOkClass,
  darkModalFooterClass,
} from '../darkModalShell';
import { LegalDocModal } from './LegalDocModal';

type Props = {
  open: boolean;
  onConfirmed: () => void;
};

const LINK_DOCS: { id: LegalDocId; labelKey: 'userAgreement' | 'privacyPolicy' | 'aiDisclaimer' }[] = [
  { id: 'user-agreement', labelKey: 'userAgreement' },
  { id: 'privacy-policy', labelKey: 'privacyPolicy' },
  { id: 'ai-disclaimer', labelKey: 'aiDisclaimer' },
];

/**
 * 首次进入软件协议确认。未勾选不可关闭继续使用。
 * 确认写入 localStorage: aixflow_agreement_confirmed=true
 */
export const AgreementConfirmModal: React.FC<Props> = ({ open, onConfirmed }) => {
  const { locale } = useAppLocale();
  const t = legalUiT(locale);
  const [checked, setChecked] = useState(false);
  const [viewDoc, setViewDoc] = useState<LegalDocId | null>(null);

  if (!open) return null;

  const handleAgree = () => {
    if (!checked) return;
    setAgreementConfirmed(true);
    onConfirmed();
  };

  return (
    <>
      <DarkModalFrame
        open={open}
        /* 不允许点击背景关闭 */
        stackZClass="z-[100020]"
        panelClassName="nexflow-glass-panel flex w-full max-w-[min(100%,420px)] flex-col overflow-hidden rounded-2xl border border-white/[0.12] shadow-2xl mx-4"
        brandLabel="Aixflow"
        footer={
          <div className={darkModalFooterClass}>
            <button
              type="button"
              disabled={!checked}
              onClick={handleAgree}
              className={`${darkModalBtnOkClass} min-w-[140px] disabled:cursor-not-allowed disabled:opacity-40`}
            >
              {t.agreeContinue}
            </button>
          </div>
        }
      >
        <div className="px-5 pb-2 pt-5 sm:px-6">
          <div className="mb-3 flex items-center justify-center gap-2 text-amber-300/90">
            <FileText className="h-5 w-5 shrink-0" aria-hidden />
          </div>
          <h2 className="text-center text-lg font-semibold tracking-tight text-white sm:text-xl">
            {t.welcomeTitle}
          </h2>
          <p className="mt-3 text-center text-sm leading-relaxed text-white/65">{t.welcomeIntro}</p>
          <ul className="mt-4 space-y-2">
            {LINK_DOCS.map(({ id, labelKey }) => (
              <li key={id} className="text-center">
                <button
                  type="button"
                  onClick={() => setViewDoc(id)}
                  className="text-sm font-medium text-sky-300/95 underline-offset-2 hover:underline"
                >
                  《{t[labelKey]}》
                </button>
              </li>
            ))}
          </ul>
          <label className="mt-5 flex cursor-pointer items-start gap-2.5 rounded-xl border border-white/[0.08] bg-black/25 px-3 py-3">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/30 bg-black/40 text-amber-400 focus:ring-amber-400/40"
            />
            <span className="text-sm leading-snug text-white/85">{t.checkboxLabel}</span>
          </label>
        </div>
      </DarkModalFrame>
      <LegalDocModal
        open={!!viewDoc}
        docId={viewDoc}
        onClose={() => setViewDoc(null)}
        stackZClass="z-[100030]"
      />
    </>
  );
};
