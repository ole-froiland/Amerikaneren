# Amerikaneren

En mobil-først app med tre spill: kortspillet Amerikaneren, sjakk og et pokerbord. Spill alene mot bots, eller opprett et Netlify-rom og inviter venner med en delbar lenke.

## Oppsettet

Forsiden er en veiviser med ett valg om gangen: alene eller med venner, hvilket spill, hvor mange
spillere, hvor tøffe botene skal være, om coachen skal være på – og til slutt start eller vent på
venner i lobbyen. Bare stegene som gjelder for valget ditt vises: Amerikaneren spør om antall bare
når du spiller med venner, sjakk spør om botnivå bare når du spiller alene, og coachen hører til
pokerbordet. Poker kan foreløpig bare spilles alene.

Reglene ligger i `stepsFor()` i `src/setup.ts` og er testet i `src/setup.test.ts`. Selve skallet er
`src/StartWizard.tsx`, som både forsiden og `/poker` bruker – pokersiden låser spillet og hopper over
de to første stegene. Valgene huskes i localStorage. Nøkkelen for spillet heter fortsatt
`amerikaneren-spill`, og verdien `bakrommet` fra før navnebyttet leses som poker.

## Sjakk

Vanlige regler hele veien: rokade begge veier, en passant, promotering til fire brikker, sjakk, matt
og patt. Remis meldes ved samme stilling tre ganger, femti trekk uten slag eller bondetrekk, og når
ingen har nok materiell til å sette matt. Trekkene skrives på norsk notasjon (`Sf3`, `exd5`, `0-0`,
`Dh4#`) i listen under brettet.

Motoren i `src/chess.ts` er rene funksjoner uten React. At reglene faktisk stemmer er låst med
perft-tester i `src/chess.test.ts`: antall trekkfølger fra kjente stillinger telles opp og
sammenlignes med fasiten (20, 400 og 8902 fra utgangsstillingen, 2039 fra Kiwipete, og to stillinger
til som er laget for å avsløre feil i binding, rokade og promotering).

Boten er negamax med alfa-beta, slagsortering og en kort slagveksling på slutten, så den ikke slutter
å regne midt i et bytte. Den graver ett trinn dypere om gangen og tar med seg rekkefølgen fra forrige
runde, så det beste trekket prøves først. Går tiden ut midt i en runde, beholder den svaret fra runden
før — aldri et halvferdig.

De fem nivåene setter dybde og tidsbudsjett: nybegynner ett trekk, lett to, middels tre (0,4 s),
vanskelig fire (0,9 s) og umulig opptil seks (1,5 s). De to letteste slenger i tillegg ut et tilfeldig
trekk i 55 og 30 prosent av tilfellene, så de går an å slå. Vurderingen er materiell pluss
standardtabeller for hvor brikkene står godt. En test spiller ut en tårnstige og krever at det
høyeste nivået setter matt i to.

Under partiet kan du be om hint — samme søk som coachen, uavhengig av hvor sterk boten er — tilby
remis, eller gi deg. Boten sier ja til remis når den ikke står bedre enn 0,2 bonde. Et tilbud faller
bort i det motparten flytter.

Mot en venn deler dere samme rom som i Amerikaneren: verten spiller hvit, den som blir med spiller
svart, og brettet snus så dine egne brikker står nærmest. Brettet lastes først når noen faktisk skal
spille sjakk.

### Hvem står best

Baren til venstre for brettet viser hvem som leder. Din egen farge fyller nedenfra, som på brettet,
og tallet står alltid sett fra hvit: `+1,2` betyr at hvit leder med drøyt en bonde, `M3` at det er
matt om tre trekk. Utslaget følger samme kurve som vinnersjanse (`gaugeShare()`), så små forsprang
er synlige uten at store fyller hele baren.

Tallet kommer fra et grunt søk på to trekk – nok til å se at en brikke henger, raskt nok til å regnes
på nytt etter hvert eneste trekk. Baren står der uansett om coachen er på.

### Hva trekket gjør

Under brettet står en linje om siste trekk – uansett hvem som gjorde det, og uavhengig av coachen.
Den sier hva trekket faktisk gjør: slår en brikke, gir sjakk, utvikler, tar sentrum, truer noe, setter
en gaffel, eller lar brikken stå i slag. Alt leses rett ut av stillingen etter trekket, så det er
etterprøvbart og ikke gjetning.

Følger partiet fortsatt en kjent åpning, står navnet i en gyllen brikke ved siden av: Spansk,
Siciliansk, Dronninggambit, Kongeindisk og resten av linjene i `OPENINGS` i `src/chess.ts`. Navnet
forsvinner i det partiet går ut av teori.

Er det ditt eget trekk som ligger sist, står coachens merke først i linjen. Har motstanderen svart,
omtaler linjen deres trekk, mens ditt eget merke blir stående på ruta på brettet.

### Gjennomgang etter partiet

Er coachen på, regnes hele partiet gjennom når det er slutt: treffsikkerhet fra 0 til 100 for begge
sider, delt på åpning, midtspill og sluttspill, og antall tabber. Trykk på en av delene for å se hvilket
trekk som holdt best og hvilket som kostet mest der.

Hvert trekk sammenlignes med det beste trekket i stillingen, og tapet gjøres om til en score med
`100 · e^(−tap/180)`: null tap er 100, en halv bonde er 76, en hel er 57, tre er 19. Skalaen er vår
egen, ikke chess.com sin, men den er monoton og dokumentert i `accuracyOf()`.

Åpningen er de ti første trekkene hver, sluttspillet begynner når det er mindre enn 1400 i
offisersmateriell igjen, og resten er midtspill. Gjennomgangen bruker samme dybde som coachen — grunnere
ville ikke sett at et trekk slipper inn matt — men trenger bare to søk per trekk, siden den skal finne
tapet og ikke navnet på det beste trekket. Et helt parti på 69 trekk tar rundt 130 ms, og regnes ut ett
trekk om gangen så siden ikke fryser.

### Coach på brettet

Skrus på i oppsettet, og gjelder bare dine egne trekk. Hvert trekk får et merke på ruta det gikk til:
briljant `!!`, beste `★`, bra `✓`, unøyaktig `?!`, bom `?` og tabbe `??`. Var det et bedre trekk,
tegnes en pil fra og til der coachen ville flyttet, og linjen under brettet sier hvilket trekk det var.

Regnestykket er forskjellen mellom det beste trekket i stillingen og det du spilte, målt i hundredels
bonde: under 30 er bra, under 90 unøyaktig, under 250 bom, og over det en tabbe. Briljant er
forbeholdt det beste trekket når det ofrer en brikke og likevel er klart bedre enn nest best.

**Dommen bygger på stillingen slik den var i øyeblikket**, ikke på hvordan partiet endte – samme
prinsipp som pokercoachen. Merket blir stående mens motstanderen svarer, og forsvinner når du selv
flytter igjen. Coachen regner tre trekk fram, altså dypere enn boten spiller, så den holder også mot
det vanskeligste nivået. `reviewMove()` ligger i `src/chess.ts` og er testet i `src/chess.test.ts`.

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

Rommet vet hvilket spill det gjelder (`kind`), og serveren lagrer tilstanden uten å røre innholdet.
Det avgjør også hvor mange som får plass: fire i Amerikaneren, to i sjakk.

Hver romtilstand har et `version`-tall som teller oppover for hver endring.

- Klienten henter rommet med long-polling (`?code=...&since=<version>`). Funksjonen holder svaret åpent til versjonen endrer seg, eller i seks sekunder, slik at trekk kommer fram med én gang.
- Tilstand med lavere versjon enn den vi allerede viser blir forkastet, så et sent svar kan aldri overskrive et ferskt trekk.
- Lagring sender med `baseVersion`. Skriver to spillere samtidig, beholder serveren sin versjon og sender den tilbake.
- Bare verten kjører bots og rydder stikk. Blir verten borte i åtte sekunder, tar en annen spiller over.

Vennene dine kommer rett inn i rommet med lenken `/?rom=KODE`.

## Resten står

Har du bare vinnerkort igjen, tar knappen «Resten står» hjem alle stikkene som er igjen på én gang. Kravet godtas bare når det holder uansett hvordan de andre spiller: hvert av dine trumfkort må være høyere enn alle deres, du må ha nok trumf til å tømme den som sitter med flest, og hvert sidekort må være høyest igjen i fargen. Står det ikke, rister knappen og ingenting skjer.

## Bakrommet (pokerbordet)

På `/poker` ligger et Texas hold'em-bord. Ingen ekte penger: alle får 1000 sjetonger, blindene er
10/20, og du velger 1–5 motstandere. Velger du Bakrommet i veiviseren, sendes du hit med `?start=1`
og bordet deles ut med en gang – koden for pokerbordet lastes fortsatt først når adressen åpnes.

Dealerknappen, lilleblind og storeblind flyttes ett sete for hver hånd. Flop, turn og river deles ut
med tre, ett og ett kort, med en budrunde mellom hver. Du kan kaste, sjekke, syne, høyne eller gå all-in.
Sidepotter regnes ut når noen er all-in for mindre enn de andre.

Botene har fem nivåer, fra nybegynner til umulig. De svakeste syner nesten alt og høyner sjelden, de
sterkeste legger ned søppel og presser hardt — målt over mange hender kaster de mangedobbelt så ofte.
Profilene ligger i `DIFFICULTY` i `src/poker.ts`, og en test låser at skalaen faktisk er en skala:
for hvert steg oppover skal boten feilvurdere mindre, syne mer nøkternt og høyne på svakere hender.

Øverst til høyre står sjansen for at du vinner hånden, regnet ut med Monte Carlo mot tilfeldige
motstanderhender (`equity()`). Den treffer standard oddstabeller innenfor ett prosentpoeng og tar rundt
30 ms, så den regnes bare når kortene faktisk endrer seg. Knappen ved siden av skjuler den, og valget huskes.

Øverst står også hvor mye du er opp eller ned siden du satte deg.

Etter showdown rangeres hendene fra best til svakest med plassnummer, slik at det er tydelig hvem som
hadde hva — også når to hender har samme navn og bare sidekortet skiller dem. Hendene til dem som kastet
seg regnes ut mot det ferdige bordet og vises dempet med «Kastet», så du ser om du la ned vinnerhånden.
Det krever at bordet rakk å bli ferdig; sluttet hånden på floppen, finnes det ingen fasit.

Vant noen fordi alle andre kastet seg, viser de ikke kortene — da står det ingen påstand om hvem som
«ville vunnet», for det vet vi ikke. Skrur du av coachen, spiller du uten fasit.

## Coach

Skrus på i oppsettet — samme bryter viser også kortene til dem som kastet seg. Etter hver hånd går den
gjennom dine egne trekk og sier om prisen var riktig.

Regnestykket er pott-odds mot vinnersjanse: syner du 20 i en pott på 60, betaler du 20 for å vinne 80,
og trenger 25 % for å gå i null. Er vinnersjansen din høyere, var synet riktig.

**Dommen bygger utelukkende på det som var kjent i øyeblikket** — kortene, prisen og hvor mange som var
med. Om hånden endte godt eller dårlig er uten betydning. En all-in med 5 % sjanse er en tabbe selv om
den traff, og et riktig priset syn er riktig selv om du tapte det. `coachReview()` leser bare
`state.review`, aldri resultatet, og testene låser oppførselen: samme trekk gir samme dom enten spilleren
endte med 0 eller 5000 sjetonger.

Bløffer straffes ikke i seg selv — de merkes bare som bløff. Først når innsatsen er stor og sjansen liten
kalles det en tabbe.

Sjansen antar at motstanderne har tilfeldige kort. Den vet ikke at en som høyner hardt sjelden har søppel,
så den er litt optimistisk når noen presser deg.

Motoren ligger i `src/poker.ts` og er rene funksjoner uten React, testet i `src/poker.test.ts`.
Siden lastes først når adressen åpnes, så forsiden får ikke med seg koden.

## iPhone og iPad

Native-appen krever Xcode 26 eller nyere. Nettinnholdet bygges lokalt inn i appen, mens onlinerom bruker Netlify-funksjonen på produksjonssiden.

```bash
npm run ios:sync
npm run ios:open
```

Xcode-prosjektet ligger i `ios/App/App.xcodeproj`. Det er satt opp som en universell iPhone- og iPad-app med bundle-ID `no.olefroiland.amerikaneren`.
