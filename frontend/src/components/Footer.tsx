import { Link } from 'react-router-dom';
import { Logo } from './Logo';

export function Footer() {
  return (
    <footer className="mt-24 border-t border-outline-variant/40">
      <div className="max-w-page mx-auto px-4 md:px-10 py-10 flex flex-col md:flex-row gap-6 justify-between items-start md:items-center">
        <div className="flex items-center gap-3">
          <Logo size={28} />
          <div>
            <div className="font-display font-bold">DuskPad</div>
            <div className="text-[13px] text-on-surface-variant">Prove you qualify, buy unseen, claim unlinked. Built on Midnight.</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-5 text-[14px] text-on-surface-variant">
          <Link to="/how-it-works" className="hover:text-ink">Privacy model</Link>
          <Link to="/platform" className="hover:text-ink">Platform console</Link>
          <a href="https://github.com/AshThunder/duskpad" className="hover:text-ink" target="_blank" rel="noreferrer">GitHub</a>
          <span>Apache-2.0 · testnet software, unaudited</span>
        </div>
      </div>
    </footer>
  );
}
