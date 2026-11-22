# GlitchOut Fighter (cartella `clash/`)

Il pubblico scansiona un QR, **vota il personaggio preferito tra 6** (3 uomini, 3 donne, surreali). I due più votati combattono; poi ognuno **sceglie chi spingere** e, per 90 secondi, vota mosse, tocca, insulta. Il combattimento è **un solo video continuo** con i due personaggi nella stessa scena. Tutto gira sul Mac.

## Demo day: la scaletta (LIVE)

**Importante:** GlitchOut Fighter è solo LIVE. Non c'è un mock né un replay: o genera video veri o non parte.

**Prima di salire sul palco**
1. Avvia: doppio clic su `start.command` (oppure `npm run go`). Il terminale stampa gli indirizzi e apre da solo la pagina di controllo. Se la porta 3000 è occupata da un'altra app, usa la successiva e lo scrive.
2. In `/control` premi **"Check everything is ready"**: deve dire **READY FOR LIVE** (chiave MachGen, chiave ElevenLabs, ffmpeg, 6 ritratti, tetto di spesa, indirizzo per i telefoni). Se non è LIVE, in alto compare un avviso arancione con il motivo e il pulsante per tornare LIVE.
3. Sul proiettore apri `/screen` a schermo intero (`f`) e **clicca una volta** per attivare l'audio. Lo schermo è pulito di default; `k` mostra la legenda dei tasti, `d` apre il pannello costi, `?fx=1` riporta gli effetti retrò.
4. Metti il tetto di spesa che vuoi (`MAX_SPEND` o dal pannello). Ogni partita costa circa 3 $.

**Durante la demo**
- **▶ Run LIVE demo** in `/control`: porta dentro i telefoni virtuali, apre il voto, poi parte tutta la partita con video e voci veri. Nella pagina vedi anche l'anteprima muta dello schermo e la parete degli utenti simulati.
- Telefoni veri: il QR sul proiettore punta al Mac. Stessa rete Wi-Fi, oppure condividi la rete dal Mac / usa l'hotspot di un telefono (ai telefoni non serve internet).
- Per giocare in prima persona: scheda "Play yourself" in `/demo`, oppure la tastiera sullo schermo (rosa `A` tap, `Q W E` mosse, `Z` insulto; ciano `L`, `I O P`, `M`).
- Per pilotare: forza l'esito del prossimo round, lancia "tap storm" o "taunt wave", fai parlare il cronista, scegli i due lottatori saltando il voto.
- **⛔ STOP ALL** (anche tasto `x` sullo schermo): ferma tutto, annulla ciò che è in coda e blocca i costi.

**Se qualcosa va storto**
- Video lento: è la coda del servizio; il gioco tiene l'ultima scena in loop per qualche secondo e poi riprende. Se la prima clip non arriva, il pannello lo segnala: Reset e rilancia.
- Se l'intro non si genera la partita viene annullata e torni in lobby con un avviso (rosso in `/control` e sullo schermo): **non esiste nessuna modalità finta**. Reset e rilancia.

## Avvio

```bash
cd clash
cp .env.example .env     # metti MACHGEN_API_KEY (obbligatoria) e ELEVENLABS_API_KEY. Ogni cartella/worktree ha il suo .env: senza chiave il server non parte
node server.js           # --fast = voto più corto per le prove (il video è sempre vero)
```

- Schermo: `http://localhost:3000/screen` (QR, casting, video, **barra debug in fondo** con costi e STOP). Tasti: `spazio` avvia/salta, `b` +20 bot, `r` reset, `x` STOP ALL, `d` apre/chiude il pannello debug, `f` fullscreen.
- Demo con telefoni finti: `http://localhost:3000/demo?n=40&auto=1` (schermo + parete di utenti virtuali). Solo parete: `/sim?n=40`.
- Galleria degli stili: `http://localhost:3000/styles` (si cambia stile dalla lobby, o dal pannello debug).
- Telefoni: URL stampato all'avvio o `PUBLIC_URL` (tunnel Cloudflare, da fare alla fine).

## Controllo, demo e telefoni (senza tunnel)

- **Pagina di controllo**: `http://localhost:3000/control` — fa partire e giostra i test: start casting, **matchup rapido** (scegli i due lottatori e salta il voto), forza l'esito del prossimo round (rosa vince / ciano vince / scontro), richiami al pubblico (tap storm, taunt wave), battute del cronista, battute dei lottatori, frase libera da pronunciare, bot, giocatori "da tastiera", costi, tetto di spesa e **STOP ALL**. Da un altro dispositivo sulla stessa rete: imposta `ADMIN_PIN` in `.env` e apri `http://IP-DEL-MAC:3000/control` (chiede il PIN). Mai attraverso il tunnel.
- **Demo interattiva**: `http://localhost:3000/demo?n=40&auto=1` — schermo + parete di 40 telefoni finti; la scheda **"Play yourself"** a destra è un telefono vero usabile con mouse o touch dal presentatore o da un volontario.
- **Giocatori da tastiera** (peso x10) sulla pagina schermo durante lo scontro: rosa `A` tap · `Q W E` mosse · `Z` insulto; ciano `L` tap · `I O P` mosse · `M` insulto. Una leggenda è sempre visibile in basso a sinistra.
- **Telefoni veri senza tunnel**: il QR punta già all'IP del Mac (`http://IP:3000`). Funziona se i telefoni sono sulla stessa rete Wi-Fi. Se il Wi-Fi della sala isola i dispositivi, crea la rete dal Mac (Impostazioni di Sistema > Condivisione > Condivisione Internet) o usa l'hotspot di un telefono per Mac e pubblico: non serve internet per i telefoni, solo per le API del Mac.

## Flusso

1. **Lobby** → 2. **Casting** (25s): ogni telefono vota un personaggio → 3. i due più votati diventano gli angoli rosa (A, a sinistra) e ciano (B). Chi ha votato un finalista tifa per lui, gli altri vanno dove ci sono meno tifosi; si può cambiare lato ogni 3s → 4. **Intro** (video con entrambi) → 5. **6 round**: voto mossa (Attack / Guard / mossa speciale del personaggio), tap, insulti; il telecronista (la rana) chiede "tap storm" e "taunt wave" → 6. **Risultato**.

## Video unico (clip concatenate)

Intro R2V con i due ritratti, poi ogni round è un I2V che parte dall'ultimo fotogramma del precedente. Mentre una clip va in onda il server prepara le continuazioni possibili (2 in modalità Economy, 3 altrimenti: vince A / vince B / pareggio); al voto parte quella giusta. Se tarda più di 4s parte un ramo già pronto e l'esito si adegua al video. Nel finale non si scambia mai il vincitore.

## Varietà dei combattimenti

Ogni partita pesca da un "mazzo" (`newDeck` in `media.js`), senza ripetizioni finché il mazzo non finisce: **scena** (inseguimento, tuffo dal furgone, lampione come arma, scontro di colpi, contromossa, duello in aria, corsa sul muro, presa e lancio, imboscata, carica nel vapore), **camera** (whip pan, drone, orbita, a terra, crash-zoom...), **evento della strada** (12), **come perde chi perde** (7), **gesto di chi vince** (6), **colpo di grazia** nel finale (4).
- Ogni round ha un ruolo nella storia: apertura, escalation, caos, disperazione, climax. Le tre possibili conclusioni di un round (vince rosa, vince ciano, pareggio) mostrano la stessa scena con esiti diversi.
- La clip mostra a caso una **mossa speciale**, un **colpo normale** o una **contromossa**; ogni personaggio ha 3 colpi e 2 contromosse in `roster.js`. Il cronista descrive quello che la clip mostra davvero.
- Intro diversa a ogni partita. Per vedere i prompt di una partita finta senza spendere: `node scripts/showprompts.mjs seraph mercury`.

## Costi (misurati)

Ritratto 0,004 $ · frase di voce 0,065 $ (cache su disco, una volta sola) · clip 13s circa 0,195 $. Costo previsto per partita in Economy: circa 2,6 $ (intro + 12 clip). I ritratti sono generati una volta per stile in `media/roster/<stile>/`.
Debug in fondo allo schermo: spesa per tipo, tetto di spesa (`MAX_SPEND`, default 10 $), **STOP ALL** (annulla i task in coda, blocca ogni chiamata a pagamento finché non premi Resume), toggle Economy / audio nei clip / voci automatiche.

## Personaggi e stile

Sei combattenti cyber-surreali, uno stile solo (`neon-disruptor`, in `roster.js`): Mercury (pelle di mercurio), Null (volto-specchio nero), Doctor Moth (ali di vetro), Seraph (aureola olografica), Orchid (orchidee bioluminescenti), Widow (zampe di ragno cromate). Ritratti fatti con **Krea 3** (generatore creativo, circa 0,027 $ l'uno) e salvati in `media/roster/neon-disruptor/`; le versioni vecchie sono in `media/roster/archive/`. I ritratti sono 16:9: nelle schede si vede il centro.

## Brand (visual identity v1, "Mix")

Emergency Teletext page + phosphor war room + trading-card punch. Everything in the UI is English. Source of truth: `public/assets/brand.css` (tokens + glitch kit), `brand.js` (duotone filters, starburst), `art.js` (pixel sprites: saucer, martian, robot, satellite), loaded by `screen.html`, `phone.html`, `sim.html`.

- Corners never change: **A = pink `#ff3fa4` (left)**, **B = cyan `#00f0ff` (right)** (the host says "pink corner / cyan corner" in cached audio).
- Fonts: Rubik Glitch (names, titles, >= 24px), VT323 (text, subtitles, data), Bangers (bursts only). Loaded from Google Fonts with system fallbacks, so the venue needs internet or the fonts fall back.
- Glitch kit: `.gl` RGB split on text, `.gs` slice shift on an image (duotone `dA` pink / `dB` cyan / `dG` green / `dY` amber for the host), `.trk` tracking band. Respects `prefers-reduced-motion`.
- Phones use small JPEG thumbnails (`media/roster/<style>/thumb/<id>.jpg`, exposed as `thumb` in the roster view); the big screen uses the full PNG.
- Static brand files are served from `/assets/*` (`public/assets/`).
- The debug dock (`debug-panel.js`) is untouched and keeps its own look.

## File

`server.js` (flusso, voti, motore, catena di clip, SSE, admin) · `media.js` (client MachGen) · `audio.js` (voci con cache) · `roster.js` (personaggi + stili) · `lines.js` (telecronista + insulti) · `ledger.js` (costi, tetto, STOP) · `public/` (phone, screen, sim, demo, styles, debug-panel.js).
