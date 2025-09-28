import React from 'react';
import SelfDrawingSVGLogo from '@/self-drawing-svg-logo';

const LogoOnlyPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <SelfDrawingSVGLogo />
    </div>
  );
};

export default LogoOnlyPage;