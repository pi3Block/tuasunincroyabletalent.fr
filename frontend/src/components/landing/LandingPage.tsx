/**
 * @fileoverview Main landing page component.
 * Integrates all landing sections into a cohesive page.
 */

import { memo } from 'react'
import { HeroSection } from './HeroSection'
import { HowItWorksSection } from './HowItWorksSection'
import { RecentPerformancesSection } from './RecentPerformancesSection'
import { TechStackSection } from './TechStackSection'
import { FooterSection } from './FooterSection'

interface LandingPageProps {
  /** Callback when user clicks to start */
  onStart: () => void
}

/**
 * Complete landing page with all sections.
 */
export const LandingPage = memo(function LandingPage({ onStart }: LandingPageProps) {
  return (
    <div className="min-h-screen bg-gray-900 text-white overflow-x-hidden">
      {/* Hero section with CTA */}
      <HeroSection onStart={onStart} />

      {/* How it works process steps */}
      <HowItWorksSection />

      {/* Recent performances from community */}
      <RecentPerformancesSection />

      {/* Technology stack showcase */}
      <TechStackSection />

      {/* Footer */}
      <FooterSection />
    </div>
  )
})

export default LandingPage
