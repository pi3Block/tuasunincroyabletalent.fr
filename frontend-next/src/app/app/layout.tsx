import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Studio",
  description:
    "Enregistre ta performance vocale et laisse le jury IA analyser ton chant.",
};

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
