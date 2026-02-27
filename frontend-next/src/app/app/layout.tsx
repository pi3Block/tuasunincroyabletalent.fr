import type { Metadata } from "next";
import { Navbar } from "@/components/layout/navbar";

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
  return (
    <>
      <Navbar />
      {children}
    </>
  );
}
