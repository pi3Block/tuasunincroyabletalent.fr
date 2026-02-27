import { HeroSection } from "@/components/sections/hero";
import { HowItWorksSection } from "@/components/sections/how-it-works";
import { RecentPerformancesSection } from "@/components/sections/recent-performances";
import { TechStackSection } from "@/components/sections/tech-stack";
import { FooterSection } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";

/**
 * Landing page — SSG (Server Component composing Client Components)
 * Full SEO: metadata from layout.tsx, JSON-LD, semantic HTML
 */
export default function HomePage() {
  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      <Navbar />
      <main>
        <HeroSection />
      <HowItWorksSection />
      <RecentPerformancesSection />
      <TechStackSection />
      <FooterSection />
      </main>
    </div>
  );
}
