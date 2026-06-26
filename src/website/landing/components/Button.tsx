import type { AnchorHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'tertiary';

type Props = AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: Variant;
  children: ReactNode;
};

const styles: Record<Variant, string> = {
  primary:
    'inline-flex items-center justify-center rounded-full bg-[#051A24] px-7 py-3 text-sm font-medium text-white shadow-vo-primary transition hover:opacity-90',
  secondary:
    'inline-flex items-center justify-center rounded-full bg-white px-7 py-3 text-sm font-medium text-[#051A24] shadow-vo-secondary transition hover:opacity-90',
  tertiary:
    'inline-flex items-center justify-center rounded-full bg-white px-7 py-3 text-sm font-medium text-[#051A24] shadow-vo-secondary transition hover:opacity-90',
};

export function Button({ variant = 'primary', className = '', children, ...rest }: Props) {
  return (
    <a className={`${styles[variant]} ${className}`.trim()} {...rest}>
      {children}
    </a>
  );
}
