"use client";

import { memo, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Mic, Music, Star, Sparkles } from "lucide-react";
import Link from "next/link";

const PARTICLES = [
  { icon: "🎵", delay: 0, duration: 4, x: 10, y: 20 },
  { icon: "🎤", delay: 0.5, duration: 5, x: 80, y: 15 },
  { icon: "⭐", delay: 1, duration: 3.5, x: 25, y: 70 },
  { icon: "🎶", delay: 1.5, duration: 4.5, x: 70, y: 65 },
  { icon: "✨", delay: 2, duration: 4, x: 15, y: 45 },
  { icon: "🎵", delay: 2.5, duration: 5, x: 85, y: 40 },
  { icon: "🌟", delay: 0.8, duration: 4.2, x: 50, y: 10 },
  { icon: "🎤", delay: 1.8, duration: 3.8, x: 35, y: 80 },
];

const GradientBackground = memo(function GradientBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <motion.div
        className="absolute w-[600px] h-[600px] rounded-full bg-linear-to-r from-green-600/30 to-emerald-600/30 blur-3xl"
        animate={{
          x: ["-20%", "10%", "-20%"],
          y: ["-20%", "20%", "-20%"],
          scale: [1, 1.2, 1],
        }}
        transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
        style={{ left: "10%", top: "20%" }}
      />
      <motion.div
        className="absolute w-[500px] h-[500px] rounded-full bg-linear-to-r from-amber-500/20 to-orange-400/20 blur-3xl"
        animate={{
          x: ["20%", "-10%", "20%"],
          y: ["20%", "-20%", "20%"],
          scale: [1.2, 1, 1.2],
        }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
        style={{ right: "10%", bottom: "20%" }}
      />
      <motion.div
        className="absolute w-[400px] h-[400px] rounded-full bg-linear-to-r from-primary-300/20 to-green-400/20 blur-3xl"
        animate={{
          x: ["-10%", "10%", "-10%"],
          y: ["10%", "-10%", "10%"],
        }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
        style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}
      />
    </div>
  );
});

const FloatingParticle = memo(function FloatingParticle({
  icon,
  delay,
  duration,
  x,
  y,
}: {
  icon: string;
  delay: number;
  duration: number;
  x: number;
  y: number;
}) {
  return (
    <motion.div
      className="absolute text-2xl md:text-3xl opacity-60 pointer-events-none select-none"
      style={{ left: `${x}%`, top: `${y}%` }}
      initial={{ opacity: 0, y: 20 }}
      animate={{
        opacity: [0.3, 0.7, 0.3],
        y: [0, -30, 0],
        x: [0, 10, 0],
        rotate: [0, 10, -10, 0],
      }}
      transition={{ duration, delay, repeat: Infinity, ease: "easeInOut" }}
    >
      {icon}
    </motion.div>
  );
});

const AnimatedTitle = memo(function AnimatedTitle() {
  const words = ["Le", "Jury", "IA", "Vocal"];

  return (
    <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl xl:text-8xl font-bold tracking-tight">
      {words.map((word, i) => (
        <motion.span
          key={word}
          className={`inline-block mr-3 ${
            word === "IA"
              ? "bg-linear-to-r from-green-400 via-green-500 to-emerald-500 bg-clip-text text-transparent"
              : word === "Vocal"
                ? "bg-linear-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent"
                : ""
          }`}
          initial={{ opacity: 0, y: 30, rotateX: -90 }}
          animate={{ opacity: 1, y: 0, rotateX: 0 }}
          transition={{
            duration: 0.6,
            delay: 0.2 + i * 0.15,
            ease: [0.25, 0.46, 0.45, 0.94],
          }}
        >
          {word}
        </motion.span>
      ))}
    </h1>
  );
});

const AnimatedMic = memo(function AnimatedMic() {
  return (
    <motion.div
      className="relative w-32 h-32 md:w-40 md:h-40 lg:w-48 lg:h-48 mx-auto mb-8"
      initial={{ scale: 0, rotate: -180 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.5 }}
    >
      <motion.div
        className="absolute inset-0 rounded-full bg-gradient-to-br from-green-400 to-green-600 blur-xl"
        animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="relative w-full h-full rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center shadow-2xl"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        <motion.div
          className="absolute inset-0 rounded-full border-4 border-green-300/50"
          animate={{ scale: [1, 1.5], opacity: [0.8, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
        />
        <motion.div
          className="absolute inset-0 rounded-full border-4 border-green-300/50"
          animate={{ scale: [1, 1.5], opacity: [0.8, 0] }}
          transition={{
            duration: 1.5,
            repeat: Infinity,
            ease: "easeOut",
            delay: 0.5,
          }}
        />
        <span className="text-5xl md:text-6xl">🎤</span>
      </motion.div>
    </motion.div>
  );
});

const StatCounter = memo(function StatCounter({
  value,
  label,
  suffix = "",
  delay = 0,
}: {
  value: number;
  label: string;
  suffix?: string;
  delay?: number;
}) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const timeout = setTimeout(() => {
      const duration = 2000;
      const steps = 60;
      const increment = value / steps;
      let current = 0;

      const interval = setInterval(() => {
        current += increment;
        if (current >= value) {
          setCount(value);
          clearInterval(interval);
        } else {
          setCount(Math.floor(current));
        }
      }, duration / steps);

      return () => clearInterval(interval);
    }, delay);

    return () => clearTimeout(timeout);
  }, [value, delay]);

  return (
    <motion.div
      className="text-center"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: delay / 1000 + 1 }}
    >
      <div className="text-2xl md:text-3xl font-bold text-primary">
        {count.toLocaleString()}
        {suffix}
      </div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </motion.div>
  );
});

export const HeroSection = memo(function HeroSection() {
  return (
    <section className="relative min-h-[90vh] flex flex-col items-center justify-center px-4 py-12 overflow-hidden">
      <GradientBackground />

      {PARTICLES.map((particle, i) => (
        <FloatingParticle key={i} {...particle} />
      ))}

      <div className="relative z-10 max-w-6xl mx-auto text-center">
        <AnimatedMic />
        <AnimatedTitle />

        <motion.p
          className="mt-6 text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8, duration: 0.6 }}
        >
          Chante ta chanson preferee et laisse notre{" "}
          <span className="text-primary font-semibold">jury IA</span>{" "}
          analyser ta performance en temps reel !
        </motion.p>

        <motion.div
          className="mt-6 flex flex-wrap items-center justify-center gap-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1, duration: 0.6 }}
        >
          {[
            { icon: <Mic className="w-4 h-4" />, text: "Analyse vocale" },
            { icon: <Music className="w-4 h-4" />, text: "Karaoke sync" },
            {
              icon: <Star className="w-4 h-4" />,
              text: "Jury personnalise",
            },
            {
              icon: <Sparkles className="w-4 h-4" />,
              text: "100% gratuit",
            },
          ].map((feature, i) => (
            <motion.span
              key={feature.text}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary/50 border border-border text-sm text-muted-foreground"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 1.1 + i * 0.1 }}
              whileHover={{
                scale: 1.05,
              }}
            >
              {feature.icon}
              {feature.text}
            </motion.span>
          ))}
        </motion.div>

        <motion.div
          className="mt-10"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.2, duration: 0.6 }}
        >
          <Link href="/app">
            <motion.span
              className="group relative inline-flex px-8 py-4 md:px-12 md:py-5 rounded-full text-lg md:text-xl font-bold text-white overflow-hidden cursor-pointer"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <motion.span
                className="absolute inset-0 bg-linear-to-r from-green-500 via-green-400 to-emerald-500"
                animate={{
                  backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
                }}
                transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                style={{ backgroundSize: "200% 200%" }}
              />
              <motion.span
                className="absolute inset-0 bg-linear-to-r from-transparent via-white/30 to-transparent"
                initial={{ x: "-100%" }}
                animate={{ x: "100%" }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  repeatDelay: 2,
                  ease: "easeInOut",
                }}
              />
              <span className="relative z-10 flex items-center gap-2">
                <span>Commencer maintenant</span>
                <motion.span
                  animate={{ x: [0, 5, 0] }}
                  transition={{ duration: 1, repeat: Infinity }}
                >
                  →
                </motion.span>
              </span>
            </motion.span>
          </Link>
        </motion.div>

        <motion.div
          className="mt-12 grid grid-cols-3 gap-8 max-w-md lg:max-w-2xl mx-auto"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5 }}
        >
          <StatCounter value={1247} label="Performances" delay={1500} />
          <StatCounter value={98} label="Precision" suffix="%" delay={1700} />
          <StatCounter
            value={4.8}
            label="Note moyenne"
            suffix="/5"
            delay={1900}
          />
        </motion.div>
      </div>

      <motion.div
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2 }}
      >
        <motion.div
          className="flex flex-col items-center gap-2 text-muted-foreground"
          animate={{ y: [0, 10, 0] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <span className="text-xs">Decouvrir</span>
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 14l-7 7m0 0l-7-7m7 7V3"
            />
          </svg>
        </motion.div>
      </motion.div>
    </section>
  );
});

export default HeroSection;
