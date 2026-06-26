import { Button } from './Button';
import { LOGO_URL } from '../data/content';

export function BottomNav() {
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
      <div className="pointer-events-auto flex items-center gap-4 rounded-full bg-white px-6 py-2 shadow-vo-secondary md:px-8">
        <img src={LOGO_URL} alt="" className="h-7 w-auto" decoding="async" />
        <Button href="#contact" className="px-5 py-2 text-sm">
          联系我们
        </Button>
      </div>
    </div>
  );
}
