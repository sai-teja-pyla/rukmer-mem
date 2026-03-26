import React from 'react';
import { motion, type Variants } from 'framer-motion';

export type AIState = 'idle' | 'thinking' | 'typing';

interface AnimatedLogoProps {
  state?: AIState;
  className?: string;
}

// 'idle' has NO animation — it's a static image with a soft shadow.
// Only 'thinking' and 'typing' animate, and only one element ever has those states.
const imageVariants: Variants = {
  idle: {
    scale: 1,
    rotate: 0,
    filter: "drop-shadow(0px 0px 4px rgba(85, 247, 220, 0.4))",
    transition: { duration: 0 }
  },
  thinking: {
    scale: [0.9, 1.1, 0.9],
    rotate: [0, 180, 360],
    filter: "drop-shadow(0px 0px 12px rgba(85, 161, 247, 0.9))",
    transition: { duration: 2, repeat: Infinity, ease: "linear" as const }
  },
  typing: {
    scale: [1, 1.15, 0.95, 1.1, 1],
    rotate: [0, -5, 5, 0],
    filter: "drop-shadow(0px 0px 8px rgba(6, 182, 212, 0.7))",
    transition: { duration: 0.8, repeat: Infinity, ease: "easeInOut" as const }
  }
};

export const AnimatedLogo: React.FC<AnimatedLogoProps> = ({ state = 'idle', className = "w-8 h-8" }) => {
  return (
    <div className={`relative flex items-center justify-center shrink-0 ${className}`}>
      <motion.img
        src="/hexagon.png"
        alt="Rukmer AI"
        className="w-full h-full object-contain"
        variants={imageVariants}
        animate={state}
      />
    </div>
  );
};
