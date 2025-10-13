import React from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import ProjectCallLogoSvg from '@/icons/ProjectCallLogo.svg?react';

interface LogoProps {
  width?: number;
  height?: number;
  className?: string;
}

const Logo: React.FC<LogoProps> = ({ width = 50, height = 50, className = '' }) => {
  const { theme } = useTheme();
  
  // Resolve the actual theme when 'system' is selected
  const resolvedTheme = theme === 'system' 
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  
  return (
    <div className={`logo-container ${className}`}>
      <ProjectCallLogoSvg 
        width={width} 
        height={height} 
        className={`text-foreground transition-all duration-300 hover:scale-105 ${resolvedTheme === 'dark' ? 'text-white' : 'text-slate-900'}`}
        style={{
          filter: resolvedTheme === 'dark' 
            ? 'drop-shadow(0 4px 12px rgba(255, 255, 255, 0.15)) brightness(1.1)' 
            : 'drop-shadow(0 4px 12px rgba(0, 0, 0, 0.2)) contrast(1.1)',
          fontWeight: 'bold'
        }}
      />
    </div>
  );
};

export default Logo;
