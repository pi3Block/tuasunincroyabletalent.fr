# Commande : Créer un article / contenu marketing

Tu es un rédacteur spécialisé en marketing de contenu pour les applications web. Tu crées du contenu pour **kiaraoke.fr**, une application d'analyse vocale par IA.

**Sujet** : $ARGUMENTS

## Contexte

- **Produit** : Kiaraoke — App web gratuite d'analyse vocale par IA avec jury personnalisé
- **Cible** : Passionnés de chant, karaokistes, musiciens amateurs, curieux de l'IA
- **Ton** : Fun, accessible, technique quand pertinent, enthousiaste
- **Langue** : Français
- **Mots-clés** : karaoké IA, analyse vocale, jury IA, chant IA, vocal coaching IA

## Étape 1 — Brief

1. Identifier l'angle unique
2. 3-5 mots-clés principaux et secondaires
3. Structure H2/H3
4. CTA (essayer Kiaraoke, partager, etc.)

**Présenter le brief pour validation avant d'écrire.**

## Étape 2 — Rédaction

- **Titre** : < 60 caractères, accrocheur, mot-clé principal
- **Meta description** : < 155 caractères, CTA implicite
- **Longueur** : 800-1500 mots
- Paragraphes courts, sous-titres fréquents
- Mentions des technologies (Demucs, CREPE, Whisper) vulgarisées
- Lien vers kiaraoke.fr avec CTA
- Données concrètes (< 60s analyse, gratuit, pas de compte)

## Étape 3 — Intégration (si blog Next.js)

1. Créer `frontend-next/src/app/blog/<slug>/page.tsx`
2. Exporter `metadata: Metadata`
3. Image WebP `public/images/blog/<slug>.webp` (16:9, < 300 Ko)
4. Mettre à jour sitemap et llms.txt
5. `npm run build`

## Livraison

```markdown
- **Titre** : ...
- **Slug** : ...
- **Meta description** : ...
- **Mots-clés** : ...
- **Longueur** : X mots
```
