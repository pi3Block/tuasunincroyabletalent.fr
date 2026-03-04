# Commande : Session de brainstorming Kiaraoke

Tu es un product strategist et architecte technique senior. Tu menes une session de brainstorming pour **Kiaraoke** (kiaraoke.fr), l'application francaise d'analyse vocale par IA.

## Contexte

Lis d'abord ces fichiers pour comprendre l'etat actuel :
1. `docs/VISION_2026.md` — strategie globale, positionnement, roadmap
2. `docs/SOTA_MODELS.md` — catalogue des modeles IA disponibles
3. `docs/GPU_TIMESHARING.md` — strategie GPU
4. `CLAUDE.md` — architecture technique actuelle

## Ta mission

### Phase 1 — Comprendre l'etat actuel
- Lis les docs ci-dessus
- Identifie ce qui a ete implemente vs ce qui est encore en plan
- Verifie les logs recents si pertinent (`ssh coolify "docker logs worker-heavy-* --tail 50"`)

### Phase 2 — Recherche web
- Cherche sur le web les dernieres avancees (modeles, concurrents, tendances) pertinentes
- Compare avec notre catalogue SOTA_MODELS.md — y a-t-il de nouveaux modeles depuis la derniere mise a jour ?
- Regarde ce que font les concurrents (MuSigPro, Singing Carrots, Smule, KaraFun) en ce moment

### Phase 3 — Brainstorming structure
Propose des idees organisees en :

1. **Quick wins** (implementable en <1 jour, impact immediat)
2. **Features differenciantes** (1-2 semaines, avantage concurrentiel)
3. **Moonshots** (1+ mois, game changer)

Pour chaque idee, donne :
- Description en 1-2 phrases
- Impact utilisateur (1-5 etoiles)
- Effort technique (S/M/L/XL)
- Modeles/libs necessaires
- VRAM requise
- Dependances (quoi doit etre fait avant)

### Phase 4 — Discussion
Pose 2-3 questions strategiques au user pour affiner les priorites.

## Format de sortie

```markdown
## Brainstorm Kiaraoke — {date}

### Nouveautes SOTA depuis derniere mise a jour
- ...

### Quick wins
| # | Idee | Impact | Effort | Deps |
|---|------|--------|--------|------|

### Features differenciantes
| # | Idee | Impact | Effort | Deps |
|---|------|--------|--------|------|

### Moonshots
| # | Idee | Impact | Effort | Deps |
|---|------|--------|--------|------|

### Questions strategiques
1. ...
```

## Regles
- Ne propose RIEN qui necessite plus de 10 GB VRAM par GPU
- Tout doit tourner sur notre infra (5 GPUs, 3x RTX 3070 8GB + 2x RTX 3080 10GB)
- Privilegier l'open-source self-hosted
- Pas d'implementation dans cette commande — uniquement reflexion et documentation
- Si des idees meritent d'etre ajoutees a VISION_2026.md ou SOTA_MODELS.md, propose les modifications
