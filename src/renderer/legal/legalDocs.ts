import userAgreementMd from '../../../docs/legal/user-agreement.md?raw';
import privacyPolicyMd from '../../../docs/legal/privacy-policy.md?raw';
import aiDisclaimerMd from '../../../docs/legal/ai-disclaimer.md?raw';

export type LegalDocId = 'user-agreement' | 'privacy-policy' | 'ai-disclaimer';

export const LEGAL_DOC_IDS: readonly LegalDocId[] = [
  'user-agreement',
  'privacy-policy',
  'ai-disclaimer',
] as const;

const DOCS: Record<LegalDocId, string> = {
  'user-agreement': userAgreementMd,
  'privacy-policy': privacyPolicyMd,
  'ai-disclaimer': aiDisclaimerMd,
};

export function getLegalDocMarkdown(id: LegalDocId): string {
  return DOCS[id] ?? '';
}
