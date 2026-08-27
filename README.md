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

## iPhone og iPad

Native-appen krever Xcode 26 eller nyere. Nettinnholdet bygges lokalt inn i appen, mens onlinerom bruker Netlify-funksjonen på produksjonssiden.

```bash
npm run ios:sync
npm run ios:open
```

Xcode-prosjektet ligger i `ios/App/App.xcodeproj`. Det er satt opp som en universell iPhone- og iPad-app med bundle-ID `no.olefroiland.amerikaneren`.
