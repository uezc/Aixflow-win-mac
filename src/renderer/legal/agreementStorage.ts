/** 协议确认 localStorage 键；后续可升级为服务端记录时保持同名语义。 */
export const AIXFLOW_AGREEMENT_CONFIRMED_KEY = 'aixflow_agreement_confirmed';

export function isAgreementConfirmed(): boolean {
  try {
    return localStorage.getItem(AIXFLOW_AGREEMENT_CONFIRMED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setAgreementConfirmed(value = true): void {
  try {
    localStorage.setItem(AIXFLOW_AGREEMENT_CONFIRMED_KEY, value ? 'true' : 'false');
  } catch {
    /* ignore quota / private mode */
  }
}
