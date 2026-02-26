import { HeroSection } from "@/components/sections/hero";
import { HowItWorksSection } from "@/components/sections/how-it-works";
import { RecentPerformancesSection } from "@/components/sections/recent-performances";
import { TechStackSection } from "@/components/sections/tech-stack";
import { FooterSection } from "@/components/layout/footer";

/**
 * Landing page — SSG (Server Component composing Client Components)
 * Full SEO: metadata from layout.tsx, JSON-LD, semantic HTML
 */
export default function HomePage() {
  return (
    <main className="min-h-screen bg-gray-900 text-white overflow-x-hidden">
      <HeroSection />
      <HowItWorksSection />
      <RecentPerformancesSection />
      <TechStackSection />
      <FooterSection />
    </main>
  );
}
