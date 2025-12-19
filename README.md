# Poker Table (Texas Hold'em sin cartas) — dinero ficticio

Esto NO gestiona cartas. Es un **gestor de mesa** para que tú lleves las cartas en la vida real y cada jugador apueste desde el móvil.

## Requisitos
- Node.js 18+ recomendado (vale 16+ si tu entorno es estable).
- Todos los móviles y el ordenador deben estar en la **misma red WiFi** (o red local accesible).

## Cómo arrancar (paso a paso)

1) Abre una terminal en la carpeta `server` e instala dependencias:
```bash
cd server
npm install
```

2) Arranca el servidor:
```bash
npm start
```

3) Verás algo como:
- Local:   http://localhost:3000
- Network: http://<TU_IP_LOCAL>:3000

4) Abre la web desde el ordenador o desde el móvil:
- En el **ordenador**: http://localhost:3000
- En cada **móvil** (misma WiFi): http://TU_IP_LOCAL:3000

### Cómo saber tu IP local
- Windows: abre CMD y ejecuta `ipconfig` → busca “IPv4 Address”.
- macOS: Ajustes → Red → Wi‑Fi → Detalles (o en terminal `ipconfig getifaddr en0`)
- Linux: `hostname -I` o `ip a`

## Uso
1) Cada jugador entra con su nombre.
2) El jugador llamado **jolupa** ve el panel admin:
   - Límite por acción (cap de incremento por apuesta/raise)
   - Stack inicial
   - Ciega pequeña (BB = 2x)
3) jolupa pulsa **Iniciar mano**:
   - Se cobran ciegas automáticamente
   - Se asigna turno automáticamente
4) Los jugadores juegan su acción en su turno:
   - Fold
   - Check/Call
   - Bet/Raise (envías el TOTAL que quieres llevar apostado en la ronda)
5) Al final de la mano, jolupa asigna el ganador y el servidor le entrega el pozo.

## Notas
- Estado en memoria: si reinicias el servidor se pierde la mesa.
- No hay side pots complejos. All‑in se permite como “no puede cubrir más”.

## Problemas típicos
- **Desde el móvil no carga**: asegúrate de usar la IP del ordenador (no localhost) y que firewall permita el puerto 3000.
- **Misma red**: confirma que móvil y ordenador están en la misma WiFi.
