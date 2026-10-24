# Ciudad Abierta

Un juego de tipo GTA en el navegador: camina, conduce y dispara en una ciudad
procedural generada con `three.js`, ahora con multijugador online, sistema de
vida y dos armas (pistola y rifle M4). Construido con Next.js (App Router) y
TypeScript.

## Requisitos

- Node.js 20 o superior

## Instalación

```bash
npm install
```

## Ejecutar en desarrollo

```bash
npm run dev
```

Esto levanta a la vez:

- el cliente Next.js en `http://localhost:3000`
- el servidor WebSocket de multijugador en el puerto `3001`

Abrí `http://localhost:3000` en el navegador y pulsá **Jugar**.

## Jugar con amigos en la LAN

1. Arrancá el proyecto con `npm run dev` en tu máquina.
2. Buscá tu IP local (por ejemplo `ip addr` o `ipconfig`).
3. Tus amigos, en la misma red, abren `http://<tu-ip>:3000` desde su navegador.
4. Cada cliente se conecta automáticamente al servidor WebSocket en
   `ws://<tu-ip>:3001` (se puede fijar explícitamente con la variable de
   entorno `NEXT_PUBLIC_WS_URL`).
5. Si el servidor no está disponible, el juego se sigue jugando igual en modo
   un jugador (sin conexión).

## Controles

| Acción | Tecla |
|---|---|
| Moverse | `W` `A` `S` `D` |
| Correr | `Shift` |
| Saltar | `Espacio` |
| Cámara | Ratón |
| Entrar/salir de un coche | `E` |
| Acelerar / Frenar / Marcha atrás | `W` / `S` (en coche) |
| Girar | `A` `D` (en coche) |
| Freno de mano | `Espacio` (en coche) |
| Claxon | `H` |
| Sirena y luces (coche de policía) | `H` (mantener) |
| Cambiar de arma | `1` puños · `2` pistola · `3` rifle M4 · `Q` siguiente |
| Disparar | Click izquierdo |
| Apuntar | Click derecho |
| Recargar | `R` |
| Marcador de jugadores | `Tab` (mantener) |
| Pausa | `P` / `Esc` |
| Avanzar 6 horas (día/noche) | `N` |

## Estructura del proyecto

```
src/app/            layout, página y estilos globales (Next.js App Router)
src/components/      Game.tsx — HUD/overlay y arranque del motor
src/game/
  core/              utilidades matemáticas, RNG con semilla, constantes del mundo
  world/              colisiones, suelo/calles, edificios, mobiliario urbano,
                       semáforos, entorno (cielo/día-noche), minimapa
  vehicles/           tipos de vehículo, mallas, física del coche del jugador, IA de tráfico
  pedestrians/        peatones (paseo, huida, caída al recibir un disparo)
  player/             mesh humano, física a pie, entrar/salir de vehículos, estado del jugador
  camera/             cámara en tercera persona / sobre el hombro al apuntar
  audio/               motor de sonido WebAudio (motor, bocina, impactos)
  combat/             armas, vida, efectos visuales/sonoros, raycasting, mallas de armas
  net/                 cliente WebSocket, interpolación de snapshots, jugadores remotos
  hud/                controlador del HUD
  game.ts             bucle principal y cableado de todos los sistemas
shared/protocol.ts    contrato de red compartido con el servidor (no se modifica aquí)
server/               servidor WebSocket autoritativo (desarrollado aparte)
```

## Notas

- El tráfico y los peatones son locales a cada cliente (no están sincronizados
  por red); solo los jugadores reales se sincronizan entre clientes.
- La ciudad se genera con una semilla fija (1337), así que todos los clientes
  construyen exactamente el mismo mapa.
- El servidor es autoritativo para la vida: el daño por disparos de otros
  jugadores solo se aplica cuando el servidor lo confirma.
