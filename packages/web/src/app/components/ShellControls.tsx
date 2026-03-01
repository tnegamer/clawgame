import { Globe, Moon, Sun } from 'lucide-react';

type ShellControlsProps = {
  darkMode: boolean;
  isZh: boolean;
  toggleTheme: () => void;
  toggleLanguage: () => void;
};

export function ShellControls({ darkMode, isZh, toggleTheme, toggleLanguage }: ShellControlsProps) {
  return (
    <div className="top-actions">
      <button className="icon-btn" onClick={toggleTheme} title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}>
        {darkMode ? <Sun size={20} /> : <Moon size={20} />}
      </button>
      <button className="icon-btn" onClick={toggleLanguage} title={isZh ? 'Switch to English' : '切换到中文'}>
        <Globe size={20} />
        <span style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>{isZh ? 'EN' : '中'}</span>
      </button>
    </div>
  );
}
