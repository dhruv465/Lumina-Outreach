import React from 'react';
import { motion } from 'framer-motion';
import { useTheme } from '@/contexts/ThemeContext';
import { Button } from '@/components/ui/button';
import { Moon, Sun, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import SelfDrawingSVGLogo from '@/self-drawing-svg-logo';

const AnimatedLogoPage: React.FC = () => {
  const { theme, setTheme } = useTheme();
  
  // Get the actual resolved theme (handle 'system')
  const resolvedTheme = theme === 'system' 
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  
  const toggleTheme = () => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  };

  return (
    <div className={`min-h-screen transition-all duration-500 ${
      resolvedTheme === 'dark' 
        ? 'bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900' 
        : 'bg-gradient-to-br from-slate-50 via-white to-slate-100'
    }`}>
      {/* Header */}
      <motion.header 
        className="p-6 flex justify-between items-center"
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6 }}
      >
        <Link to="/dashboard">
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Button>
        </Link>
        
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleTheme}
          className="gap-2"
        >
          {resolvedTheme === 'dark' ? (
            <>
              <Sun className="w-4 h-4" />
              Light Mode
            </>
          ) : (
            <>
              <Moon className="w-4 h-4" />
              Dark Mode
            </>
          )}
        </Button>
      </motion.header>

      {/* Main Content */}
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-120px)] px-6">
        <motion.div
          className="text-center mb-12"
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          <h1 className={`text-4xl md:text-5xl font-bold mb-4 ${
            resolvedTheme === 'dark' ? 'text-white' : 'text-slate-900'
          }`}>
            Animated Logo Showcase
          </h1>
          <p className={`text-lg md:text-xl ${
            resolvedTheme === 'dark' ? 'text-slate-300' : 'text-slate-600'
          }`}>
            Featuring our rotating circle logo with smooth animations
          </p>
        </motion.div>

        {/* Self-Drawing Logo Display */}
        <motion.div
          className="mb-12"
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 1, delay: 0.5 }}
        >
          <SelfDrawingSVGLogo />
        </motion.div>

        {/* Feature Description */}
        <motion.div
          className="max-w-2xl text-center"
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.8, delay: 1.5 }}
        >
          <div className="grid md:grid-cols-3 gap-6">
            <div className={`p-4 rounded-lg ${
              resolvedTheme === 'dark' ? 'bg-slate-800/50' : 'bg-white/50'
            } backdrop-blur-sm`}>
              <h3 className={`font-semibold mb-2 ${
                resolvedTheme === 'dark' ? 'text-blue-400' : 'text-blue-600'
              }`}>
                Smooth Rotation
              </h3>
              <p className={`text-sm ${
                resolvedTheme === 'dark' ? 'text-slate-300' : 'text-slate-600'
              }`}>
                Continuous 360° rotation with linear easing for perfect smoothness
              </p>
            </div>
            
            <div className={`p-4 rounded-lg ${
              resolvedTheme === 'dark' ? 'bg-slate-800/50' : 'bg-white/50'
            } backdrop-blur-sm`}>
              <h3 className={`font-semibold mb-2 ${
                resolvedTheme === 'dark' ? 'text-purple-400' : 'text-purple-600'
              }`}>
                Dynamic Gradient
              </h3>
              <p className={`text-sm ${
                resolvedTheme === 'dark' ? 'text-slate-300' : 'text-slate-600'
              }`}>
                Animated gradient background that flows with the rotation
              </p>
            </div>
            
            <div className={`p-4 rounded-lg ${
              resolvedTheme === 'dark' ? 'bg-slate-800/50' : 'bg-white/50'
            } backdrop-blur-sm`}>
              <h3 className={`font-semibold mb-2 ${
                resolvedTheme === 'dark' ? 'text-cyan-400' : 'text-cyan-600'
              }`}>
                Pulsing Effect
              </h3>
              <p className={`text-sm ${
                resolvedTheme === 'dark' ? 'text-slate-300' : 'text-slate-600'
              }`}>
                Subtle breathing animation with scale and opacity transitions
              </p>
            </div>
          </div>
        </motion.div>

        {/* Call to Action */}
        <motion.div
          className="mt-12"
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.8, delay: 2 }}
        >
          <Link to="/dashboard">
            <Button size="lg" className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back to Dashboard
            </Button>
          </Link>
        </motion.div>
      </div>
    </div>
  );
};

export default AnimatedLogoPage;