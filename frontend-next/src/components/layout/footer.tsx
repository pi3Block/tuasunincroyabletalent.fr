"use client";

import { memo } from "react";
import { motion } from "framer-motion";
import { Heart, Github, Twitter } from "lucide-react";
import Link from "next/link";

export const FooterSection = memo(function FooterSection() {
  return (
    <footer className="relative py-12 px-4 border-t border-border">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <motion.div
            className="flex items-center gap-2"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
          >
            <span className="text-2xl">🎤</span>
            <Link href="/" className="text-lg font-bold text-foreground">
              Kiaraoke
            </Link>
          </motion.div>

          <motion.div
            className="flex items-center gap-1 text-muted-foreground text-sm"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
          >
            <span>Fait avec</span>
            <motion.span
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
            >
              <Heart className="w-4 h-4 text-red-500 fill-red-500" />
            </motion.span>
            <span>et beaucoup d&apos;IA par</span>
            <a
              href="https://pierrelegrand.fr"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-primary/80 hover:underline transition-colors"
            >
              pierrelegrand.fr
            </a>
          </motion.div>

          <motion.div
            className="flex items-center gap-4"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
          >
            <motion.a
              href="https://github.com/pi3Block/"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-full bg-secondary/50 border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            >
              <Github className="w-5 h-5" />
            </motion.a>
            <motion.a
              href="https://x.com/Pi3r2Dev"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-full bg-secondary/50 border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            >
              <Twitter className="w-5 h-5" />
            </motion.a>
          </motion.div>
        </div>

        <motion.div
          className="mt-8 text-center text-muted-foreground text-sm"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 }}
        >
          <p>
            &copy; {new Date().getFullYear()} Kiaraoke. Tous droits reserves.
          </p>
          <p className="mt-1">
            Propulse par{" "}
            <a
              href="https://ollama.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Ollama
            </a>
            {" • "}
            <a
              href="https://github.com/facebookresearch/demucs"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Demucs
            </a>
            {" • "}
            <a
              href="https://github.com/openai/whisper"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Whisper
            </a>
          </p>
        </motion.div>
      </div>
    </footer>
  );
});

export default FooterSection;
