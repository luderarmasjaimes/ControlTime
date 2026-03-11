import React from 'react'
import { motion } from 'framer-motion'

const AnimatedButton = ({ children, className = '', onClick, icon: Icon }) => {
  return (
    <motion.button
      whileHover={{ y: -3, scale: 1.03 }}
      whileTap={{ scale: 0.98 }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 20 }}
      onClick={onClick}
      className={`premium-button ${className}`}
    >
      {Icon && <Icon size={16} />}
      <span>{children}</span>
    </motion.button>
  )
}

export default AnimatedButton
