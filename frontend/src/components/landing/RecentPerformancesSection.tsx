/**
 * @fileoverview Recent performances section showing other users' songs.
 * Features animated cards with mock data (to be replaced with real API data).
 */

import { memo, useState } from 'react'
import { motion } from 'framer-motion'
import { Play, Star, Clock, TrendingUp, ChevronLeft, ChevronRight } from 'lucide-react'

// Mock data for recent performances (to be replaced with API call)
const MOCK_PERFORMANCES = [
  {
    id: '1',
    username: 'Marie_Chanteuse',
    avatar: null,
    songTitle: 'Je veux',
    artist: 'Zaz',
    score: 87,
    duration: '3:24',
    timestamp: new Date(Date.now() - 1000 * 60 * 15), // 15 min ago
    juryComment: 'Belle interprétation avec beaucoup d\'émotion !',
  },
  {
    id: '2',
    username: 'Lucas_Music',
    avatar: null,
    songTitle: 'Dernière danse',
    artist: 'Indila',
    score: 92,
    duration: '3:32',
    timestamp: new Date(Date.now() - 1000 * 60 * 45), // 45 min ago
    juryComment: 'Technique vocale impressionnante, bravo !',
  },
  {
    id: '3',
    username: 'SophieMusic',
    avatar: null,
    songTitle: 'Formidable',
    artist: 'Stromae',
    score: 78,
    duration: '4:08',
    timestamp: new Date(Date.now() - 1000 * 60 * 120), // 2h ago
    juryComment: 'Du potentiel, continue à travailler !',
  },
  {
    id: '4',
    username: 'Antoine_Voice',
    avatar: null,
    songTitle: 'La Bohème',
    artist: 'Charles Aznavour',
    score: 95,
    duration: '4:15',
    timestamp: new Date(Date.now() - 1000 * 60 * 180), // 3h ago
    juryComment: 'Performance exceptionnelle, un vrai talent !',
  },
  {
    id: '5',
    username: 'Emma_Sing',
    avatar: null,
    songTitle: 'Papaoutai',
    artist: 'Stromae',
    score: 84,
    duration: '3:52',
    timestamp: new Date(Date.now() - 1000 * 60 * 240), // 4h ago
    juryComment: 'Très bon rythme et bonne énergie !',
  },
  {
    id: '6',
    username: 'Thomas_K',
    avatar: null,
    songTitle: 'Tous les mêmes',
    artist: 'Stromae',
    score: 81,
    duration: '3:26',
    timestamp: new Date(Date.now() - 1000 * 60 * 300), // 5h ago
    juryComment: 'Bonne maîtrise, quelques petites imprécisions.',
  },
]

// Format relative time
function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMins < 60) return `il y a ${diffMins} min`
  if (diffHours < 24) return `il y a ${diffHours}h`
  return `il y a ${diffDays}j`
}

// Get score color
function getScoreColor(score: number): string {
  if (score >= 90) return 'text-green-400'
  if (score >= 80) return 'text-yellow-400'
  if (score >= 70) return 'text-orange-400'
  return 'text-red-400'
}

// Get score gradient
function getScoreGradient(score: number): string {
  if (score >= 90) return 'from-green-500 to-emerald-600'
  if (score >= 80) return 'from-yellow-500 to-amber-600'
  if (score >= 70) return 'from-orange-500 to-red-500'
  return 'from-red-500 to-rose-600'
}

// Generate avatar initials
function getInitials(username: string): string {
  return username.split('_')[0].substring(0, 2).toUpperCase()
}

// Performance card component
const PerformanceCard = memo(function PerformanceCard({
  performance,
  index,
}: {
  performance: typeof MOCK_PERFORMANCES[0]
  index: number
}) {
  return (
    <motion.div
      className="relative min-w-[280px] md:min-w-[320px] snap-center"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.1, duration: 0.4 }}
    >
      <motion.div
        className="relative p-5 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm overflow-hidden"
        whileHover={{ scale: 1.02, backgroundColor: 'rgba(255,255,255,0.08)' }}
        transition={{ duration: 0.2 }}
      >
        {/* Score badge */}
        <div className={`absolute top-4 right-4 px-3 py-1 rounded-full bg-gradient-to-r ${getScoreGradient(performance.score)} text-white text-sm font-bold shadow-lg`}>
          {performance.score}%
        </div>

        {/* User info */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-sm">
            {getInitials(performance.username)}
          </div>
          <div>
            <div className="text-white font-medium text-sm">
              {performance.username.replace('_', ' ')}
            </div>
            <div className="text-gray-500 text-xs flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatRelativeTime(performance.timestamp)}
            </div>
          </div>
        </div>

        {/* Song info */}
        <div className="mb-4">
          <h4 className="text-white font-semibold text-lg truncate">
            {performance.songTitle}
          </h4>
          <p className="text-gray-400 text-sm truncate">
            {performance.artist}
          </p>
        </div>

        {/* Jury comment */}
        <div className="p-3 rounded-lg bg-white/5 border border-white/5 mb-4">
          <p className="text-gray-300 text-sm italic">
            "{performance.juryComment}"
          </p>
        </div>

        {/* Stats */}
        <div className="flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center gap-1">
            <Play className="w-3 h-3" />
            <span>{performance.duration}</span>
          </div>
          <div className="flex items-center gap-1">
            <Star className={`w-3 h-3 ${getScoreColor(performance.score)}`} />
            <span className={getScoreColor(performance.score)}>
              {performance.score >= 90 ? 'Excellent' : performance.score >= 80 ? 'Très bien' : performance.score >= 70 ? 'Bien' : 'À améliorer'}
            </span>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
})

// Live indicator
const LiveIndicator = memo(function LiveIndicator() {
  return (
    <motion.div
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/20 border border-red-500/30"
      animate={{ opacity: [1, 0.5, 1] }}
      transition={{ duration: 2, repeat: Infinity }}
    >
      <motion.div
        className="w-2 h-2 rounded-full bg-red-500"
        animate={{ scale: [1, 1.2, 1] }}
        transition={{ duration: 1, repeat: Infinity }}
      />
      <span className="text-red-400 text-sm font-medium">En direct</span>
    </motion.div>
  )
})

export const RecentPerformancesSection = memo(function RecentPerformancesSection() {
  const [currentIndex, setCurrentIndex] = useState(0)
  const visibleCount = 3 // Number of cards visible at once on desktop

  const canScrollLeft = currentIndex > 0
  const canScrollRight = currentIndex < MOCK_PERFORMANCES.length - visibleCount

  const scrollLeft = () => {
    if (canScrollLeft) setCurrentIndex(currentIndex - 1)
  }

  const scrollRight = () => {
    if (canScrollRight) setCurrentIndex(currentIndex + 1)
  }

  return (
    <section className="relative py-20 px-4 overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-72 h-72 bg-pink-600/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-72 h-72 bg-gold-600/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto">
        {/* Section header */}
        <motion.div
          className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-12"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6 }}
        >
          <div>
            <div className="flex items-center gap-3 mb-3">
              <LiveIndicator />
              <motion.span
                className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-green-500/20 border border-green-500/30 text-green-400 text-sm"
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.3 }}
              >
                <TrendingUp className="w-3 h-3" />
                {MOCK_PERFORMANCES.length} aujourd'hui
              </motion.span>
            </div>

            <h2 className="text-3xl md:text-4xl font-bold text-white">
              Performances{' '}
              <span className="bg-gradient-to-r from-pink-400 to-gold-500 bg-clip-text text-transparent">
                récentes
              </span>
            </h2>
          </div>

          {/* Navigation arrows (desktop) */}
          <div className="hidden md:flex items-center gap-2">
            <motion.button
              className={`p-2 rounded-full border ${
                canScrollLeft
                  ? 'border-white/20 text-white hover:bg-white/10'
                  : 'border-white/10 text-white/30 cursor-not-allowed'
              }`}
              onClick={scrollLeft}
              disabled={!canScrollLeft}
              whileHover={canScrollLeft ? { scale: 1.1 } : {}}
              whileTap={canScrollLeft ? { scale: 0.9 } : {}}
            >
              <ChevronLeft className="w-5 h-5" />
            </motion.button>
            <motion.button
              className={`p-2 rounded-full border ${
                canScrollRight
                  ? 'border-white/20 text-white hover:bg-white/10'
                  : 'border-white/10 text-white/30 cursor-not-allowed'
              }`}
              onClick={scrollRight}
              disabled={!canScrollRight}
              whileHover={canScrollRight ? { scale: 1.1 } : {}}
              whileTap={canScrollRight ? { scale: 0.9 } : {}}
            >
              <ChevronRight className="w-5 h-5" />
            </motion.button>
          </div>
        </motion.div>

        {/* Performances carousel - Mobile (horizontal scroll) */}
        <div className="md:hidden overflow-x-auto pb-4 -mx-4 px-4 snap-x snap-mandatory scrollbar-hide">
          <div className="flex gap-4">
            {MOCK_PERFORMANCES.map((performance, index) => (
              <PerformanceCard
                key={performance.id}
                performance={performance}
                index={index}
              />
            ))}
          </div>
        </div>

        {/* Performances carousel - Desktop (animated) */}
        <div className="hidden md:block overflow-hidden">
          <motion.div
            className="flex gap-6"
            animate={{ x: -currentIndex * (320 + 24) }} // card width + gap
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          >
            {MOCK_PERFORMANCES.map((performance, index) => (
              <PerformanceCard
                key={performance.id}
                performance={performance}
                index={index}
              />
            ))}
          </motion.div>
        </div>

        {/* Pagination dots (mobile) */}
        <div className="md:hidden flex items-center justify-center gap-2 mt-6">
          {MOCK_PERFORMANCES.map((_, index) => (
            <motion.div
              key={index}
              className={`w-2 h-2 rounded-full ${
                index === 0 ? 'bg-white' : 'bg-white/30'
              }`}
              animate={index === 0 ? { scale: [1, 1.2, 1] } : {}}
              transition={{ duration: 2, repeat: Infinity }}
            />
          ))}
        </div>

        {/* CTA */}
        <motion.div
          className="text-center mt-12"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.5 }}
        >
          <p className="text-gray-400 mb-4">
            Rejoins la communauté et montre ton talent !
          </p>
          <motion.button
            className="px-6 py-3 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold shadow-lg shadow-purple-500/25"
            whileHover={{ scale: 1.05, boxShadow: '0 20px 40px -10px rgba(168, 85, 247, 0.4)' }}
            whileTap={{ scale: 0.95 }}
          >
            C'est mon tour !
          </motion.button>
        </motion.div>
      </div>
    </section>
  )
})

export default RecentPerformancesSection
