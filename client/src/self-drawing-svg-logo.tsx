import React from 'react';
import { motion } from 'framer-motion';

const SelfDrawingSVGLogo = () => {
  // Animation variants for different element types
  const drawPath = {
    hidden: { pathLength: 0, opacity: 0 },
    visible: (i = 0) => ({
      pathLength: 1,
      opacity: 1,
      transition: {
        pathLength: { delay: i * 0.1, type: "spring", duration: 1.5, bounce: 0 },
        opacity: { delay: i * 0.1, duration: 0.01 }
      }
    })
  };

  const fadeIn = {
    hidden: { opacity: 0, scale: 0.8 },
    visible: (i = 0) => ({
      opacity: 1,
      scale: 1,
      transition: {
        delay: i * 0.05,
        duration: 0.4,
        ease: "easeOut"
      }
    })
  };

  const pulseIn = {
    hidden: { opacity: 0, scale: 0 },
    visible: (i = 0) => ({
      opacity: 1,
      scale: 1,
      transition: {
        delay: i * 0.1,
        type: "spring",
        stiffness: 200,
        damping: 10
      }
    })
  };

  const waveAnimation = {
    hidden: { pathLength: 0, opacity: 0 },
    visible: (i = 0) => ({
      pathLength: 1,
      opacity: 1,
      transition: {
        pathLength: { 
          delay: i * 0.2, 
          duration: 1.2,
          ease: "easeInOut"
        },
        opacity: { delay: i * 0.2, duration: 0.01 }
      }
    })
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-white dark:bg-gray-900">
      <motion.svg 
        xmlns="http://www.w3.org/2000/svg" 
        viewBox="0 0 200 200" 
        className="w-96 h-96 text-black dark:text-white"
        style={{ '--background': 'rgb(255, 255, 255)' }}
        initial="hidden"
        animate="visible"
      >
        {/* Background Circles - Ripple Effect */}
        <motion.circle 
          cx="100" cy="100" r="90" 
          fill="currentColor" 
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 0.15 }}
          transition={{ delay: 0, duration: 1, ease: "easeOut" }}
        />
        <motion.circle 
          cx="100" cy="100" r="75" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="6" 
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.4 }}
          transition={{
            pathLength: { delay: 0.1, type: "spring", duration: 1.5, bounce: 0 },
            opacity: { delay: 0.1, duration: 0.01 }
          }}
        />
        <motion.circle 
          cx="100" cy="100" r="60" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="3" 
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.2 }}
          transition={{
            pathLength: { delay: 0.2, type: "spring", duration: 1.5, bounce: 0 },
            opacity: { delay: 0.2, duration: 0.01 }
          }}
        />
        
        {/* Central Microphone - Layer by Layer */}
        <motion.rect 
          x="75" y="40" width="50" height="70" rx="25" 
          fill="currentColor" 
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 0.95, scale: 1 }}
          transition={{ delay: 0.3, duration: 0.4, ease: "easeOut" }}
        />
        <motion.rect 
          x="80" y="45" width="40" height="60" rx="20" 
          fill="var(--background)" 
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 0.9, scale: 1 }}
          transition={{ delay: 0.35, duration: 0.4, ease: "easeOut" }}
        />
        <motion.rect 
          x="85" y="50" width="30" height="50" rx="15" 
          fill="currentColor" 
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 0.8, scale: 1 }}
          transition={{ delay: 0.4, duration: 0.4, ease: "easeOut" }}
        />
        <motion.rect 
          x="90" y="55" width="20" height="40" rx="10" 
          fill="var(--background)" 
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 0.6, scale: 1 }}
          transition={{ delay: 0.45, duration: 0.4, ease: "easeOut" }}
        />
        
        {/* Microphone Stand - Drawing Effect */}
        <motion.path 
          d="M60,75 L60,115 C60,150 140,150 140,115 L140,75" 
          stroke="currentColor" 
          strokeWidth="12" 
          fill="none" 
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.9 }}
          transition={{
            pathLength: { delay: 0.5, type: "spring", duration: 1.5, bounce: 0 },
            opacity: { delay: 0.5, duration: 0.01 }
          }}
        />
        <motion.rect 
          x="90" y="115" width="20" height="40" rx="10" 
          fill="currentColor" 
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 0.9, scale: 1 }}
          transition={{ delay: 0.6, duration: 0.4, ease: "easeOut" }}
        />
        <motion.rect 
          x="70" y="150" width="60" height="15" rx="8" 
          fill="currentColor" 
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 0.9, scale: 1 }}
          transition={{ delay: 0.65, duration: 0.4, ease: "easeOut" }}
        />
        
        {/* Primary Waveforms - Animated Drawing */}
        <motion.path 
          d="M10,100 Q20,50 30,100 Q40,150 50,100 Q60,50 70,100" 
          stroke="currentColor" 
          strokeWidth="12" 
          fill="none" 
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.9 }}
          transition={{
            pathLength: { delay: 0.7, duration: 1.2, ease: "easeInOut" },
            opacity: { delay: 0.7, duration: 0.01 }
          }}
        />
        <motion.path 
          d="M130,100 Q140,50 150,100 Q160,150 170,100 Q180,50 190,100" 
          stroke="currentColor" 
          strokeWidth="12" 
          fill="none" 
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.9 }}
          transition={{
            pathLength: { delay: 0.7, duration: 1.2, ease: "easeInOut" },
            opacity: { delay: 0.7, duration: 0.01 }
          }}
        />
        
        {/* Secondary Waveforms */}
        <motion.path 
          d="M15,100 Q25,70 35,100 Q45,130 55,100 Q65,70 75,100" 
          stroke="currentColor" 
          strokeWidth="8" 
          fill="none" 
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.6 }}
          transition={{
            pathLength: { delay: 0.8, duration: 1.2, ease: "easeInOut" },
            opacity: { delay: 0.8, duration: 0.01 }
          }}
        />
        <motion.path 
          d="M125,100 Q135,70 145,100 Q155,130 165,100 Q175,70 185,100" 
          stroke="currentColor" 
          strokeWidth="8" 
          fill="none" 
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.6 }}
          transition={{
            pathLength: { delay: 0.8, duration: 1.2, ease: "easeInOut" },
            opacity: { delay: 0.8, duration: 0.01 }
          }}
        />
        
        {/* AI/Brain Elements - Pulsing In */}
        <motion.g>
          <motion.circle 
            cx="40" cy="25" r="22" 
            fill="currentColor" 
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.8, scale: 1 }}
            transition={{ delay: 0.9, type: "spring", stiffness: 200, damping: 10 }}
          />
          <motion.circle 
            cx="40" cy="25" r="15" 
            fill="var(--background)" 
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.9, scale: 1 }}
            transition={{ delay: 0.95, type: "spring", stiffness: 200, damping: 10 }}
          />
          <motion.circle 
            cx="40" cy="25" r="8" 
            fill="currentColor" 
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.9, scale: 1 }}
            transition={{ delay: 1, type: "spring", stiffness: 200, damping: 10 }}
          />
        </motion.g>
        
        <motion.g>
          <motion.circle 
            cx="160" cy="25" r="22" 
            fill="currentColor" 
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.8, scale: 1 }}
            transition={{ delay: 0.9, type: "spring", stiffness: 200, damping: 10 }}
          />
          <motion.circle 
            cx="160" cy="25" r="15" 
            fill="var(--background)" 
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.9, scale: 1 }}
            transition={{ delay: 0.95, type: "spring", stiffness: 200, damping: 10 }}
          />
          <motion.circle 
            cx="160" cy="25" r="8" 
            fill="currentColor" 
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.9, scale: 1 }}
            transition={{ delay: 1, type: "spring", stiffness: 200, damping: 10 }}
          />
        </motion.g>
        
        {/* Emotion Indicator - Drawing */}
        <motion.path 
          d="M40,175 Q100,205 160,175" 
          stroke="currentColor" 
          strokeWidth="12" 
          strokeLinecap="round" 
          fill="none" 
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.8 }}
          transition={{
            pathLength: { delay: 1.1, type: "spring", duration: 1.5, bounce: 0 },
            opacity: { delay: 1.1, duration: 0.01 }
          }}
        />
        
        {/* Neural Network Connections */}
        <motion.path 
          d="M15,15 C30,25 40,35 55,30 C70,25 80,15 95,20" 
          stroke="currentColor" 
          strokeWidth="6" 
          fill="none" 
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.7 }}
          transition={{
            pathLength: { delay: 1.2, type: "spring", duration: 1.5, bounce: 0 },
            opacity: { delay: 1.2, duration: 0.01 }
          }}
        />
        <motion.path 
          d="M105,20 C120,15 130,25 145,30 C160,35 170,25 185,15" 
          stroke="currentColor" 
          strokeWidth="6" 
          fill="none" 
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.7 }}
          transition={{
            pathLength: { delay: 1.2, type: "spring", duration: 1.5, bounce: 0 },
            opacity: { delay: 1.2, duration: 0.01 }
          }}
        />
        
        {/* Data Points - Popping In */}
        <motion.circle 
          cx="20" cy="60" r="8" 
          fill="currentColor" 
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 0.8, scale: 1 }}
          transition={{ delay: 1.3, type: "spring", stiffness: 200, damping: 10 }}
        />
        <motion.circle 
          cx="180" cy="60" r="8" 
          fill="currentColor" 
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 0.8, scale: 1 }}
          transition={{ delay: 1.32, type: "spring", stiffness: 200, damping: 10 }}
        />
        <motion.circle 
          cx="20" cy="140" r="8" 
          fill="currentColor" 
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 0.8, scale: 1 }}
          transition={{ delay: 1.34, type: "spring", stiffness: 200, damping: 10 }}
        />
        <motion.circle 
          cx="180" cy="140" r="8" 
          fill="currentColor" 
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 0.8, scale: 1 }}
          transition={{ delay: 1.36, type: "spring", stiffness: 200, damping: 10 }}
        />
        
        {/* Corner Elements */}
        <motion.rect 
          x="10" y="90" width="20" height="20" rx="10" 
          fill="currentColor" 
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 0.6, scale: 1 }}
          transition={{ delay: 1.4, duration: 0.4, ease: "easeOut" }}
        />
        <motion.rect 
          x="170" y="90" width="20" height="20" rx="10" 
          fill="currentColor" 
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 0.6, scale: 1 }}
          transition={{ delay: 1.4, duration: 0.4, ease: "easeOut" }}
        />
        
        {/* Bottom Elements */}
        <motion.path 
          d="M50,180 Q70,185 90,180" 
          stroke="currentColor" 
          strokeWidth="6" 
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.5 }}
          transition={{
            pathLength: { delay: 1.5, type: "spring", duration: 1.5, bounce: 0 },
            opacity: { delay: 1.5, duration: 0.01 }
          }}
        />
        <motion.path 
          d="M110,180 Q130,185 150,180" 
          stroke="currentColor" 
          strokeWidth="6" 
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.5 }}
          transition={{
            pathLength: { delay: 1.5, type: "spring", duration: 1.5, bounce: 0 },
            opacity: { delay: 1.5, duration: 0.01 }
          }}
        />
      </motion.svg>

     
    </div>
  );
};

export default SelfDrawingSVGLogo;