"use client";

import { motion } from "motion/react";

export function PeakHero() {
  return (
    <div className="relative h-screen w-full overflow-hidden bg-bg">
      {/* Mountain background with overlay */}
      <div className="absolute inset-0">
        <img
          src="/images/hero-mountain.jpg"
          alt="Mountain dawn"
          className="w-full h-full object-cover opacity-40"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/70 to-transparent" />
      </div>

      {/* Content */}
      <div className="relative z-10 h-full flex flex-col items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: "easeOut" }}
          className="text-center"
        >
          <h1 className="font-display text-[12rem] md:text-[16rem] lg:text-[20rem] leading-none tracking-tight mb-6">
            <span className="text-text-base">PEAKCAM</span>
          </h1>

          <motion.p
            className="text-xl md:text-2xl text-text-subtle mb-16 max-w-2xl mx-auto"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.8 }}
          >
            Real conditions. No marketing noise.
          </motion.p>

          <motion.a
            href="#conditions"
            className="inline-block px-8 py-4 text-lg bg-text-base/10 hover:bg-text-base/20 backdrop-blur-md border border-text-base/30 rounded-full text-text-base transition-all duration-slow"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.6 }}
            whileHover={{ scale: 1.05, boxShadow: "0 0 30px rgba(96, 200, 255, 0.3)" }}
            whileTap={{ scale: 0.98 }}
          >
            Check Conditions &rarr;
          </motion.a>
        </motion.div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        className="absolute bottom-8 left-1/2 -translate-x-1/2 text-text-subtle"
        animate={{ y: [0, 10, 0] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 5v14M19 12l-7 7-7-7" />
        </svg>
      </motion.div>
    </div>
  );
}
