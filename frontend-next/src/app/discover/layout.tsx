import type { Metadata } from "next";
import { Navbar } from "@/components/layout/navbar";

export const metadata: Metadata = {
  title: "Decouvrir - Kiaraoke",
  description:
    "Decouvre les meilleures performances vocales de la communaute Kiaraoke. Ecoute, vote, et partage ton talent !",
};

export default function DiscoverLayout({
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
