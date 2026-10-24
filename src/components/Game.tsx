"use client";

import { useEffect, useRef } from "react";
import type { GameHandle } from "@/game/game";

export default function Game() {
  const bootedRef = useRef(false);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    let handle: GameHandle | null = null;
    let cancelled = false;

    import("@/game/game").then(({ createGame }) => {
      if (cancelled) return;
      handle = createGame();
    });

    return () => {
      cancelled = true;
      handle?.dispose();
      bootedRef.current = false;
    };
  }, []);

  return (
    <>
      <canvas id="c" />

      <div id="hud" className="hidden">
        <div id="modeBox">
          <span id="modeTxt">A PIE</span>
          <span id="clock">09:30</span>
        </div>
        <div id="topBtns">
          <button id="btnPause">⏸ Pausa (P)</button>
          <button id="btnRestart">↺ Reiniciar</button>
        </div>
        <div id="prompt" />
        <div id="toast" />
        <canvas id="mini" width={180} height={180} />
        <div id="speedo">
          <div id="spdNum">0</div>
          <div className="u">
            KM/H · <span id="spdGear">1</span>
          </div>
          <div id="spdBar">
            <i id="spdFill" />
          </div>
        </div>

        <div id="healthBox">
          <div id="healthLabel">
            <span>Vida</span>
            <span id="healthNum">100</span>
          </div>
          <div id="healthBarBg">
            <i id="healthBarFill" />
          </div>
        </div>
        <div id="damageVignette" />

        <div id="crosshair">
          <i />
          <i />
          <i />
          <i />
        </div>
        <div id="hitMarker">✕</div>
        <div id="ammoBox">
          <div id="weaponName">Puños</div>
          <div id="ammoCount">— / —</div>
          <div id="reloadIndicator">Recargando…</div>
        </div>
        <div id="killFeed" />
        <div id="scoreboard">
          <table>
            <thead>
              <tr>
                <th>Jugador</th>
                <th>Bajas</th>
                <th>Muertes</th>
                <th>Ping</th>
              </tr>
            </thead>
            <tbody id="scoreboardBody" />
          </table>
        </div>
        <div id="deathOverlay">
          <h2>HAS MUERTO</h2>
          <div className="killer" id="killerText" />
          <div className="countdown" id="respawnCountdown" />
        </div>
      </div>

      <div id="start" className="overlay">
        <h1>Ciudad Abierta</h1>
        <p className="sub">Camina, conduce y explora el Campus de El Carmen (Universidad de Huelva) a tu aire</p>
        <input id="nameInput" className="nameInput" type="text" placeholder="Tu nombre" maxLength={16} />
        <div className="charLabel">Elige tu personaje · <kbd>←</kbd> <kbd>→</kbd></div>
        <div className="charPicker">
          <button className="charPrev" aria-label="Personaje anterior" disabled>
            ‹
          </button>
          <div className="charStage">
            <div className="charName">Cargando…</div>
          </div>
          <button className="charNext" aria-label="Personaje siguiente" disabled>
            ›
          </button>
        </div>
        <button id="btnPlay" className="big">
          Jugar
        </button>
        <div id="serverStatus" className="serverStatus">
          Conectando…
        </div>
        <div className="ctrls">
          <div className="card">
            <b>A pie</b>
            <kbd>W</kbd>
            <kbd>A</kbd>
            <kbd>S</kbd>
            <kbd>D</kbd> moverse
            <br />
            <kbd>Shift</kbd> correr · <kbd>Espacio</kbd> saltar
            <br />
            <kbd>Ratón</kbd> cámara
            <br />
            <kbd>E</kbd> entrar en un coche
          </div>
          <div className="card">
            <b>Conduciendo</b>
            <kbd>W</kbd> acelerar · <kbd>S</kbd> frenar / marcha atrás
            <br />
            <kbd>A</kbd>
            <kbd>D</kbd> girar
            <br />
            <kbd>Espacio</kbd> freno de mano
            <br />
            <kbd>H</kbd> claxon · <kbd>E</kbd> salir
            <br />
            Mantén <kbd>H</kbd> sirena (policía)
            <br />
            <kbd>Ratón</kbd> mirar alrededor
          </div>
          <div className="card">
            <b>Combate</b>
            <kbd>1</kbd>
            <kbd>2</kbd>
            <kbd>3</kbd> / <kbd>Q</kbd> arma
            <br />
            Click izq. disparar · Click der. apuntar
            <br />
            <kbd>R</kbd> recargar · <kbd>Tab</kbd> marcador
          </div>
          <div className="card">
            <b>General</b>
            <kbd>P</kbd> / <kbd>Esc</kbd> pausa
            <br />
            <kbd>N</kbd> avanzar 6 horas (día/noche)
            <br />
            Botón «Reiniciar» en pantalla
          </div>
        </div>
        <p className="note">
          Al jugar, el ratón queda capturado; pulsa Esc para liberarlo y pausar. Si no hay servidor disponible, se juega en modo un jugador.
        </p>
        <p id="err" className="err" />
        <p className="attribution">
          Mapa: © colaboradores de OpenStreetMap (ODbL) · Relieve: © Instituto Geográfico Nacional (CC BY 4.0) · Modelos 3D: Quaternius (CC0)
        </p>
      </div>

      <div id="pause" className="overlay hidden">
        <h2>Pausa</h2>
        <div className="charLabel">Cambiar personaje</div>
        <div className="charPicker">
          <button className="charPrev" aria-label="Personaje anterior" disabled>
            ‹
          </button>
          <div className="charStage">
            <div className="charName">Cargando…</div>
          </div>
          <button className="charNext" aria-label="Personaje siguiente" disabled>
            ›
          </button>
        </div>
        <div className="btnrow">
          <button id="btnResume" className="big">
            Reanudar
          </button>
        </div>
        <div className="btnrow">
          <button id="btnRestart2">↺ Reiniciar partida</button>
          <button id="btnSound">🔊 Sonido: sí</button>
        </div>
        <div className="ctrls">
          <div className="card">
            <b>A pie</b>
            <kbd>WASD</kbd> moverse · <kbd>Shift</kbd> correr · <kbd>Espacio</kbd> saltar
            <br />
            <kbd>E</kbd> entrar en coche
          </div>
          <div className="card">
            <b>Conduciendo</b>
            <kbd>W</kbd> acelerar · <kbd>S</kbd> frenar/atrás · <kbd>A</kbd>
            <kbd>D</kbd> girar
            <br />
            <kbd>Espacio</kbd> freno de mano · <kbd>H</kbd> claxon · <kbd>E</kbd> salir
            <br />
            Mantén <kbd>H</kbd> sirena (policía)
          </div>
        </div>
      </div>
    </>
  );
}
