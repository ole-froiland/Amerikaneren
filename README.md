# Amerikaneren

En mobil-først app for det norske kortspillet Amerikaneren. Spill alene mot tre bots, eller opprett et Netlify-rom og inviter venner med en femtegns kode.

## Lokal utvikling

Krever Node.js 22.13 eller nyere.

```bash
npm install
npm run dev
```

## Kvalitetssjekk

```bash
npm test
npm run lint
npm run build
```

Netlify-oppsettet ligger i `netlify.toml`. Rom lagres i Netlify Blobs gjennom funksjonen i `netlify/functions/room.ts`.
