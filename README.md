# Amerikaneren

En mobil-først app for det norske kortspillet Amerikaneren. Spill alene mot tre bots, eller opprett et Netlify-rom og inviter venner med en delbar lenke.

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

## Slik synkroniseres onlinerom

Hver romtilstand har et `version`-tall som teller oppover for hver endring.

- Klienten henter rommet med long-polling (`?code=...&since=<version>`). Funksjonen holder svaret åpent til versjonen endrer seg, eller i seks sekunder, slik at trekk kommer fram med én gang.
- Tilstand med lavere versjon enn den vi allerede viser blir forkastet, så et sent svar kan aldri overskrive et ferskt trekk.
- Lagring sender med `baseVersion`. Skriver to spillere samtidig, beholder serveren sin versjon og sender den tilbake.
- Bare verten kjører bots og rydder stikk. Blir verten borte i åtte sekunder, tar en annen spiller over.

Vennene dine kommer rett inn i rommet med lenken `/?rom=KODE`.

## Resten står

Har du bare vinnerkort igjen, tar knappen «Resten står» hjem alle stikkene som er igjen på én gang. Kravet godtas bare når det holder uansett hvordan de andre spiller: hvert av dine trumfkort må være høyere enn alle deres, du må ha nok trumf til å tømme den som sitter med flest, og hvert sidekort må være høyest igjen i fargen. Står det ikke, rister knappen og ingenting skjer.

## iPhone og iPad

Native-appen krever Xcode 26 eller nyere. Nettinnholdet bygges lokalt inn i appen, mens onlinerom bruker Netlify-funksjonen på produksjonssiden.

```bash
npm run ios:sync
npm run ios:open
```

Xcode-prosjektet ligger i `ios/App/App.xcodeproj`. Det er satt opp som en universell iPhone- og iPad-app med bundle-ID `no.olefroiland.amerikaneren`.
