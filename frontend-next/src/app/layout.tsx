import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ef4444",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://kiaraoke.fr"),
  title: {
    default: "Kiaraoke — Le Jury IA qui analyse ton chant",
    template: "%s | Kiaraoke",
  },
  description:
    "Chante ta chanson préférée et laisse notre jury IA analyser ta performance. Justesse, rythme, paroles — feedback personnalisé en moins de 60 secondes. 100% gratuit.",
  keywords: [
    "karaoké IA",
    "analyse vocale",
    "jury IA",
    "chant IA",
    "vocal coaching IA",
    "karaoké en ligne gratuit",
    "analyse pitch",
    "karaoke gratuit",
  ],
  authors: [{ name: "Pierre Legrand", url: "https://pierrelegrand.fr" }],
  creator: "Kiaraoke",
  openGraph: {
    type: "website",
    locale: "fr_FR",
    url: "https://kiaraoke.fr",
    siteName: "Kiaraoke",
    title: "Kiaraoke — Le Jury IA qui analyse ton chant",
    description:
      "Chante ta chanson préférée et laisse notre jury IA analyser ta performance. Justesse, rythme, paroles — feedback en moins de 60 secondes. 100% gratuit.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Kiaraoke — Le Jury IA qui analyse ton chant",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    creator: "@Pi3r2Dev",
  },
  robots: { index: true, follow: true },
};

const jsonLdWebApp = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Kiaraoke",
  alternateName: "Tu as un incroyable talent ?",
  description:
    "Application web d'analyse vocale par IA avec jury personnalisé",
  url: "https://kiaraoke.fr",
  applicationCategory: "EntertainmentApplication",
  operatingSystem: "Web",
  offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
  creator: {
    "@type": "Person",
    name: "Pierre Legrand",
    url: "https://pierrelegrand.fr",
  },
};

const jsonLdFaq = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "Comment fonctionne le jury IA ?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Le jury IA analyse votre chant en 3 dimensions : justesse (pitch via CREPE), rythme (onset detection Librosa) et paroles (transcription Whisper + WER). Trois personas IA génèrent ensuite des commentaires personnalisés via LLM.",
      },
    },
    {
      "@type": "Question",
      name: "Combien de temps dure l'analyse ?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "L'analyse complète prend entre 15 et 65 secondes selon que la référence audio est en cache ou non.",
      },
    },
    {
      "@type": "Question",
      name: "Est-ce gratuit ?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Oui, Kiaraoke est 100% gratuit. Aucun compte requis, aucune limite d'utilisation.",
      },
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdWebApp) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdFaq) }}
        />
      </head>
      <body
        className={`${inter.variable} font-sans antialiased bg-background text-foreground min-h-screen`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
