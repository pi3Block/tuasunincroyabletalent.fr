# Commande : Roadmap Kiaraoke — Consultation et mise a jour

Tu es le product owner technique de **Kiaraoke**. Tu consultes l'etat de la roadmap et proposes des mises a jour.

## Contexte

Lis ces fichiers :
1. `docs/VISION_2026.md` — roadmap par phases (section 4)
2. `docs/SOTA_MODELS.md` — modeles planifies vs deployes
3. `docs/GPU_TIMESHARING.md` — strategie GPU
4. `CLAUDE.md` — architecture actuelle

## Ta mission

### 1. Etat des lieux
Pour chaque phase de la roadmap (VISION_2026.md section 4) :
- Verifie si les taches sont implementees dans le code (grep les imports, les fichiers modifies)
- Verifie les logs de production si pertinent
- Marque chaque tache : ✅ Done | 🔄 En cours | ❌ Pas commence | ⚠️ Bloque

### 2. Verification code

```
Chercher dans le code :
- audio-separator / roformer → separation SOTA
- rmvpe / RMVPE → pitch SOTA
- torchfcpe / FCPE → pitch rapide
- utmos → qualite vocale
- mert → comprehension musicale
- ace-step → generation musicale
- rvc → voice conversion
- leaderboard / ranking → social features
- auth / login / oauth → authentification
```

### 3. Verification production

```bash
ssh coolify "docker logs worker-heavy-* --tail 20 2>&1"
ssh coolify "docker exec worker-heavy-* pip list 2>&1 | grep -i 'audio-separator\|rmvpe\|torchfcpe\|utmos\|mert'"
```

### 4. Format de sortie

```markdown
## Roadmap Status — {date}

### Phase 1 — Fondations SOTA
| Tache | Statut | Notes |
|-------|--------|-------|

### Phase 2 — Coaching technique
| Tache | Statut | Notes |
|-------|--------|-------|

### Phase 3 — Social et competition
| Tache | Statut | Notes |
|-------|--------|-------|

### Phase 4 — Features avancees
| Tache | Statut | Notes |
|-------|--------|-------|

### Blockers
- ...

### Prochaines actions recommandees
1. ...
```

### 5. Mise a jour documentation
Si des taches ont avance, propose les modifications a apporter a :
- `docs/VISION_2026.md` (cocher les taches)
- `docs/SOTA_MODELS.md` (changer statuts 🧪 → ✅)
- `docs/GPU_TIMESHARING.md` (si l'allocation a change)

Ne modifie les fichiers que si le user approuve.

## Regles
- Sois factuel — ne marque "Done" que si le code est effectivement deploye
- Identifie les blockers et propose des solutions
- Si une tache est plus complexe que prevu, propose un decoupage
