import React from 'react';
import { motion } from 'framer-motion';
import { useTheme } from '@/contexts/ThemeContext';

interface AnimatedLogoProps {
  size?: number;
  className?: string;
}

const AnimatedLogo: React.FC<AnimatedLogoProps> = ({ 
  size = 200,
  className = '' 
}) => {
  const { theme } = useTheme();
  
  // Get the actual resolved theme (handle 'system')
  const resolvedTheme = theme === 'system' 
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <div className="relative" style={{ width: size, height: size }}>
        {/* Rotating Circle */}
        <motion.div
          className="absolute inset-0 rounded-full border-4 border-transparent"
          style={{
            background: resolvedTheme === 'dark' 
              ? 'linear-gradient(45deg, #3b82f6, #8b5cf6, #06b6d4, #3b82f6)'
              : 'linear-gradient(45deg, #2563eb, #7c3aed, #0891b2, #2563eb)',
            backgroundSize: '300% 300%',
          }}
          animate={{
            rotate: 360,
            backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'],
          }}
          transition={{
            rotate: {
              duration: 3,
              repeat: Infinity,
              ease: "linear"
            },
            backgroundPosition: {
              duration: 4,
              repeat: Infinity,
              ease: "easeInOut"
            }
          }}
        />
        
        {/* Inner Circle with Text */}
        <motion.div
          className={`absolute inset-2 rounded-full flex items-center justify-center ${
            resolvedTheme === 'dark' ? 'bg-slate-900' : 'bg-white'
          }`}
          style={{
            boxShadow: resolvedTheme === 'dark' 
              ? '0 0 30px rgba(59, 130, 246, 0.3)'
              : '0 0 30px rgba(0, 0, 0, 0.1)'
          }}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ 
            duration: 1,
            delay: 0.5,
            ease: "easeOut"
          }}
        >
          <div className="text-center">
            <motion.h2
              className={`font-bold ${
                resolvedTheme === 'dark' ? 'text-white' : 'text-slate-900'
              }`}
              style={{ fontSize: size * 0.12 }}
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ 
                duration: 0.8,
                delay: 1,
                ease: "easeOut"
              }}
            >
              PROJECT
            </motion.h2>
            <motion.h3
              className={`font-semibold ${
                resolvedTheme === 'dark' ? 'text-blue-400' : 'text-blue-600'
              }`}
              style={{ fontSize: size * 0.08 }}
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ 
                duration: 0.8,
                delay: 1.2,
                ease: "easeOut"
              }}
            >
              CALL
            </motion.h3>
          </div>
        </motion.div>

        {/* Pulsing Effect */}
        <motion.div
          className="absolute inset-0 rounded-full border-2"
          style={{
            borderColor: resolvedTheme === 'dark' ? 'rgba(59, 130, 246, 0.3)' : 'rgba(37, 99, 235, 0.3)'
          }}
          animate={{
            scale: [1, 1.1, 1],
            opacity: [0.5, 0.8, 0.5],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />
      </div>
    </div>
  );
};

export default AnimatedLogo;