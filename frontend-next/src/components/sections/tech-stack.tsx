"use client";

import { memo } from "react";
import { motion } from "framer-motion";
import { ExternalLink, Cpu, Zap, Code2 } from "lucide-react";

const TECH_CATEGORIES = [
  {
    title: "Audio Intelligence",
    icon: Zap,
    color: "from-purple-500 to-violet-600",
    items: [
      {
        name: "Demucs",
        description: "Séparation de sources audio par Meta AI",
        url: "https://github.com/facebookresearch/demucs",
        logo: "🎛️",
      },
      {
        name: "CREPE",
        description: "Détection de pitch monophonique",
        url: "https://github.com/marl/crepe",
        logo: "🎵",
      },
      {
        name: "Whisper",
        description: "Speech-to-text par OpenAI",
        url: "https://github.com/openai/whisper",
        logo: "🎙️",
      },
      {
        name: "Librosa",
        description: "Analyse audio Python",
        url: "https://librosa.org/",
        logo: "📊",
      },
    ],
  },
  {
    title: "IA & LLM",
    icon: Cpu,
    color: "from-orange-500 to-amber-600",
    items: [
      {
        name: "Ollama",
        description: "LLM local et privé",
        url: "https://ollama.ai/",
        logo: "🦙",
      },
      {
        name: "Llama 3.2",
        description: "Modèle de langage par Meta",
        url: "https://llama.meta.com/",
        logo: "🧠",
      },
      {
        name: "PyTorch",
        description: "Framework deep learning",
        url: "https://pytorch.org/",
        logo: "🔥",
      },
      {
        name: "CUDA",
        description: "Accélération GPU NVIDIA",
        url: "https://developer.nvidia.com/cuda-toolkit",
        logo: "⚡",
      },
    ],
  },
  {
    title: "Stack Web",
    icon: Code2,
    color: "from-blue-500 to-cyan-600",
    items: [
      {
        name: "React",
        description: "UI library par Meta",
        url: "https://react.dev/",
        logo: "⚛️",
      },
      {
        name: "FastAPI",
        description: "Framework API Python moderne",
        url: "https://fastapi.tiangolo.com/",
        logo: "🚀",
      },
      {
        name: "Celery",
        description: "Task queue distribuée",
        url: "https://docs.celeryq.dev/",
        logo: "🥬",
      },
      {
        name: "Redis",
        description: "Cache et message broker",
        url: "https://redis.io/",
        logo: "🔴",
      },
    ],
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4 },
  },
};

const TechItem = memo(function TechItem({
  item,
}: {
  item: (typeof TECH_CATEGORIES)[0]["items"][0];
}) {
  return (
    <motion.a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all"
      variants={itemVariants}
      whileHover={{ scale: 1.02, x: 5 }}
      whileTap={{ scale: 0.98 }}
    >
      <span className="text-2xl">{item.logo}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-white font-medium text-sm">{item.name}</span>
          <ExternalLink className="w-3 h-3 text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        <p className="text-gray-500 text-xs truncate">{item.description}</p>
      </div>
    </motion.a>
  );
});

const CategoryCard = memo(function CategoryCard({
  category,
  index,
}: {
  category: (typeof TECH_CATEGORIES)[0];
  index: number;
}) {
  const Icon = category.icon;

  return (
    <motion.div
      className="relative"
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ delay: index * 0.15, duration: 0.5 }}
    >
      <div className="p-6 rounded-2xl bg-gradient-to-br from-white/5 to-transparent border border-white/10 backdrop-blur-sm h-full">
        <div className="flex items-center gap-3 mb-6">
          <div
            className={`w-10 h-10 rounded-lg bg-gradient-to-br ${category.color} flex items-center justify-center shadow-lg`}
          >
            <Icon className="w-5 h-5 text-white" />
          </div>
          <h3 className="text-lg font-semibold text-white">
            {category.title}
          </h3>
        </div>

        <motion.div
          className="space-y-2"
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
        >
          {category.items.map((item) => (
            <TechItem key={item.name} item={item} />
          ))}
        </motion.div>
      </div>
    </motion.div>
  );
});

const FloatingBubble = memo(function FloatingBubble({
  emoji,
  delay,
  x,
  y,
}: {
  emoji: string;
  delay: number;
  x: number;
  y: number;
}) {
  return (
    <motion.div
      className="absolute text-3xl opacity-20 pointer-events-none select-none"
      style={{ left: `${x}%`, top: `${y}%` }}
      animate={{
        y: [0, -20, 0],
        rotate: [0, 5, -5, 0],
        opacity: [0.15, 0.3, 0.15],
      }}
      transition={{
        duration: 4 + delay,
        delay,
        repeat: Infinity,
        ease: "easeInOut",
      }}
    >
      {emoji}
    </motion.div>
  );
});

export const TechStackSection = memo(function TechStackSection() {
  const bubbles = [
    { emoji: "🎵", delay: 0, x: 5, y: 20 },
    { emoji: "🧠", delay: 1, x: 90, y: 15 },
    { emoji: "⚡", delay: 0.5, x: 15, y: 70 },
    { emoji: "🔥", delay: 1.5, x: 85, y: 60 },
    { emoji: "⚛️", delay: 2, x: 50, y: 85 },
  ];

  return (
    <section className="relative py-20 px-4 overflow-hidden bg-gradient-to-b from-transparent via-purple-900/10 to-transparent">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-0 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/3 right-0 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl" />

        {bubbles.map((bubble, i) => (
          <FloatingBubble key={i} {...bubble} />
        ))}
      </div>

      <div className="relative z-10 max-w-6xl mx-auto">
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
        >
          <motion.span
            className="inline-block px-4 py-1.5 rounded-full bg-blue-500/20 border border-blue-500/30 text-blue-400 text-sm font-medium mb-4"
            initial={{ opacity: 0, scale: 0.8 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
          >
            Technologies
          </motion.span>

          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-4">
            Propulsé par{" "}
            <span className="bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
              l&apos;Open Source
            </span>
          </h2>

          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            Des technologies de pointe, libres et open source, pour une analyse
            vocale de qualité professionnelle.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {TECH_CATEGORIES.map((category, index) => (
            <CategoryCard
              key={category.title}
              category={category}
              index={index}
            />
          ))}
        </div>

        <motion.div
          className="mt-16 p-6 rounded-2xl bg-gradient-to-r from-purple-500/10 via-blue-500/10 to-cyan-500/10 border border-white/10"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 }}
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {[
              { value: "12+", label: "Projets Open Source" },
              { value: "100%", label: "Privé & Local" },
              { value: "<60s", label: "Temps d'analyse" },
              { value: "GPU", label: "Accélération CUDA" },
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.4 + i * 0.1 }}
              >
                <div className="text-2xl md:text-3xl font-bold text-white mb-1">
                  {stat.value}
                </div>
                <div className="text-sm text-gray-400">{stat.label}</div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
});

export default TechStackSection;
