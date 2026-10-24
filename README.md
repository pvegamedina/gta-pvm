# Ciudad Abierta

Un juego de tipo GTA en el navegador: camina, conduce y dispara por una
recreación jugable del **Campus de El Carmen de la Universidad de Huelva**
(relieve, calles, edificios y árboles reales) construida con `three.js`, con
multijugador online, sistema de vida y dos armas (pistola y rifle M4).
Construido con Next.js (App Router) y TypeScript.

## El mapa: Campus de El Carmen

El mundo se genera a partir de un único fichero de datos,
`public/maps/campus-el-carmen.json`, producido sin conexión por
`npm run map:build` (`scripts/map/`) a partir de OpenStreetMap y del modelo
digital del terreno MDT05 del IGN. Cubre unos 1,2 × 1,3 km alrededor del campus
(x = este, z = sur, en metros):

- **Relieve real**: malla de alturas cada 4 m (de 3 a 32 m), con el cerro del
  Cabezo de la Almagra al noroeste; todo (jugador, coches, peatones, cámara,
  balas, casquillos y cadáveres con física) se apoya en ese terreno.
- **Calles**: cintas de asfalto adaptadas al terreno con marcas viales, cruces,
  aceras con bordillo, caminos peatonales, pasos de cebra y los viaductos de la
  autovía elevados sobre pilares.
- **Edificios**: las 125 plantas reales extruidas con su altura, fachadas con
  ventanas por planta, azotea con pretil y colisiones con su forma exacta.
- **Vegetación**: los 766 árboles mapeados (palmeras, pinos, frondosos y
  arbustos) más hierba, flores y rocas en parques y céspedes.
- **Tráfico y peatones**: los coches circulan por el grafo de calles real
  (sentido único, cruces sin cambios de sentido, semáforos en las 58
  intersecciones reguladas) y los peatones pasean por aceras y caminos.
- El servidor lee los puntos de aparición del mismo fichero.

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
  core/              utilidades matemáticas y constantes del motor
  map/               esquema, carga y consultas del fichero del mapa (cliente y servidor)
  world/             colisiones, altura del suelo, semáforos, entorno (cielo/día-noche),
                       minimapa
  world/campus/      construcción del campus: terreno, calles, edificios, agua, vegetación
  vehicles/           tipos de vehículo, mallas, física del coche del jugador, red de
                       carriles y IA de tráfico sobre el grafo de calles
  pedestrians/        peatones sobre el grafo peatonal (paseo, huida, caída)
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
- Todos los clientes construyen exactamente el mismo campus a partir del mismo
  fichero de mapa; la variación de la vegetación sale de un hash estable de la
  posición de cada árbol.
- El servidor es autoritativo para la vida: el daño por disparos de otros
  jugadores solo se aplica cuando el servidor lo confirma.

## Créditos y licencias

- Datos del mapa: © colaboradores de OpenStreetMap, disponibles bajo la licencia
  Open Database License (ODbL).
- Relieve: MDT05, © Instituto Geográfico Nacional (CC BY 4.0).
- Modelos 3D (personajes, armas, vehículos, naturaleza y edificios): Quaternius (CC0).
