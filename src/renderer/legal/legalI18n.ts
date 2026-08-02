import type { AppLocale } from '../i18n/settingsI18n';
import type { LegalDocId } from './legalDocs';

export type LegalUiStrings = {
  welcomeTitle: string;
  welcomeIntro: string;
  checkboxLabel: string;
  agreeContinue: string;
  userAgreement: string;
  privacyPolicy: string;
  aiDisclaimer: string;
  legalSectionTitle: string;
  generateDisclaimer: string;
  generatedBadge: string;
  close: string;
  docTitle: (id: LegalDocId) => string;
};

const zh: LegalUiStrings = {
  welcomeTitle: '欢迎使用 AIXFLOW AI创作平台',
  welcomeIntro: '为了保障您的使用体验，请阅读并同意：',
  checkboxLabel: '我已阅读并同意以上协议',
  agreeContinue: '同意并继续',
  userAgreement: '用户服务协议',
  privacyPolicy: '隐私政策',
  aiDisclaimer: 'AI生成内容免责声明',
  legalSectionTitle: '协议与声明',
  generateDisclaimer:
    'AI生成内容由人工智能模型自动生成，仅作为创作辅助工具。用户应自行审核生成内容，并确保使用过程符合相关法律法规及第三方权益要求。',
  generatedBadge: '本内容由AI技术辅助生成',
  close: '关闭',
  docTitle: (id) => {
    switch (id) {
      case 'user-agreement':
        return '用户服务协议';
      case 'privacy-policy':
        return '隐私政策';
      case 'ai-disclaimer':
        return 'AI生成内容免责声明';
      default:
        return '协议';
    }
  },
};

const en: LegalUiStrings = {
  welcomeTitle: 'Welcome to AIXFLOW AI Creation Platform',
  welcomeIntro: 'To continue, please read and agree to:',
  checkboxLabel: 'I have read and agree to the above',
  agreeContinue: 'Agree and continue',
  userAgreement: 'Terms of Service',
  privacyPolicy: 'Privacy Policy',
  aiDisclaimer: 'AI Content Disclaimer',
  legalSectionTitle: 'Legal',
  generateDisclaimer:
    'AI-generated content is produced automatically by AI models and is for creative assistance only. Please review outputs and ensure your use complies with applicable laws and third-party rights.',
  generatedBadge: 'This content was assisted by AI',
  close: 'Close',
  docTitle: (id) => {
    switch (id) {
      case 'user-agreement':
        return 'Terms of Service';
      case 'privacy-policy':
        return 'Privacy Policy';
      case 'ai-disclaimer':
        return 'AI Content Disclaimer';
      default:
        return 'Legal';
    }
  },
};

export function legalUiT(locale: AppLocale): LegalUiStrings {
  return locale === 'en' ? en : zh;
}
