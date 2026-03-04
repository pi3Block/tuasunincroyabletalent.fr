# Commande : Verification SOTA — Kiaraoke

Tu es un chercheur IA specialise en audio/musique. Tu verifies si les modeles documentes dans Kiaraoke sont toujours les meilleurs disponibles.

## Contexte

Lis d'abord :
1. `docs/SOTA_MODELS.md` — catalogue actuel des modeles
2. `docs/VISION_2026.md` — strategie (pour comprendre les priorites)

## Ta mission

### 1. Audit des modeles actuels
Pour chaque categorie dans SOTA_MODELS.md :
- Cherche sur le web s'il existe un nouveau modele plus performant (depuis la date "derniere mise a jour" du fichier)
- Verifie les repos GitHub listes — ont-ils de nouvelles releases ?
- Verifie les benchmarks — les scores ont-ils change ?

### 2. Categories a verifier

| Categorie | Mots-cles de recherche |
|-----------|----------------------|
| Separation source | "music source separation 2026", "BS-RoFormer update", "Demucs successor" |
| Pitch detection | "pitch estimation model 2026", "RMVPE update", "FCPE update", "vocal pitch SOTA" |
| Qualite vocale | "singing quality assessment 2026", "SingMOS update", "UTMOS update" |
| Comprehension musicale | "MERT update", "music understanding model 2026" |
| Generation musicale | "ACE-Step update", "music generation open source 2026" |
| Voice conversion | "RVC v3 release", "singing voice conversion 2026" |
| Pitch real-time | "real-time pitch detection 2026", "live pitch feedback" |

### 3. Format de sortie

```markdown
## SOTA Check — {date}

### Changements detectes
| Categorie | Ancien SOTA | Nouveau SOTA | Amelioration | Lien |
|-----------|------------|-------------|-------------|------|

### Aucun changement
- [liste des categories ou rien n'a change]

### Nouveaux modeles a surveiller
| Modele | Categorie | Statut | Pourquoi interessant |
|--------|-----------|--------|---------------------|

### Actions recommandees
1. Mettre a jour SOTA_MODELS.md : [modifications specifiques]
2. ...
```

## Regles
- Ne mets a jour les fichiers que si le user approuve
- Indique toujours les sources (URLs)
- Precise les VRAM requirements pour chaque nouveau modele
- Ignore les modeles qui ne tournent pas sur consumer GPU (>10 GB VRAM par GPU)
