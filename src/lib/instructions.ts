export type Lang = "it" | "en";

export interface GameInstructions {
  title: string;
  it: string[];
  en: string[];
}

const INSTRUCTIONS: Record<string, GameInstructions> = {
  "snake": {
    title: "Snake",
    it: [
      "Muovi il serpente per mangiare la mela rossa.",
      "Ogni mela: il serpente cresce e velocizza.",
      "Controlli: swipe sull'area di gioco, d-pad o frecce tastiera.",
      "Game over se tocchi un muro o te stesso.",
    ],
    en: [
      "Move the snake to eat the red apple.",
      "Each apple makes the snake grow and speed up.",
      "Controls: swipe on the play area, D-pad, or arrow keys.",
      "Game over if you hit a wall or yourself.",
    ],
  },
  "2048": {
    title: "2048",
    it: [
      "Swipe per spostare i tile in una direzione.",
      "Due tile uguali si fondono: 2+2=4, 4+4=8...",
      "Obiettivo: arrivare a 2048.",
      "Game over se la griglia è piena e nessun movimento possibile.",
    ],
    en: [
      "Swipe to slide tiles in one direction.",
      "Two equal tiles merge: 2+2=4, 4+4=8...",
      "Goal: reach 2048.",
      "Game over when the grid is full and no move is possible.",
    ],
  },
  "minesweeper": {
    title: "Campo Minato",
    it: [
      "Tap per scoprire una cella.",
      "Il numero indica mine adiacenti.",
      "Tap lungo (o doppio tap) per piazzare bandiera.",
      "Scopri tutte le celle sicure per vincere.",
      "Tap su mina = game over.",
    ],
    en: [
      "Tap to reveal a cell.",
      "The number shows adjacent mines.",
      "Long press (or double tap) to place a flag.",
      "Reveal all safe cells to win.",
      "Tap a mine = game over.",
    ],
  },
  "sudoku": {
    title: "Sudoku",
    it: [
      "Riempi la griglia 9×9 con cifre 1-9.",
      "Ogni riga, colonna e box 3×3 deve contenere 1-9 senza ripetizioni.",
      "Tap cella → tap numero dalla pulsantiera.",
      "NOTE: modo note per piccoli appunti.",
      "3 errori = game over.",
    ],
    en: [
      "Fill the 9×9 grid with digits 1-9.",
      "Every row, column and 3×3 box must contain 1-9 with no repeats.",
      "Tap a cell → tap a number from the pad.",
      "NOTE: pencil-mark mode for small hints.",
      "3 mistakes = game over.",
    ],
  },
  "memory": {
    title: "Memory",
    it: [
      "Tap una carta per scoprirla.",
      "Tap una seconda carta: se stesso simbolo, restano aperte.",
      "Simboli diversi: le carte si richiudono dopo 1 secondo.",
      "Trova tutte le coppie con meno mosse e tempo possibile.",
    ],
    en: [
      "Tap a card to flip it.",
      "Tap a second card: if same symbol, they stay open.",
      "Different symbols: cards flip back after 1 second.",
      "Find all pairs with minimum moves and time.",
    ],
  },
  "bubble-shooter": {
    title: "Bubble Shooter",
    it: [
      "Mira con il dito sul cannone in basso.",
      "Rilascia per sparare la bolla.",
      "Gruppo di 3+ bolle stesso colore scompare.",
      "Bolle isolate dall'alto cadono (+bonus).",
      "Game over se le bolle superano la linea di fondo.",
    ],
    en: [
      "Aim with your finger on the bottom cannon.",
      "Release to shoot the bubble.",
      "Group of 3+ same-color bubbles pops.",
      "Orphan bubbles fall (+bonus points).",
      "Game over if bubbles cross the bottom line.",
    ],
  },
  "15puzzle": {
    title: "15-Puzzle",
    it: [
      "Tap una tessera adiacente allo spazio vuoto per spostarla.",
      "Riordina 1-15 da sinistra a destra, dall'alto al basso.",
      "Obiettivo: completare con meno mosse e tempo.",
    ],
    en: [
      "Tap a tile adjacent to the empty space to slide it.",
      "Arrange 1-15 left-to-right, top-to-bottom.",
      "Goal: complete with fewer moves and less time.",
    ],
  },
  "flappy": {
    title: "Tap Wing",
    it: [
      "Tap ovunque per dare un colpo d'ala.",
      "Attraversa il gap tra i tubi: +1 punto ciascuno.",
      "Tocca tubo, soffitto o terra = game over.",
    ],
    en: [
      "Tap anywhere to flap.",
      "Pass through the gap between pipes: +1 point each.",
      "Hit a pipe, ceiling or floor = game over.",
    ],
  },
  "tap-rotate": {
    title: "Tap & Rotate",
    it: [
      "Tocca un punto sullo schermo per ruotare il cannone verso quella direzione.",
      "Tap breve = spara un colpo.",
      "Tieni premuto = auto-fire a raffica dopo 400ms.",
      "Sopravvivi alle wave di nemici.",
      "Un colpo = morte.",
    ],
    en: [
      "Touch a point on screen to rotate cannon toward it.",
      "Short tap = single shot.",
      "Hold = auto-fire burst after 400ms.",
      "Survive enemy waves.",
      "One hit = death.",
    ],
  },
  "color-match-shooter": {
    title: "Hue Blaster",
    it: [
      "3 pulsanti colore in basso: tap per cambiare colore cannone.",
      "Drag sull'area di gioco per puntare + tap rilascio = spara.",
      "I proiettili colpiscono solo nemici dello stesso colore.",
      "Colore sbagliato: il proiettile passa attraverso (nessun danno).",
      "Combo kill consecutive = moltiplicatore score.",
    ],
    en: [
      "3 color buttons at bottom: tap to switch cannon color.",
      "Drag on game area to aim + release = fire.",
      "Bullets only hit enemies of matching color.",
      "Wrong color: bullet passes through (no damage).",
      "Consecutive combo kills = score multiplier.",
    ],
  },
  "chain-blast": {
    title: "Chain Blast",
    it: [
      "Hai UN tap per livello.",
      "Tap in un punto = esplosione + chain reaction.",
      "Bolle vicine alla zona esplodono e innescano altre.",
      "Più bolle esplose = più punti (scaling x1→x3).",
      "Obiettivo livello: N bolle esplose.",
    ],
    en: [
      "You have ONE tap per level.",
      "Tap a spot = explosion + chain reaction.",
      "Nearby bubbles explode and trigger more.",
      "More bubbles exploded = more points (x1→x3 scaling).",
      "Level goal: N bubbles exploded.",
    ],
  },
  "one-bullet": {
    title: "One Shot",
    it: [
      "Drag dal cannone per mirare. Rilascia per sparare.",
      "UN proiettile per livello.",
      "Rimbalza sui muri (max 12 rimbalzi).",
      "Colpisci TUTTI i target verdi per vincere.",
      "Evita hazard rossi (killano il proiettile).",
      "Pulsanti: ↺ retry · ⏮ prev · ⏭ skip",
    ],
    en: [
      "Drag from cannon to aim. Release to fire.",
      "ONE bullet per level.",
      "Bounces on walls (max 12 bounces).",
      "Hit ALL green targets to win.",
      "Avoid red hazards (they kill the bullet).",
      "Buttons: ↺ retry · ⏮ prev · ⏭ skip",
    ],
  },
  "crypt-run": {
    title: "Crypt Run",
    it: [
      "Il cavaliere corre automaticamente.",
      "Tap = salto (tieni più a lungo = salto più alto).",
      "Tap in aria = doppio salto.",
      "Swipe giù = scivolata sotto ostacoli.",
      "Attacca automaticamente nemici vicini.",
      "Un hit = game over. Scegli difficoltà in HUD.",
    ],
    en: [
      "The knight runs automatically.",
      "Tap = jump (hold longer = higher jump).",
      "Tap in air = double jump.",
      "Swipe down = slide under obstacles.",
      "Auto-attacks nearby enemies.",
      "One hit = game over. Pick difficulty in HUD.",
    ],
  },
  "brick-buster": {
    title: "Brick Buster",
    it: [
      "Drag orizzontale per muovere il paddle.",
      "Tap per lanciare la palla.",
      "Rompi tutti i mattoni per completare il livello.",
      "Angolo di rimbalzo dipende dal punto di impatto paddle.",
      "Power-ups che cadono: W wide, M multi-ball, L laser, S slow, + life.",
      "3 vite iniziali. Palla sotto paddle = vita persa.",
    ],
    en: [
      "Drag horizontally to move the paddle.",
      "Tap to launch the ball.",
      "Break all bricks to clear the level.",
      "Bounce angle depends on paddle hit point.",
      "Falling power-ups: W wide, M multi-ball, L laser, S slow, + life.",
      "3 lives. Ball past paddle = life lost.",
    ],
  },
  "gem-cascade": {
    title: "Gem Cascade",
    it: [
      "Tap una gemma + tap una gemma adiacente = scambio.",
      "3+ gemme stesso colore in riga/colonna = pop.",
      "Gemme sopra cadono, nuove entrano dall'alto.",
      "Cascata: catene multiple = moltiplicatore x1.5/x2/x3.",
      "Modalità: Time Attack 60s · Moves per livello · Endless.",
    ],
    en: [
      "Tap a gem + tap adjacent = swap.",
      "3+ same-color gems in row/col = pop.",
      "Gems fall, new ones spawn from top.",
      "Cascade chains = multiplier x1.5/x2/x3.",
      "Modes: Time Attack 60s · Moves-per-level · Endless.",
    ],
  },
  "color-flow": {
    title: "Color Flow",
    it: [
      "Tap una provetta = selezionata.",
      "Tap una seconda provetta = versa liquido dal top.",
      "Versa solo se colori top uguali (o destinazione vuota) e c'è spazio.",
      "Versa TUTTO il blocco consecutivo stesso colore.",
      "Win: ogni provetta vuota o monocolore.",
      "Undo ×3, Hint ×1 per livello.",
    ],
    en: [
      "Tap a tube = select it.",
      "Tap a second tube = pour liquid from top.",
      "Pour only if top colors match (or destination empty) and there's room.",
      "Pours the WHOLE consecutive same-color block.",
      "Win: every tube empty or mono-color.",
      "Undo ×3, Hint ×1 per level.",
    ],
  },
  "block-fit": {
    title: "Block Fit",
    it: [
      "3 forme in basso: drag su griglia 8×8.",
      "Non c'è gravità: forme si fissano dove le poggi.",
      "Riempi riga o colonna intera = clear + punti.",
      "Clear multipli insieme = combo x2/x3/x4+.",
      "Game over quando nessuna delle 3 forme correnti entra.",
    ],
    en: [
      "3 shapes at bottom: drag onto 8×8 grid.",
      "No gravity: shapes stay where placed.",
      "Fill a full row or column = clear + points.",
      "Multiple clears same drop = combo x2/x3/x4+.",
      "Game over when none of the 3 current shapes fits.",
    ],
  },
  "star-void": {
    title: "Star Void",
    it: [
      "Trascina il dito per muovere la navetta.",
      "Fuoco automatico continuo.",
      "Power-up: W (wide), L (laser), S (spread), H (homing), +1 bomba.",
      "Pulsante BOMB in basso a destra: nuke tutti proiettili + danno ai nemici.",
      "3 vite. Ogni 90s arriva un boss.",
      "Hitbox piccola: solo il centro della navetta conta.",
    ],
    en: [
      "Drag your finger to move the ship.",
      "Auto-fire continuous.",
      "Power-ups: W wide, L laser, S spread, H homing, +1 bomb.",
      "BOMB button bottom-right: nuke all bullets + damage enemies.",
      "3 lives. Boss every 90s.",
      "Tiny hitbox: only the ship core counts.",
    ],
  },
  "tris": {
    title: "Tris (Tic-Tac-Toe)",
    it: [
      "2 giocatori. P1 = X, P2 = O.",
      "Tap cella vuota per piazzare il proprio simbolo.",
      "Vince chi allinea 3 in riga, colonna o diagonale.",
      "Pareggio se griglia piena senza 3 in riga.",
      "Telefono al centro del tavolo. Banner rotato per P2.",
    ],
    en: [
      "2 players. P1 = X, P2 = O.",
      "Tap an empty cell to place your symbol.",
      "Win with 3 in a row, column or diagonal.",
      "Draw if grid fills without 3-in-a-row.",
      "Phone flat between players. Banner rotated for P2.",
    ],
  },
  "dama": {
    title: "Dama",
    it: [
      "2 giocatori, regole Dama Italiana.",
      "Tap pedina propria → mostra mosse valide (pallini arancio).",
      "Tap casella valida = muovi.",
      "Mangia saltando sopra pedina avversaria (cattura obbligatoria).",
      "Raggiungi ultima riga avversaria = diventi DAMA (movimento in 4 diagonali).",
      "Vince chi elimina tutte le pedine avversarie (o blocca).",
    ],
    en: [
      "2 players, Italian Draughts rules.",
      "Tap your piece → shows valid moves (orange dots).",
      "Tap a valid cell = move.",
      "Capture by jumping over opponent (mandatory).",
      "Reach opponent's last row = becomes KING (moves on 4 diagonals).",
      "Win by removing all opponent pieces (or blocking them).",
    ],
  },
  "connect4": {
    title: "4 in Fila",
    it: [
      "2 giocatori. P1 = giallo, P2 = rosso.",
      "Tap una colonna: il tuo disco cade fino alla prima cella libera dal basso.",
      "Vince chi allinea 4 dischi stesso colore (riga/col/diag).",
      "Pareggio se board piena senza 4-in-fila.",
      "Pallini in alto mostrano colore del turno.",
    ],
    en: [
      "2 players. P1 = yellow, P2 = red.",
      "Tap a column: your disc falls to the lowest empty cell.",
      "Win by connecting 4 same-color discs (row/col/diag).",
      "Draw if board fills without 4-in-a-row.",
      "Dots at top show current player color.",
    ],
  },
  "reaction-duel": {
    title: "Reaction",
    it: [
      "2 giocatori, schermo diviso orizzontalmente.",
      "Aspetta che il tuo lato diventi VERDE, poi tap più veloce possibile.",
      "Tap durante fase ROSSA = falsa partenza (avversario vince round).",
      "Vince chi arriva a 3 round per primo.",
    ],
    en: [
      "2 players, screen split horizontally.",
      "Wait for your side to turn GREEN, then tap as fast as possible.",
      "Tap during RED phase = false start (opponent wins round).",
      "First to 3 rounds wins the match.",
    ],
  },
  "tap-race": {
    title: "Tap Race",
    it: [
      "2 giocatori, schermo diviso.",
      "Dopo countdown 3-2-1-GO, tap il più veloce possibile sulla tua metà per 10 secondi.",
      "Chi ha più tap a fine round vince 1 punto.",
      "Best of 3: primo a 2 vince il match.",
    ],
    en: [
      "2 players, split screen.",
      "After 3-2-1-GO countdown, tap as fast as possible on your half for 10s.",
      "More taps at end of round = +1 point.",
      "Best of 3: first to 2 wins the match.",
    ],
  },
  "chain-reaction": {
    title: "Chain Reaction",
    it: [
      "2 giocatori, board 6×9. P1 blu, P2 rosso.",
      "Tap cella vuota OR con tuoi orbs = aggiungi 1 orb tuo.",
      "Ogni cella ha capacità: angolo=2, bordo=3, interno=4.",
      "Cella satura ESPLODE: +1 orb a ciascuno dei 4 vicini.",
      "Vicini conquistati: i loro orbs diventano tuoi.",
      "Esplosioni concatenate = reazioni a catena epiche.",
      "Vince chi fa sparire TUTTI gli orbs dell'avversario.",
      "(Primo turno di P2 non conta per il win check.)",
    ],
    en: [
      "2 players, 6×9 board. P1 blue, P2 red.",
      "Tap empty cell OR cell with your orbs = add 1 orb.",
      "Each cell has capacity: corner=2, edge=3, inner=4.",
      "Saturated cell EXPLODES: +1 orb to each of 4 neighbors.",
      "Conquered neighbors: their orbs become yours.",
      "Chained explosions = epic cascade reactions.",
      "Win by wiping out ALL opponent's orbs.",
      "(P2's first turn doesn't count for win check.)",
    ],
  },
};

export function getInstructions(gameId: string): GameInstructions | null {
  return INSTRUCTIONS[gameId] ?? null;
}

export function hasInstructions(gameId: string): boolean {
  return gameId in INSTRUCTIONS;
}
