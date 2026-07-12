# HAMZA FX — Duplicateur Telegram

Copie chaque message d'un canal vers un autre, 24h/24.

---

## Setup (5 minutes)

### 1. Créer le bot
- Ouvre Telegram → cherche **@BotFather**
- Envoie `/newbot` → choisis un nom → tu reçois un **TOKEN**

### 2. Ajouter le bot aux 2 canaux
- Va dans ton **canal source** → Admins → Ajoute le bot (droit : "Poster des messages")
- Fais pareil dans ton **canal destination**

### 3. Remplir config.json
```json
{
  "token": "COLLE_TON_TOKEN_ICI",
  "source_id": 0,
  "destination_id": 0
}
```
Laisse les IDs à 0 pour l'instant.

### 4. Trouver les IDs des canaux
```
npm install
node index.js
```
Le bot démarre en **mode découverte** — envoie un message dans chacun de tes canaux, il affiche leurs IDs dans le terminal.

### 5. Mettre les IDs dans config.json
```json
{
  "token": "ton_token",
  "source_id": -1001234567890,
  "destination_id": -1009876543210
}
```
Relance : `node index.js` → ça copie automatiquement.

---

## Tourner 24h/24 (PC éteint)

Déploie sur Railway (gratuit) → le bot tourne même PC éteint.
