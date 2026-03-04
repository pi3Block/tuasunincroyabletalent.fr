# Commande : Audit SEO complet de Kiaraoke

Tu es un expert SEO technique spécialisé dans les applications web SPA/SSR. Tu audites le projet **kiaraoke.fr**, une application React (CSR) / Next.js (SSR) d'analyse vocale par IA.

## Contexte projet

- **Domaine** : kiaraoke.fr (frontend) + api.kiaraoke.fr (backend)
- **Stack frontend** : React 18 + Vite (actuel) ou Next.js 15 App Router (migration)
- **Stack backend** : FastAPI + Celery + PostgreSQL + Redis
- **Nature** : Application web interactive (enregistrement vocal, analyse IA, résultats)
- **Cible** : Utilisateurs francophones, mobile-first
- **Monétisation** : Gratuit, pas de compte requis

## Phase 1 — Audit technique on-site

### 1.1 Crawl et indexabilité

Analyser les fichiers suivants :

```
frontend/public/robots.txt
frontend/public/sitemap.xml
frontend/public/llms.txt
frontend/index.html
frontend/nginx.conf
```

Vérifier :
- [ ] robots.txt existe et autorise le crawl
- [ ] sitemap.xml liste toutes les URLs publiques
- [ ] llms.txt est à jour (features, URLs, technologies)
- [ ] Canonical URL définie dans `<head>`
- [ ] `<html lang="fr">` présent
- [ ] Pas de `noindex` non voulu

### 1.2 Meta tags et données structurées

Dans `frontend/index.html` (ou `app/layout.tsx` si Next.js) :

- [ ] `<title>` optimisé (< 60 caractères, mots-clés, marque)
- [ ] `<meta name="description">` (< 155 caractères, CTA, proposition de valeur)
- [ ] Open Graph complet (og:title, og:description, og:image 1200x630, og:url, og:type, og:locale, og:site_name)
- [ ] Twitter Cards (twitter:card, twitter:title, twitter:description, twitter:image, twitter:creator)
- [ ] JSON-LD `WebApplication` avec schema.org valide
- [ ] JSON-LD `FAQPage` si section "Comment ça marche" présente
- [ ] og-image.png existe et est optimisée (< 300 Ko)

### 1.3 Hiérarchie des headings

Parcourir les composants landing :

```
frontend/src/components/landing/HeroSection.tsx      → h1 unique
frontend/src/components/landing/HowItWorksSection.tsx → h2
frontend/src/components/landing/RecentPerformancesSection.tsx → h2
frontend/src/components/landing/TechStackSection.tsx  → h2
frontend/src/components/landing/FooterSection.tsx     → pas de heading
```

- [ ] Un seul `<h1>` par page (dans HeroSection)
- [ ] h1 en français, contient les mots-clés principaux
- [ ] Hiérarchie h1 > h2 > h3 respectée
- [ ] Headings descriptifs

### 1.4 HTML sémantique

- [ ] `<main>` wrapper pour le contenu principal
- [ ] `<section>` avec `aria-label` pour chaque section
- [ ] `<footer>` pour le pied de page
- [ ] Images avec `alt` descriptif en français

### 1.5 Security headers

Dans `frontend/nginx.conf` (ou `next.config.ts`) :

- [ ] Strict-Transport-Security (HSTS)
- [ ] X-Content-Type-Options: nosniff
- [ ] X-Frame-Options: DENY
- [ ] Referrer-Policy: strict-origin-when-cross-origin
- [ ] Permissions-Policy (camera, geolocation désactivés — PAS microphone)

## Phase 2 — Performance et Core Web Vitals

- [ ] LCP < 2.5s — vérifier le hero et animations Framer Motion
- [ ] FID < 100ms
- [ ] CLS < 0.1
- [ ] Taille bundle JS totale (viser < 200 Ko gzippé)
- [ ] nginx gzip activé
- [ ] Cache-Control sur assets statiques
- [ ] API : headers Cache-Control sur `/api/audio/*` (streaming)

## Phase 3 — Contenu et mots-clés

Mots-clés cibles : "karaoké IA", "jury IA", "analyse vocale", "chant IA", "gratuit"

- [ ] Proposition de valeur claire above the fold
- [ ] CTA visible sans scroll
- [ ] Social proof (stats, résultats récents)
- [ ] Section "Comment ça marche"

## Phase 4 — Social sharing

- [ ] Preview Facebook/LinkedIn correcte (tester https://opengraph.xyz)
- [ ] Preview Twitter correcte
- [ ] Si Next.js : `/results/[sessionId]` a des meta OG dynamiques

## Phase 5 — Cross-origin et API

- [ ] CORS FastAPI autorise kiaraoke.fr
- [ ] Pas de wildcard `*` en production
- [ ] `GET /health` < 100ms
- [ ] `GET /api/audio/{id}/ref/vocals` — HTTP Range fonctionnel

## Phase 6 — Rapport

```markdown
# Audit SEO — kiaraoke.fr — {date}

## Score global : X/100

## Points forts
- ...

## Points critiques
| Problème | Impact | Effort | Fichier |
|----------|--------|--------|---------|

## Plan d'action (ordonné par impact/effort)
1. ...
```
