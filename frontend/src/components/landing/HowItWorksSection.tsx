/**
 * @fileoverview How It Works section explaining the process flow.
 * Features animated steps with icons and links to open source projects.
 */

import { memo } from 'react'
import { motion } from 'framer-motion'
import {
  Search,
  Music2,
  Mic2,
  Brain,
  MessageSquare,
  Trophy,
  ExternalLink,
} from 'lucide-react'

// Process steps with technology links
const STEPS = [
  {
    icon: Search,
    title: 'Choisis ta chanson',
    description: 'Recherche parmi des millions de titres via Spotify et YouTube.',
    color: 'from-green-500 to-emerald-600',
    techs: [
      { name: 'Spotify API', url: 'https://developer.spotify.com/documentation/web-api' },
      { name: 'YouTube', url: 'https://developers.google.com/youtube/v3' },
    ],
  },
  {
    icon: Music2,
    title: 'Séparation audio',
    description: 'Notre IA isole les voix de la musique pour une analyse précise.',
    color: 'from-purple-500 to-violet-600',
    techs: [
      { name: 'Demucs', url: 'https://github.com/facebookresearch/demucs' },
      { name: 'Meta AI', url: 'https://ai.meta.com/' },
    ],
  },
  {
    icon: Mic2,
    title: 'Enregistre ta performance',
    description: 'Chante avec le karaoké synchronisé mot par mot.',
    color: 'from-pink-500 to-rose-600',
    techs: [
      { name: 'Web Audio API', url: 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API' },
      { name: 'Whisper', url: 'https://github.com/openai/whisper' },
    ],
  },
  {
    icon: Brain,
    title: 'Analyse IA',
    description: 'Détection de la justesse, du rythme et de la prononciation.',
    color: 'from-blue-500 to-cyan-600',
    techs: [
      { name: 'CREPE', url: 'https://github.com/marl/crepe' },
      { name: 'Librosa', url: 'https://librosa.org/' },
    ],
  },
  {
    icon: MessageSquare,
    title: 'Feedback du Jury IA',
    description: 'Des personnalités virtuelles commentent ta prestation.',
    color: 'from-orange-500 to-amber-600',
    techs: [
      { name: 'Ollama', url: 'https://ollama.ai/' },
      { name: 'Llama 3.2', url: 'https://llama.meta.com/' },
    ],
  },
  {
    icon: Trophy,
    title: 'Score & Partage',
    description: 'Obtiens ton score et partage avec tes amis !',
    color: 'from-gold-500 to-yellow-600',
    techs: [],
  },
]

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15,
    },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 40 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: [0.25, 0.46, 0.45, 0.94] as const,
    },
  },
}

// Step card component
const StepCard = memo(function StepCard({
  step,
  index,
}: {
  step: typeof STEPS[0]
  index: number
}) {
  const Icon = step.icon

  return (
    <motion.div
      variants={itemVariants}
      className="relative group"
    >
      {/* Connection line (except last item) */}
      {index < STEPS.length - 1 && (
        <div className="hidden lg:block absolute top-12 left-[calc(100%+1rem)] w-8 h-0.5 bg-gradient-to-r from-white/20 to-transparent" />
      )}

      {/* Card */}
      <motion.div
        className="relative p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm h-full"
        whileHover={{
          scale: 1.02,
          backgroundColor: 'rgba(255,255,255,0.08)',
        }}
        transition={{ duration: 0.2 }}
      >
        {/* Step number */}
        <div className="absolute -top-3 -left-3 w-8 h-8 rounded-full bg-gray-900 border-2 border-white/20 flex items-center justify-center text-sm font-bold text-white/60">
          {index + 1}
        </div>

        {/* Icon */}
        <motion.div
          className={`w-14 h-14 rounded-xl bg-gradient-to-br ${step.color} flex items-center justify-center mb-4 shadow-lg`}
          whileHover={{ rotate: [0, -10, 10, 0] }}
          transition={{ duration: 0.5 }}
        >
          <Icon className="w-7 h-7 text-white" />
        </motion.div>

        {/* Title */}
        <h3 className="text-lg font-semibold text-white mb-2">
          {step.title}
        </h3>

        {/* Description */}
        <p className="text-sm text-gray-400 mb-4">
          {step.description}
        </p>

        {/* Tech links */}
        {step.techs.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {step.techs.map((tech) => (
              <motion.a
                key={tech.name}
                href={tech.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/5 border border-white/10 text-xs text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                {tech.name}
                <ExternalLink className="w-3 h-3" />
              </motion.a>
            ))}
          </div>
        )}
      </motion.div>
    </motion.div>
  )
})

export const HowItWorksSection = memo(function HowItWorksSection() {
  return (
    <section className="relative py-20 px-4 overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-0 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-0 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto">
        {/* Section header */}
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6 }}
        >
          <motion.span
            className="inline-block px-4 py-1.5 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-400 text-sm font-medium mb-4"
            initial={{ opacity: 0, scale: 0.8 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
          >
            Comment ça marche ?
          </motion.span>

          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-4">
            De la chanson au{' '}
            <span className="bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent">
              verdict du jury
            </span>
          </h2>

          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            Notre pipeline IA analyse ta voix en utilisant les meilleures technologies open source.
          </p>
        </motion.div>

        {/* Steps grid */}
        <motion.div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-50px' }}
        >
          {STEPS.map((step, index) => (
            <StepCard key={step.title} step={step} index={index} />
          ))}
        </motion.div>

        {/* Open source badge */}
        <motion.div
          className="mt-16 text-center"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.5 }}
        >
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white/5 border border-white/10 text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
            </svg>
            <span>100% Open Source</span>
            <ExternalLink className="w-4 h-4" />
          </a>
        </motion.div>
      </div>
    </section>
  )
})

export default HowItWorksSection
