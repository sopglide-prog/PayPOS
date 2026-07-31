// =====================================================
//  Juego Llama — Piso infinito + llama jugadora
// =====================================================

// ── Mini-cliente Supabase (sin paquetes, solo fetch) ──────────────────────────
function createClient(url, key) {
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };

  function buildUrl(table, filters, extra) {
    const params = [];
    filters.forEach(([col, val]) => params.push(`${col}=eq.${encodeURIComponent(val)}`));
    if (extra) params.push(extra);
    return `${url}/rest/v1/${table}${params.length ? '?' + params.join('&') : ''}`;
  }

  function from(table) {
    let _selectCols = '*';
    let _filters    = [];
    let _method     = 'GET';
    let _body       = null;

    const chain = {
      select(cols) { _selectCols = cols; return chain; },
      eq(col, val) { _filters.push([col, val]); return chain; },
      update(data) { _method = 'PATCH'; _body = data; return chain; },
      insert(data) { _method = 'POST';  _body = Array.isArray(data) ? data : [data]; return chain; },

      // Terminal: .maybeSingle() → devuelve { data, error }
      async maybeSingle() {
        const reqUrl = buildUrl(table, _filters, `select=${encodeURIComponent(_selectCols)}&limit=1`);
        try {
          const res = await fetch(reqUrl, { method: 'GET', headers });
          if (!res.ok) return { data: null, error: await res.json().catch(() => ({ message: res.statusText })) };
          const arr = await res.json();
          return { data: arr[0] ?? null, error: null };
        } catch (e) { return { data: null, error: { message: e.message } }; }
      },

      // Hace la chain "awaitable" para update/insert sin terminal explícito
      then(resolve, reject) {
        const reqUrl = buildUrl(table, _filters);
        fetch(reqUrl, { method: _method, headers, body: _body ? JSON.stringify(_body) : undefined })
          .then(async res => {
            if (res.status === 204) return resolve({ data: null, error: null });
            const body = await res.json().catch(() => null);
            return resolve(res.ok ? { data: body, error: null } : { data: null, error: body });
          })
          .catch(reject);
      },
    };
    return chain;
  }

  return { from };
}
// ─────────────────────────────────────────────────────────────────────────────

const supabase = createClient(
  'https://vxtefnajeqwwditdwwcs.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4dGVmbmFqZXF3d2RpdGR3d2NzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0Mzc5MjEsImV4cCI6MjA4NDAxMzkyMX0.HFURBIenpBqaqkiF-CGsdBoTTqhdqFznDU8ntITnIWY'
);

// Guarda/acumula resultado por jugador en Supabase.
// Tabla "partidas" necesita columnas: nombre (text, unique), gano (int), perdio (int), monedas_total (int)
async function guardarPartida(nombre, monedas, resultado) {
  try {
    // Buscar fila existente para este jugador
    const { data: fila } = await supabase
      .from('partidas')
      .select('gano, perdio, monedas_total')
      .eq('nombre', nombre)
      .maybeSingle();

    if (fila) {
      // Jugador ya existe → incrementar contadores
      const { error } = await supabase.from('partidas').update({
        gano:          (fila.gano          || 0) + (resultado === 'gano'   ? 1 : 0),
        perdio:        (fila.perdio        || 0) + (resultado === 'perdio' ? 1 : 0),
        monedas_total: (fila.monedas_total || 0) + (monedas  || 0),
      }).eq('nombre', nombre);
      if (error) console.warn('Supabase update error:', error.message);
    } else {
      // Jugador nuevo → crear fila
      const { error } = await supabase.from('partidas').insert([{
        nombre,
        gano:          resultado === 'gano'   ? 1 : 0,
        perdio:        resultado === 'perdio' ? 1 : 0,
        monedas_total: monedas || 0,
      }]);
      if (error) console.warn('Supabase insert error:', error.message);
    }
  } catch (e) {
    console.warn('No se pudo guardar la partida:', e);
  }
}

// ─────────────────────────────────────────────────────
//  NameScene — Pantalla de ingreso de nombre
// ─────────────────────────────────────────────────────
class NameScene extends Phaser.Scene {
  constructor() { super({ key: 'NameScene' }); }

  create() {
    // Inyectar fuente retro si no está aún
    if (!document.getElementById('press-start-font')) {
      const lnk = document.createElement('link');
      lnk.id   = 'press-start-font';
      lnk.rel  = 'stylesheet';
      lnk.href = 'https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap';
      document.head.appendChild(lnk);
    }

    // ─── Overlay de pantalla completa (position:fixed para iOS) ───
    const screen = document.createElement('div');
    screen.id = 'name-screen';
    screen.style.cssText = `
      position: fixed;
      inset: 0;
      background: #0d0d1a;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      font-family: "Press Start 2P", "Courier New", monospace;
      padding: 16px;
      box-sizing: border-box;
    `;

    // ─── Caja modal retro ─────────────────────────────────────────
    const modal = document.createElement('div');
    modal.style.cssText = `
      background: #12122a;
      border: 4px solid #FFD700;
      box-shadow: 0 0 0 2px #0d0d1a, 0 0 0 6px #FFD700, 8px 8px 0 #000;
      padding: 28px 28px 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
      width: 100%;
      max-width: 320px;
      box-sizing: border-box;
    `;

    // Título
    const title = document.createElement('div');
    title.style.cssText = `
      font-size: 16px;
      color: #FFD700;
      text-align: center;
      line-height: 1.8;
      text-shadow: 2px 2px 0 #888;
      letter-spacing: 1px;
    `;
    title.innerHTML = 'GRAN PODER<br>AL ESTILO PACHA';

    // Separador pixel
    const sep = document.createElement('div');
    sep.style.cssText = `
      width: 100%;
      height: 3px;
      background: repeating-linear-gradient(90deg, #FFD700 0px, #FFD700 6px, transparent 6px, transparent 10px);
    `;

    // Label
    const label = document.createElement('div');
    label.style.cssText = `
      font-size: 8px;
      color: #aaa;
      letter-spacing: 1px;
      text-align: center;
    `;
    label.textContent = 'INGRESA TU NOMBRE';

    // ─── Wrapper relativo para el dropdown ───────────────────────
    const inputWrapper = document.createElement('div');
    inputWrapper.style.cssText = 'position: relative; width: 100%;';

    // Input  (font-size ≥ 16px evita zoom automático en iOS Safari)
    const input = document.createElement('input');
    input.type        = 'text';
    input.maxLength   = 16;
    input.placeholder = 'Tu nombre...';
    input.autocomplete = 'off';
    input.autocorrect  = 'off';
    input.autocapitalize = 'characters';
    input.spellcheck   = false;
    input.style.cssText = `
      font-family: "Press Start 2P", "Courier New", monospace;
      font-size: 16px;
      padding: 12px 10px;
      border: 3px solid #FFD700;
      background: #06060f;
      color: #FFD700;
      text-align: center;
      outline: none;
      width: 100%;
      box-sizing: border-box;
      caret-color: #FFD700;
      letter-spacing: 2px;
      -webkit-appearance: none;
      border-radius: 0;
    `;

    // ─── Dropdown de autocompletado (solo nombres de ESTE dispositivo) ──
    const dropdown = document.createElement('div');
    dropdown.style.cssText = `
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      background: #06060f;
      border: 3px solid #FFD700;
      border-top: none;
      z-index: 10001;
      display: none;
      max-height: 160px;
      overflow-y: auto;
      box-sizing: border-box;
    `;

    // Nombres guardados localmente en este dispositivo
    const nombresLocales = JSON.parse(localStorage.getItem('jugador_nombres') || '[]');

    const mostrarDropdown = () => {
      const val = input.value.trim().toUpperCase();
      dropdown.innerHTML = '';
      const matches = val
        ? nombresLocales.filter(n => n.toUpperCase().startsWith(val))
        : nombresLocales;
      if (matches.length === 0) { dropdown.style.display = 'none'; return; }
      matches.forEach(name => {
        const item = document.createElement('div');
        item.textContent = name;
        item.style.cssText = `
          padding: 13px 14px;
          font-family: "Press Start 2P", "Courier New", monospace;
          font-size: 13px;
          color: #FFD700;
          cursor: pointer;
          border-bottom: 1px solid #222;
          text-align: left;
          letter-spacing: 1px;
        `;
        item.addEventListener('pointerover', () => { item.style.background = '#1a1a3a'; });
        item.addEventListener('pointerout',  () => { item.style.background = 'transparent'; });
        item.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          input.value = name;
          dropdown.style.display = 'none';
        });
        dropdown.appendChild(item);
      });
      dropdown.style.display = 'block';
    };

    // El input arranca siempre vacío — la sugerencia aparece al tocar
    input.addEventListener('input',  mostrarDropdown);
    input.addEventListener('focus',  mostrarDropdown);
    input.addEventListener('blur',   () => setTimeout(() => { dropdown.style.display = 'none'; }, 200));

    inputWrapper.appendChild(input);
    inputWrapper.appendChild(dropdown);

    // Botón
    const btn = document.createElement('button');
    btn.textContent = '▶  JUGAR';
    btn.style.cssText = `
      font-family: "Press Start 2P", "Courier New", monospace;
      font-size: 13px;
      padding: 14px 0;
      width: 100%;
      background: #FFD700;
      color: #000;
      border: none;
      cursor: pointer;
      letter-spacing: 1px;
      box-shadow: 4px 4px 0 #a08000;
      -webkit-appearance: none;
      border-radius: 0;
      transition: transform 0.07s, box-shadow 0.07s;
    `;
    btn.addEventListener('pointerdown', () => {
      btn.style.transform  = 'translate(3px, 3px)';
      btn.style.boxShadow  = '1px 1px 0 #a08000';
    });
    btn.addEventListener('pointerup',   () => {
      btn.style.transform  = '';
      btn.style.boxShadow  = '4px 4px 0 #a08000';
    });

    modal.appendChild(title);
    modal.appendChild(sep);
    modal.appendChild(label);
    modal.appendChild(inputWrapper);
    modal.appendChild(btn);
    screen.appendChild(modal);
    document.body.appendChild(screen);

    // Enfocar después de un tick (iOS necesita el pequeño delay)
    setTimeout(() => input.focus(), 100);

    const confirmar = () => {
      const nombre = input.value.trim() || 'Anónimo';
      // Guardar en lista local de este dispositivo (máx 10 nombres)
      const lista = JSON.parse(localStorage.getItem('jugador_nombres') || '[]');
      if (!lista.includes(nombre)) { lista.unshift(nombre); }
      localStorage.setItem('jugador_nombres', JSON.stringify(lista.slice(0, 10)));
      this.registry.set('nombreJugador', nombre);
      screen.remove();
      this.scene.start('GameScene');
    };

    btn.addEventListener('click', confirmar);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); confirmar(); }
    });
  }
}

const W           = 800;
const H           = 500;
const WORLD_W     = 8700;
const PISO_H      = 64;           // alto del piso en pantalla
const GROUND_Y    = H - PISO_H;   // y donde comienza el tope del piso
const LLAMA_SCALE       = 0.09;  // escala normal (después de comer moneda)
const LLAMA_SCALE_SMALL = 0.05;  // escala inicial (llama pequeña)
const LLAMA_SCALE_CAPA  = 0.12;  // escala capa (después de comer flor)

// Enemigo "goomba" (el personaje del traje/lentes que subiste)
const GOOMBA_SCALE = 0.10;
const GOOMBA_SPEED  = 70;

// Banda visible de piso.png (1536×1024): contenido en cols 234-1504, filas 408-558
const SRC_X = 234;
const SRC_Y = 408;
const SRC_W = 1057;   // hasta col 1291 del original, excluye la zona vacía al final
const SRC_H = 150;

// ─────────────────────────────────────────────────────
//  PreloadScene
// ─────────────────────────────────────────────────────
class PreloadScene extends Phaser.Scene {
  constructor() { super({ key: 'PreloadScene' }); }

  preload() {
    this.cameras.main.setBackgroundColor('#000000');
    const cx = W / 2, cy = H / 2;
    this.add.rectangle(cx, cy, 420, 8, 0x333333);
    const bar = this.add.rectangle(cx - 200, cy, 0, 6, 0xF5E8B0).setOrigin(0, 0.5);
    this.load.on('progress', v => { bar.width = 400 * v; });
    // Ignorar errores de assets opcionales para no crashear
    this.load.on('loaderror', (file) => {
      console.warn('[preload] asset no encontrado:', file.key);
    });

    // Sprites de la llama — forma normal
    this.load.atlas('llama', 'spritesheet.png', 'spritesheet.json');
    this.load.atlas('jump',  'jump.png',        'jump.json');
    this.load.atlas('idle',  'idle.png',        'idle.json');
    // Sprites de la llama — forma CAPA (fondo transparente, no necesitan _removeBackground)
    this.load.atlas('quietocapa',  'quietocapa.png',  'quietocapa.json');
    this.load.atlas('caminocapa',  'caminocapa.png',  'caminocapa.json');
    this.load.atlas('saltocapa',   'saltocapa.png',   'saltocapa.json');
    // Power-up: flor de fuego (imagen estática)
    this.load.image('flordefuego', 'flordefuego.png');
    this.load.image('misil',       'misil.png');
    this.load.image('suelooriginal', 'suelooriginal.jpg');
    this.load.image('ladrillo', 'ladrillo.png');
    this.load.image('nube', 'nubes.png');
    this.load.image('tubo', 'po.png');

    // Enemigo "honguito malo"
    this.load.atlas('goomba', 'honguitomalo.png', 'honguitomalo.json');
    // Tiles para escaleras (ya tienen fondo transparente, no se necesita procesar)
    this.load.image('tile_block', 'tiles.png');
    this.load.image('lava', 'lava.png');
    this.load.image('roca', 'roca.png');
    this.load.image('puente', 'puente.png');
    this.load.image('aniversario', 'aniversario.png');
    this.load.image('castillo',   'castillo.png');
    this.load.audio('completado', 'completado.mp3');

    // Elefante del puente final
    this.load.atlas('elefante_camino', 'camino.png', 'camino.json');
    this.load.atlas('elefante_salto',  'salto.png',  'salto.json');

    // Moneda animada (sprite sheet + JSON ya con fondo transparente)
    this.load.atlas('moneda', 'moneda.png', 'moneda.json');

    // Sonidos
    this.load.audio('sonido_salto',  'saltosonido.mp3');
    this.load.audio('sonido_moneda', 'monedasonido.mp3');
    // musica_fondo: intentar cargar, si falla el loaderror lo silencia
    this.load.audio('musica_fondo',  'supermariobros.mp3');
  }

  create() { this.scene.start('NameScene'); }
}

// ─────────────────────────────────────────────────────
//  TitleScene  — pantalla de título con aniversario.png
// ─────────────────────────────────────────────────────
class TitleScene extends Phaser.Scene {
  constructor() { super({ key: 'TitleScene' }); }

  create() {
    // No borrar el canvas antes de renderizar → el mundo de GameScene queda visible
    this.cameras.main.clearBeforeRender = false;
    this.cameras.main.setBackgroundColor('rgba(0,0,0,0)');

    // Imagen centrada como logo/cartel — no ocupa toda la pantalla
    const imgW = Math.round(W * 0.56);
    const imgH = Math.round(imgW * (1024 / 1536));       // mantiene proporción 3:2
    this.add.image(W / 2, H / 2 - 22, 'aniversario')
      .setDisplaySize(imgW, imgH);

    // Franja oscura debajo de la imagen para las opciones
    this.add.rectangle(W / 2, H - 52, W, 80, 0x000000, 0.70);

    const PF = '"Press Start 2P", "Courier New", monospace';

    const opt1 = this.add.text(W / 2, H - 74,
      'GÁNATE UNA MESA TRIVIA',
      { fontFamily: PF, fontSize: '10px', color: '#ffffff', stroke: '#000', strokeThickness: 3 }
    ).setOrigin(0.5).setInteractive({ useHandCursor: true });

    const opt2 = this.add.text(W / 2, H - 44,
      'JUGAR DEMO',
      { fontFamily: PF, fontSize: '13px', color: '#FFD700', stroke: '#000', strokeThickness: 3 }
    ).setOrigin(0.5).setInteractive({ useHandCursor: true });

    // Cursor parpadeante junto a opt2
    const arrow = this.add.text(opt2.x - opt2.width / 2 - 18, H - 44, '▶',
      { fontFamily: PF, fontSize: '12px', color: '#FFD700' }
    ).setOrigin(0.5);
    this.tweens.add({ targets: arrow, alpha: 0, duration: 380, yoyo: true, repeat: -1 });

    // Hover en opt1
    opt1.on('pointerover',  () => opt1.setColor('#FFD700'));
    opt1.on('pointerout',   () => opt1.setColor('#ffffff'));

    const start = () => {
      this.input.keyboard.removeAllListeners();
      this.scene.stop('TitleScene'); // GameScene ya corre de fondo
    };
    opt1.on('pointerdown', start);
    opt2.on('pointerdown', start);
    this.input.keyboard.on('keydown', start);
  }
}

// ─────────────────────────────────────────────────────
//  GameScene
// ─────────────────────────────────────────────────────
class GameScene extends Phaser.Scene {
  constructor() { super({ key: 'GameScene' }); }

  // Elimina el fondo de color de un atlas usando "flood fill" desde los
  // bordes de la imagen: solo se vuelve transparente el fondo que está
  // REALMENTE conectado al borde. Así no se borran partes del propio
  // personaje que compartan el mismo color (p. ej. un traje negro sobre
  // fondo negro), porque quedan encerradas por otros colores (piel, etc.)
  // y nunca se conectan con el borde de la imagen.
  _removeBackground(key) {
    // Si ya fue procesada (es canvas texture), no volver a correr el flood-fill.
    // En un restart de escena las texturas persisten en el TextureManager global,
    // y una segunda pasada haría transparentes los bordes negros del sprite.
    const existing = this.textures.get(key);
    if (existing && existing.source && existing.source[0] && existing.source[0].isCanvas) return;
    const atlas = this.textures.get(key);
    const src   = atlas.getSourceImage();
    const oc    = document.createElement('canvas');
    const W = oc.width  = src.width;
    const H = oc.height = src.height;
    const ctx   = oc.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0);

    const id = ctx.getImageData(0, 0, W, H);
    const d  = id.data;
    const tol = 40;

    // Color de fondo: NO se puede asumir que sea el píxel (0,0) del lienzo
    // completo (puede ser una esquina vacía/transparente rara). En cambio,
    // muestreamos una esquina de cada frame real y usamos el color que más
    // se repite — ese es el relleno de fondo real usado en todo el atlas.
    const frameEntries = Object.entries(atlas.frames).filter(([n]) => n !== '__BASE');
    const sameColor = (a, b) =>
      Math.abs(a[0]-b[0]) < tol && Math.abs(a[1]-b[1]) < tol && Math.abs(a[2]-b[2]) < tol;
    const samples = (frameEntries.length ? frameEntries : [[null, { cutX: 1, cutY: 1 }]])
      .map(([, f]) => ctx.getImageData(
        Math.min((f.cutX ?? 0) + 2, W - 1),
        Math.min((f.cutY ?? 0) + 2, H - 1),
        1, 1
      ).data);
    let best = samples[0], bestCount = 0;
    for (const s of samples) {
      const c = samples.filter(o => sameColor(s, o)).length;
      if (c > bestCount) { best = s; bestCount = c; }
    }
    const [bgR, bgG, bgB] = best;
    // Un píxel cuenta como "fondo" si ya es transparente (alpha 0 — típico
    // en el borde exterior de la imagen) o si su color se parece al color
    // de fondo muestreado. Incluir los ya-transparentes es clave: si no,
    // el flood fill nunca puede "entrar" desde ese borde y el fondo entero
    // se queda opaco (se ve como un recuadro sólido alrededor del sprite).
    const isBg = (i) =>
      d[i + 3] === 0 ||
      (Math.abs(d[i] - bgR) < tol && Math.abs(d[i + 1] - bgG) < tol && Math.abs(d[i + 2] - bgB) < tol);

    const visited = new Uint8Array(W * H);
    const stack = [];
    const pushIfBg = (x, y) => {
      if (x < 0 || x >= W || y < 0 || y >= H) return;
      const p = y * W + x;
      if (visited[p]) return;
      if (!isBg(p * 4)) return;
      visited[p] = 1;
      stack.push(p);
    };

    for (let x = 0; x < W; x++) { pushIfBg(x, 0); pushIfBg(x, H - 1); }
    for (let y = 0; y < H; y++) { pushIfBg(0, y); pushIfBg(W - 1, y); }

    while (stack.length) {
      const p = stack.pop();
      const x = p % W, y = (p / W) | 0;
      d[p * 4 + 3] = 0; // transparente
      pushIfBg(x + 1, y);
      pushIfBg(x - 1, y);
      pushIfBg(x, y + 1);
      pushIfBg(x, y - 1);
    }

    ctx.putImageData(id, 0, 0);

    const frames = {};
    frameEntries.forEach(([name, frame]) => {
      frames[name] = {
        x: frame.cutX ?? 0, y: frame.cutY ?? 0,
        w: frame.cutWidth ?? W, h: frame.cutHeight ?? H,
      };
    });
    this.textures.remove(key);
    const newTex = this.textures.addCanvas(key, oc);
    Object.entries(frames).forEach(([name, f]) => newTex.add(name, 0, f.x, f.y, f.w, f.h));
  }

  // Dibuja un bloque (cuadro amarillo con marco café) con un corazón en
  // el centro mientras no se usó. `activo=true` → corazón rojo visible.
  // `activo=false` → bloque café plano y fijo (ya usado, sin corazón).
  _crearTexturaBloque(key, activo) {
    const S = 64;
    const oc  = document.createElement('canvas');
    oc.width  = S;
    oc.height = S;
    const ctx = oc.getContext('2d');

    const bg    = activo ? '#FFD447' : '#6B4423';
    const borde = activo ? '#6B4423' : '#4A2E15';

    // Relleno
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, S, S);

    // Borde grueso
    ctx.strokeStyle = borde;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, S - 6, S - 6);

    // Remaches en las esquinas
    ctx.fillStyle = borde;
    const r = 6;
    [[10,10],[S-10,10],[10,S-10],[S-10,S-10]].forEach(([cx, cy]) => {
      ctx.fillRect(cx - r/2, cy - r/2, r, r);
    });

    // "?" estilo Super Mario en el centro (solo bloque activo)
    if (activo) {
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#6B4423';
      ctx.lineWidth = 2;
      ctx.font = 'bold 36px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeText('?', S / 2, S / 2 + 2);
      ctx.fillText('?', S / 2, S / 2 + 2);
    }

    if (this.textures.exists(key)) this.textures.remove(key);
    this.textures.addCanvas(key, oc);
  }

  create() {
    // Al cerrar/reiniciar la escena, destruir todos los colliders ANTES de que
    // Phaser destruya los grupos — evita "Cannot read properties of undefined (reading 'size')"
    this.events.once('shutdown', () => {
      try { this.physics.world.colliders.destroy(); } catch(e) {}
      try { this.physics.world.pause(); } catch(e) {}
    });

    // Resetear flags de estado al inicio (importante en reinicio de escena)
    this._dying      = false;
    this._titleActive = false;

    // Limpiar animaciones previas (si la escena se reinició) para evitar
    // que apunten a texturas viejas borradas por _removeBackground.
    ['caminar', 'saltar', 'goomba_caminar',
     'elefante_caminar', 'elefante_saltar',
     'caminar_capa', 'saltar_capa'].forEach(k => {
      if (this.anims.exists(k)) this.anims.remove(k);
    });

    // Quitar fondo de los sprites de la llama
    this._removeBackground('llama');
    this._removeBackground('jump');
    this._removeBackground('idle');



    // Sonidos: música de fondo en loop + efectos
    // Cada uno se guarda como null si el asset no cargó; los .play() ya tienen guard
    this.sonidoSalto  = this.cache.audio.exists('sonido_salto')  ? this.sound.add('sonido_salto',  { volume: 0.6 })          : null;
    this.sonidoMoneda = this.cache.audio.exists('sonido_moneda') ? this.sound.add('sonido_moneda', { volume: 0.8 })          : null;
    this.musicaFondo  = this.cache.audio.exists('musica_fondo')  ? this.sound.add('musica_fondo',  { loop: true, volume: 0.4 }) : null;

    const tryPlayMusic = () => {
      // Reanudar el AudioContext directamente (necesario en Safari iOS)
      const ctx = this.sound.context;
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().then(() => {
          if (this.musicaFondo && !this.musicaFondo.isPlaying) this.musicaFondo.play();
        });
      } else {
        if (this.musicaFondo && !this.musicaFondo.isPlaying) this.musicaFondo.play();
      }
    };

    if (this.sound.locked) {
      // Phaser detecta bloqueo — escuchamos su evento Y también el primer toque
      this.sound.once('unlocked', tryPlayMusic);
    } else {
      tryPlayMusic();
    }

    // Safari a veces ignora 'unlocked': forzamos al primer toque del usuario.
    // Usamos document (capture) para que stopPropagation en los botones no lo bloquee.
    this.input.once('pointerdown', tryPlayMusic);
    this.input.keyboard.once('keydown', tryPlayMusic);
    document.addEventListener('touchstart', tryPlayMusic, { once: true, passive: true, capture: true });
    document.addEventListener('mousedown',  tryPlayMusic, { once: true, passive: true, capture: true });

    // Límites del mundo y cámara (abajo extendido para que la llama pueda caer)
    this.physics.world.setBounds(0, 0, WORLD_W, H + 600);
    this.cameras.main.setBounds(0, 0, WORLD_W, H);
    this.cameras.main.setBackgroundColor('#5C94FC');

    // ── PISO VISUAL + FÍSICA (segmentado, con huecos = muerte) ──
    // suelooriginal.jpg es 285×268 → se escala al alto del piso (PISO_H) y se tilea
    const tileScaleY = PISO_H / 268;
    const tileScaleX = tileScaleY;

    // Segmentos del piso. Los huecos son trampas mortales.
    const floorSegs = [
      [0,       2500],   // inicio → zona de 4 tubos + camino libre (largo)
      // hueco de 220px: saltable como Mario
      [2720,    3150],   // sección 2: 3 ladrillos bajos + 9 flotantes sobre el hueco 2
      // gap 2: 3150-3400
      [3400,    4700],   // sección 3: 5M + 1L + 2M + 3 aislados + 1 arriba
      [4800,    6392],   // sección 4a: hasta el hueco central de la pirámide
      [6464,    7860],   // sección 4b: termina al pie del último tile (col 8 de la escalera final)
    ];
    // Guardamos los segmentos para usarlos en update() (detección de borde)
    this._floorSegs = floorSegs;

    this.floorBodies = [];
    floorSegs.forEach(([x1, x2]) => {
      const segW   = x2 - x1;
      const centerX = x1 + segW / 2;
      const centerY = H - PISO_H / 2;
      // Respaldo marrón
      this.add.rectangle(centerX, centerY, segW, PISO_H, 0x9B5E1A);
      // Textura de piso (en espacio mundo, se mueve con cámara)
      this.add.tileSprite(centerX, centerY, segW, PISO_H, 'suelooriginal')
        .setTileScale(tileScaleX, tileScaleY);
      // Cuerpo físico estático
      const rect = this.add.rectangle(centerX, centerY, segW, PISO_H, 0, 0);
      this.physics.add.existing(rect, true);
      this.floorBodies.push(rect);
    });

    // ── NUBES (decoración con parallax) ───────────────────────
    // scrollFactor < 1 → se mueven más lento que la cámara (profundidad)
    const cloudDefs = [
      // [x, y, escala, scrollFactor]
      [ 300,  55, 0.18, 0.25],
      [ 780,  90, 0.14, 0.30],
      [1100,  40, 0.20, 0.22],
      [1500,  70, 0.15, 0.28],
      [1850,  50, 0.17, 0.25],
      [2200,  85, 0.13, 0.32],
      [2550,  45, 0.19, 0.20],
      [2900,  75, 0.16, 0.27],
      [3200,  55, 0.18, 0.24],
      [3600,  40, 0.14, 0.30],
      [3900,  80, 0.20, 0.22],
      [4250,  60, 0.15, 0.28],
      [4600,  45, 0.17, 0.25],
      [4900,  90, 0.13, 0.32],
      [5200,  55, 0.19, 0.20],
      [5500,  70, 0.16, 0.27],
      [5850,  40, 0.18, 0.24],
      [6100,  65, 0.15, 0.29],
    ];
    cloudDefs.forEach(([cx, cy, sc, sf]) => {
      this.add.image(cx, cy, 'nube')
        .setScale(sc)
        .setScrollFactor(sf)
        .setDepth(-1);   // detrás de todo
    });

    // ── LADRILLOS (plataformas flotantes) ─────────────────────
    // ladrillo.png es ahora 285×268 — usamos la imagen completa sin recorte.
    const BRICK_W = 36, BRICK_H = 36;
    const BRICK_SRC_W = 285;
    const BRICK_SRC_H = 268;
    const brickSrc = this.textures.get('ladrillo').getSourceImage();

    const brickCanvas = document.createElement('canvas');
    brickCanvas.width  = BRICK_SRC_W;
    brickCanvas.height = BRICK_SRC_H;
    brickCanvas.getContext('2d').drawImage(brickSrc, 0, 0, BRICK_SRC_W, BRICK_SRC_H);

    if (this.textures.exists('brick_crop')) {
        this.textures.remove('brick_crop');
    }

    this.textures.addCanvas('brick_crop', brickCanvas);

    // Bloque de trago: cuadro amarillo con marco café y un corazón,
    // mientras no se usó. Una vez golpeado, queda fijo como bloque
    // café plano (como piedra), sin corazón.
    this._crearTexturaBloque('block_question', true);
    this._crearTexturaBloque('block_used', false);

    // Textura bloque multi-moneda (amarillo con círculo dorado = moneda)
    if (!this.textures.exists('block_coin')) {
      const BC = 64;
      const bc = document.createElement('canvas');
      bc.width = bc.height = BC;
      const bx = bc.getContext('2d');
      bx.fillStyle = '#FFD447'; bx.fillRect(0, 0, BC, BC);
      bx.strokeStyle = '#6B4423'; bx.lineWidth = 6;
      bx.strokeRect(3, 3, BC - 6, BC - 6);
      bx.fillStyle = '#6B4423';
      const r2 = 6;
      [[10,10],[BC-10,10],[10,BC-10],[BC-10,BC-10]].forEach(([cx,cy]) =>
        bx.fillRect(cx - r2/2, cy - r2/2, r2, r2));
      // Moneda dorada en el centro
      bx.beginPath();
      bx.arc(BC/2, BC/2 + 2, 14, 0, Math.PI * 2);
      bx.fillStyle = '#FFD700'; bx.fill();
      bx.strokeStyle = '#B8860B'; bx.lineWidth = 2.5; bx.stroke();
      bx.beginPath();
      bx.arc(BC/2, BC/2 + 2, 8, 0, Math.PI * 2);
      bx.strokeStyle = '#FFF176'; bx.lineWidth = 1.5; bx.stroke();
      this.textures.addCanvas('block_coin', bc);
    }

    // Textura moneda pequeña (para la animación al romper ladrillo o golpear bloque)
    if (!this.textures.exists('moneda_small')) {
      const MS = 18;
      const mc = document.createElement('canvas');
      mc.width = mc.height = MS;
      const mx = mc.getContext('2d');
      mx.beginPath(); mx.arc(MS/2, MS/2, MS/2 - 1, 0, Math.PI * 2);
      mx.fillStyle = '#FFD700'; mx.fill();
      mx.strokeStyle = '#B8860B'; mx.lineWidth = 2; mx.stroke();
      mx.beginPath(); mx.arc(MS/2, MS/2, MS/2 - 5, 0, Math.PI * 2);
      mx.strokeStyle = '#FFF176'; mx.lineWidth = 1.5; mx.stroke();
      this.textures.addCanvas('moneda_small', mc);
    }

    // Animación giratoria de la moneda — usa los frames reales del atlas
    // (el frame 080 no existe en el JSON, así evitamos generar nombres a ciegas)
    if (!this.anims.exists('moneda_giro')) {
      const monedaFrameNames = this.textures.get('moneda').getFrameNames();
      monedaFrameNames.sort();   // orden numérico correcto
      this.anims.create({
        key: 'moneda_giro',
        frames: monedaFrameNames.map(f => ({ key: 'moneda', frame: f })),
        frameRate: 28,
        repeat: 0,
      });
    }

    // Tres alturas de plataforma (y = borde inferior del ladrillo)
    const S  = 52;               // paso entre centros de ladrillos
    const L  = GROUND_Y - 128;  // bajo  — alcanzable desde el suelo
    const M  = GROUND_Y - 210;  // medio — alcanzable desde nivel L
    const HI = GROUND_Y - 292;  // alto  — alcanzable desde nivel M
    const L3 = L - 3 * BRICK_H; // 3 ladrillos arriba de L

    const brickDefs = [
      // ── Inicio: 1 ladrillo solo ── (ladrillo de trago: no se rompe, da un trago)
      [200,L,'trago'],

      // ── Sección 0: fila de 5 — 1 bloque ?×5, 1 bloque ?×1 ──
      [380,L],[416,L,'monedas'],[452,L,'moneda'],[488,L,'moneda1'],[524,L],
      [452,L3],

      // ── Sección 2 (tras hueco 1, x=2720-3150) ──────────────────
      [2760,L,'flor'],[2796,L],[2832,L],
      // fila flotante — 1 bloque ?×5, 1 bloque ?×1
      [2832,M],[2868,M,'monedas'],[2904,M],[2940,M,'moneda1'],[2976,M],
      [3012,M],[3048,M],[3084,M],[3120,M],

      // ── Sección 3 (tras hueco 2, x=3400+) ─────────────────────
      // fila de 5 — 1 bloque ?×5, 1 bloque ?×1
      [3450,M],[3486,M,'monedas'],[3522,M,'moneda'],[3558,M,'moneda1'],[3594,M],
      [3594,L],
      [3720,M],[3756,M],
      // 3 ladrillos aislados — el del medio es bloque ?×5
      [4000,L],[4144,L,'monedas'],[4288,L],
      [4144,L3],

      // ── Sección 4 (x > 4800) ─────────────────────────────────────────
      [4900, L, 'moneda'],
      [5060, L], [5096, L],
      // fila M — 1 bloque ?×5, 2 bloques ?×1
      [5060, M, 'moneda'], [5096, M,'monedas'], [5132, M], [5168, M,'moneda1'],
      [5300, M], [5336, M,'moneda1'], [5372, M], [5408, M],
      [5336, L], [5372, L],

      // ── Sección 5 (zona final) ──────────────────────────────────
      // 1 bloque ?×5, 1 bloque ?×1
      [7126, L,'monedas'], [7162, L], [7198, L,'moneda'], [7234, L,'moneda1'],
    ];

    this.bricks = this.physics.add.staticGroup();

    brickDefs.forEach(([bx, topY, tipoDef]) => {
      const tipo = tipoDef || 'break';
      // Los bloques de trago usan la textura "?" en vez del ladrillo normal.
      const textura = (
          tipo === 'trago' ||
          tipo === 'moneda' ||
          tipo === 'monedas' ||
          tipo === 'moneda1' ||
          tipo === 'flor'
      ) ? 'block_question' : 'brick_crop';
      // setOrigin(0.5, 1) → el punto de anclaje es la base central del ladrillo
      const b = this.bricks.create(bx, topY, textura);
      b.setOrigin(0.5, 1)
       .setDisplaySize(BRICK_W, BRICK_H)
       .refreshBody();
      // tipo: 'break' (default, se rompe al golpear desde abajo) | 'trago' (no se rompe, da un trago)
      b.setData('tipo', tipo);
      b.setData('usado', false);
    });

    // ── TILES (escaleras con tiles.png) ───────────────────────
    // El PNG ya tiene fondo transparente. Solo se recorta al cubo real
    // para que ocupe correctamente 36×36 px al mostrarse en pantalla.
    const tileSrc = this.textures.get('tile_block').getSourceImage();
    const T_CX = 460, T_CY = 220, T_CW = 600, T_CH = 560;
    const tileCanvas = document.createElement('canvas');
    tileCanvas.width = T_CW; tileCanvas.height = T_CH;
    tileCanvas.getContext('2d').drawImage(
      tileSrc, T_CX, T_CY, T_CW, T_CH, 0, 0, T_CW, T_CH
    );
    if (this.textures.exists('tile_crop')) this.textures.remove('tile_crop');
    this.textures.addCanvas('tile_crop', tileCanvas);

    const TILE_S = 36;
    this.stairTiles = this.physics.add.staticGroup();

    const _tile = (x, y) => {
      const t = this.stairTiles.create(x, y, 'tile_crop');
      // Display 6px más grande que el paso (36) para solapar y cerrar huecos visuales
      t.setOrigin(0.5, 1).setDisplaySize(TILE_S + 6, TILE_S + 6).refreshBody();
    };

    // Escaleras: 4 columnas ascendentes [1,2,3,4] → la más baja a la izquierda,
    // la más alta a la derecha. El jugador las sube saltando de izquierda a derecha.
    const stairH = [1, 2, 3, 4];

    const crearEscalera = (x0, reverse = false) => {
      const cols = reverse ? [...stairH].reverse() : stairH;
      cols.forEach((h, c) => {
        const cx = x0 + c * TILE_S + TILE_S / 2;
        for (let row = 0; row < h; row++) {
          _tile(cx, GROUND_Y - row * TILE_S);
        }
      });
    };

    //  ┌─ IZQUIERDA (4 cols) ─┐  GAP 3 tiles  ┌─ DERECHA (4 cols) ─┐
    const STAIR_X = 5600;
    const GAP_W   = 3 * TILE_S;   // 108 px
    const SEC_W   = 4 * TILE_S;   // 144 px
    crearEscalera(STAIR_X);                               // escalera izquierda [1,2,3,4] ↑
    crearEscalera(STAIR_X + SEC_W + GAP_W, true);         // escalera derecha   [4,3,2,1] ↓

    // ── Pirámide: [1,2,3,4,5] · hueco 2 tiles · [5,4,3,2,1] ──────────
    const pyramidH = [1, 2, 3, 4, 5];
    const PYRA_COL  = 5 * TILE_S;   // 180 px cada mitad
    const PYRA_GAP  = 2 * TILE_S;   // 72 px de hueco central
    const SPACE_6   = 6 * TILE_S;   // 216 px de separación antes de la pirámide

    // X de inicio de la pirámide = fin de escalera derecha + 6 tiles
    const PYRA_X = STAIR_X + SEC_W + GAP_W + SEC_W + SPACE_6;

    const crearMitadPiramide = (x0, alturas) => {
      alturas.forEach((h, c) => {
        const cx = x0 + c * TILE_S + TILE_S / 2;
        for (let row = 0; row < h; row++) {
          _tile(cx, GROUND_Y - row * TILE_S);
        }
      });
    };

    crearMitadPiramide(PYRA_X,              pyramidH);                    // [1,2,3,4,5] ↑
    crearMitadPiramide(PYRA_X + PYRA_COL + PYRA_GAP, [...pyramidH].reverse()); // [5,4,3,2,1] ↓

    // ── Escalera final [1,2,3,4,5,6,7,8,8] pegada al tubo 6 ───────────
    // Tubo 6 centrado en x=7490, tw=92 → borde derecho = 7490+46 = 7536
    const finalH = [1, 2, 3, 4, 5, 6, 7, 8, 8];
    const FINAL_X = 7536; // x0: borde derecho del tubo 6
    finalH.forEach((h, c) => {
      const cx = FINAL_X + c * TILE_S + TILE_S / 2;
      for (let row = 0; row < h; row++) {
        _tile(cx, GROUND_Y - row * TILE_S);
      }
    });

    // ── ZONA BOSS (roca 3,3 · lava×5 · roca 3,3) ─────────────
    // El piso termina en x=7860 (pie del último tile).
    // Patrón: [roca col 0][roca col 1][lava×5][roca col 2][roca col 3]
    // Las rocas son sólidas (stairTiles); la lava es visual — caer = muerte.
    const BOSS_X    = 7860;
    const LAVA_W    = 96;    // ancho de cada trozo de lava
    const LAVA_H    = 200;   // alto: se extiende bien hacia abajo (pit visible)
    const LAVA_N    = 5;     // cantidad de trozos
    const ROCA_COLS = 3;     // 3 columnas de roca en cada lado (3,3)
    const ROCA_ROWS = 3;     // filas de roca (altura)

    // Crop de roca.png al contenido real del cubo (1536×1024, misma estructura que tiles.png)
    const rocaSrc = this.textures.get('roca').getSourceImage();
    const R_CX = 460, R_CY = 220, R_CW = 600, R_CH = 560;
    const rocaCanvas = document.createElement('canvas');
    rocaCanvas.width = R_CW; rocaCanvas.height = R_CH;
    rocaCanvas.getContext('2d').drawImage(rocaSrc, R_CX, R_CY, R_CW, R_CH, 0, 0, R_CW, R_CH);
    if (this.textures.exists('roca_crop')) this.textures.remove('roca_crop');
    this.textures.addCanvas('roca_crop', rocaCanvas);

    // Función para colocar tile de roca del mismo tamaño que los ladrillos (36×36)
    const _roca = (x, y) => {
      const r = this.stairTiles.create(x, y, 'roca_crop');
      r.setOrigin(0.5, 1).setDisplaySize(36, 36).refreshBody();
    };

    // Rocas izquierdas (2 col × 3 filas)
    for (let c = 0; c < ROCA_COLS; c++) {
      const cx = BOSS_X + c * TILE_S + TILE_S / 2;
      for (let row = 0; row < ROCA_ROWS; row++) {
        _roca(cx, GROUND_Y - row * TILE_S);
      }
    }

    // Lava visual (sin colisión — caer sobre la lava = muerte por caída)
    const lavaStartX = BOSS_X + ROCA_COLS * TILE_S;
    for (let i = 0; i < LAVA_N; i++) {
      const lx = lavaStartX + i * LAVA_W + LAVA_W / 2;
      // y=H → el fondo de la lava queda al fondo de pantalla; sube LAVA_H px
      this.add.image(lx, H, 'lava')
        .setOrigin(0.5, 1)
        .setDisplaySize(LAVA_W, LAVA_H);
    }

    // Rocas derechas (2 col × 3 filas)
    const rocaRightX = lavaStartX + LAVA_N * LAVA_W;
    for (let c = 0; c < ROCA_COLS; c++) {
      const cx = rocaRightX + c * TILE_S + TILE_S / 2;
      for (let row = 0; row < ROCA_ROWS; row++) {
        _roca(cx, GROUND_Y - row * TILE_S);
      }
    }

    // ── FIN DEL NIVEL ──────────────────────────────────────────
    // La última roca (después del puente) es el final de la pantalla:
    // el mundo y la cámara terminan justo en su borde derecho, así no
    // hay nada más allá y esa roca queda como el límite del juego.
    const LEVEL_END_X = rocaRightX + ROCA_COLS * TILE_S;
    this.physics.world.setBounds(0, 0, LEVEL_END_X, H + 600);
    this.cameras.main.setBounds(0, 0, LEVEL_END_X, H);

    // ── PUENTE (cruza la lava, caminable) ─────────────────────
    // Recorte de puente.png (1536×1024) al contenido real del puente
    // (franja horizontal de tablones, sin los bordes transparentes).
    const puenteSrc = this.textures.get('puente').getSourceImage();
    const PU_CX = 35, PU_CY = 387, PU_CW = 1438, PU_CH = 152;
    const puenteCanvas = document.createElement('canvas');
    puenteCanvas.width = PU_CW; puenteCanvas.height = PU_CH;
    puenteCanvas.getContext('2d').drawImage(puenteSrc, PU_CX, PU_CY, PU_CW, PU_CH, 0, 0, PU_CW, PU_CH);
    if (this.textures.exists('puente_crop')) this.textures.remove('puente_crop');
    this.textures.addCanvas('puente_crop', puenteCanvas);

    // El puente cubre todo el ancho de la lava y queda a la misma altura
    // que la parte de arriba de las rocas, para que se pueda cruzar
    // caminando en vez de tener que saltar sobre la lava.
    const BRIDGE_W     = LAVA_N * LAVA_W;                 // ancho = todo el tramo de lava
    const BRIDGE_H     = 40;
    const BRIDGE_TOP_Y = GROUND_Y - ROCA_ROWS * TILE_S;   // nivel superior de las rocas
    const bridgeCenterX = lavaStartX + BRIDGE_W / 2;

    const bridge = this.stairTiles.create(bridgeCenterX, BRIDGE_TOP_Y + BRIDGE_H, 'puente_crop');
    bridge.setOrigin(0.5, 1)
      .setDisplaySize(BRIDGE_W, BRIDGE_H)
      .refreshBody();

    // Referencia para la transición de cielo en update()
    this._skyStart = 7200;   // x donde empieza el fade
    this._skyEnd   = BOSS_X; // x donde el cielo es completamente negro



    const elefanteCaminarFrames = [];
    for (let i = 35; i <= 75; i++) {
      elefanteCaminarFrames.push({ key: 'elefante_camino', frame: `ezgif-frame-${String(i).padStart(3, '0')}_pixian_ai.png` });
    }
    this.anims.create({
      key: 'elefante_caminar',
      frames: elefanteCaminarFrames,
      frameRate: 14,
      repeat: -1,
    });

    const elefanteSaltarFrames = [];
    for (let i = 76; i <= 95; i++) {
      if (i === 92) continue; // ese frame no existe en el atlas
      elefanteSaltarFrames.push({ key: 'elefante_salto', frame: `ezgif-frame-${String(i).padStart(3, '0')}_pixian_ai.png` });
    }
    this.anims.create({
      key: 'elefante_saltar',
      frames: elefanteSaltarFrames,
      frameRate: 14,
      repeat: 0,
    });

    const ELEFANTE_SCALE = 0.27;
    this._elefanteSpeed  = 55;
    this.elefante = this.physics.add.sprite(
      bridgeCenterX, BRIDGE_TOP_Y, 'elefante_camino', 'ezgif-frame-035_pixian_ai.png',
    );
    this.elefante.setOrigin(0.5, 1);
    this.elefante.setScale(ELEFANTE_SCALE);
    this.elefante.setCollideWorldBounds(true);
    this.elefante.body.setSize(400, 369);
    this.elefante.body.setOffset(140, 0);
    this.elefante.play('elefante_caminar');

    // Límites del puente: el elefante camina de punta a punta.
    const elefanteHalfW = (400 * ELEFANTE_SCALE) / 2;
    this._elefanteXIzq = lavaStartX + BRIDGE_W / 2;   // solo la mitad derecha del puente
    this._elefanteXDer  = lavaStartX + BRIDGE_W - elefanteHalfW;
    this._elefanteDir   = 1;
    this._bridgeTopY    = BRIDGE_TOP_Y;   // guardado para muerte en lava
    this._lavaStartX    = lavaStartX;
    this._levelEndX     = LEVEL_END_X;    // guardado para secuencia victoria

    // ── Variables de boss ───────────────────────────────────────
    this._elefanteHP         = 3;
    this._elefanteState      = 'caminar';
    this._elefanteInvincible = false;
    this._elefanteMuerto     = false;   // guard: true cuando el boss muere
    this._winSequence        = false;   // true durante la caminata al castillo
    this._bossBar            = null;

    // ── Salto periódico del elefante ──────────────────────────
    this.time.addEvent({
      delay: 3200,
      loop: true,
      callback: () => {
        if (this._elefanteState !== 'caminar' || this._elefanteMuerto) return;
        this._elefanteState = 'saltar';
        this.elefante.setVelocityX(0);
        this.elefante.play('elefante_saltar');
        this.elefante.setVelocityY(-420);
      },
    });

    // ── Orbes mágicos: lanza uno hacia la llama cada 2.5 s ───
    this.bolasElefante = this.physics.add.group();
    this._bolaTimer = this.time.addEvent({
      delay: 2500,
      loop: true,
      callback: () => this._lanzarBolaElefante(),
    });
    // Misil del elefante: viaja recto (sin gravedad).
    // Al tocar suelo, escaleras o tubos → explota y se destruye.
    const _destruirOrb = (a, b) => {
      const orb = (a && a.active && a.body && a !== this.elefante) ? a
                : (b && b.active && b.body && b !== this.elefante) ? b
                : null;
      if (!orb || !orb.scene) return;
      this.time.delayedCall(16, () => {
        if (orb && orb.scene) { this._explotar(orb.x, orb.y); orb.destroy(); }
      });
    };
    this.floorBodies.forEach(floor =>
      this.physics.add.collider(this.bolasElefante, floor, _destruirOrb)
    );
    this.physics.add.collider(this.bolasElefante, this.stairTiles, _destruirOrb);
    this.physics.add.collider(this.bolasElefante, this.tubes,      _destruirOrb);

    // Colisión con el piso/rocas/puente: al aterrizar retoma la caminata.
    this.floorBodies.forEach(fb => this.physics.add.collider(this.elefante, fb));
    this.physics.add.collider(this.elefante, this.stairTiles, () => {
      if (this.elefante.body.blocked.down && this._elefanteState === 'saltar') {
        this._elefanteState = 'caminar';
        this.elefante.play('elefante_caminar');
      }
    });

    // ── ENEMIGO "GOOMBA" ───────────────────────────────────────
    // Animación de caminata usando los 40 frames del atlas.
    const goombaFrames = [];
    for (let i = 28; i <= 64; i++) {
      goombaFrames.push({ key: 'goomba', frame: `ezgif-frame-${String(i).padStart(3, '0')}_pixian_ai.png` });
    }
    this.anims.create({
      key: 'goomba_caminar',
      frames: goombaFrames,
      frameRate: 16,
      repeat: -1,
    });

    this.enemies = this.physics.add.group();

    // [x_inicial, dirección inicial: 1 = derecha, -1 = izquierda]
    const enemyDefs = [
      // ── Zona de tubos 1-4 (originales, sin cambios) ──
      [708,  -1],  // sale del tubo 1 hacia la izquierda
      [1255,  1],  // entre tubo 2 y tubo 3
      [1684,  1],  // entre tubo 3 y tubo 4
      [1724, -1],  // pareja del anterior

      // ── Sección 2 (tras hueco 1, x≈2720-3150) ──
      [2850,  1],
      [2980, -1],
      [3080,  1],

      // ── Sección 3 (tras hueco 2, x≈3400-5500) ──
      [3500,  1],
      [3750, -1],
      [4000,  1],
      [4280, -1],
      [4550,  1],
      [4850, -1],
      [5150,  1],
      [5400, -1],

      // ── Sección final (x≈6000-7500) ──
      [6200,  1],
      [6500, -1],
      [6800,  1],
      [7300, -1],
    ];
    enemyDefs.forEach(([ex, dir]) => this._crearGoomba(ex, dir));

    // ── TUBOS (obstáculos sobre el piso) ─────────────────────
    // Formato: [x_centro, ancho_display, alto_display]
    // Los 4 primeros crecen progresivamente; 4to == 3ro
    const tuboDefs = [
      [ 668,  92, 107],  // tubo 1 – tamaño base
      [1042, 105, 122],  // tubo 2 – un poco más alto
      [1468, 118, 137],  // tubo 3 – un poco más alto que el 2
      [1940, 118, 137],  // tubo 4 – mismo tamaño que el 3
      [6870,  92, 107],  // tubo 5 – pequeño (movido más a la izquierda)
      [7490,  92, 107],  // tubo 6 – mismo tamaño
    ];

    this.tubes = this.physics.add.staticGroup();
    tuboDefs.forEach(([tx, tw, th]) => {
      const t = this.tubes.create(tx, GROUND_Y, 'tubo');
      t.setOrigin(0.5, 1)
       .setDisplaySize(tw, th)
       .refreshBody();
    });

    // El goomba camina sobre el piso y da la vuelta al chocar con un tubo.
    this.floorBodies.forEach(fb => this.physics.add.collider(this.enemies, fb));
    this.physics.add.collider(this.enemies, this.tubes);

    // ── LLAMA (jugador) ───────────────────────────────────────
    const IDLE_FRAME = 'ezgif-frame-001 - copia (2).png';
    this.IDLE_FRAME  = IDLE_FRAME;
    this._state      = 'idle';   // 'idle' | 'caminar' | 'saltar'
    this._subiendo   = false;    // true mientras la llama sube tras saltar

  // Estado de poder: 'small' → 'normal' (moneda) → 'capa' (flor)
    this._powerState = 'small';
    this._invincible  = false;   // invencibilidad post-golpe (como Mario)

    this.llama = this.physics.add.sprite(80, GROUND_Y + 4, 'idle', IDLE_FRAME);
    this.llama.setOrigin(0.5, 1);
    this.llama.setScale(LLAMA_SCALE_SMALL);   // empieza pequeña
    this.llama.setCollideWorldBounds(true);

    // Aplica hitbox según el estado de poder actual
    this._applyLlamaHitbox();

    // ── ANIMACIONES ───────────────────────────────────────────
    this.anims.create({
      key: 'caminar',
      frames: [
        { key: 'llama', frame: 'ezgif-frame-003.png' },
        { key: 'llama', frame: 'ezgif-frame-004.png' },
        { key: 'llama', frame: 'ezgif-frame-005.png' },
        { key: 'llama', frame: 'ezgif-frame-006.png' },
        { key: 'llama', frame: 'ezgif-frame-007.png' },
        { key: 'llama', frame: 'ezgif-frame-008.png' },
        { key: 'llama', frame: 'ezgif-frame-009.png' },
        { key: 'llama', frame: 'ezgif-frame-010.png' },
      ],
      frameRate: 10, repeat: -1,
    });

    this.anims.create({
      key: 'saltar',
      frames: [
        { key: 'jump', frame: 'ezgif-frame-020.png' },
        { key: 'jump', frame: 'ezgif-frame-021.png' },
        { key: 'jump', frame: 'ezgif-frame-024.png' },
        { key: 'jump', frame: 'ezgif-frame-025.png' },
        { key: 'jump', frame: 'ezgif-frame-026.png' },
        { key: 'jump', frame: 'ezgif-frame-027.png' },
        { key: 'jump', frame: 'ezgif-frame-028.png' },
        { key: 'jump', frame: 'ezgif-frame-029.png' },
        { key: 'jump', frame: 'ezgif-frame-030.png' },
        { key: 'jump', frame: 'ezgif-frame-031.png' },
        { key: 'jump', frame: 'ezgif-frame-032.png' },
        { key: 'jump', frame: 'ezgif-frame-033.png' },
        { key: 'jump', frame: 'ezgif-frame-034.png' },
        { key: 'jump', frame: 'ezgif-frame-035.png' },
        { key: 'jump', frame: 'ezgif-frame-036.png' },
        { key: 'jump', frame: 'ezgif-frame-037.png' },
        { key: 'jump', frame: 'ezgif-frame-038.png' },
        { key: 'jump', frame: 'ezgif-frame-040.png' },
        { key: 'jump', frame: 'ezgif-frame-041.png' },
      ],
      frameRate: 14, repeat: 0,
    });

    // ── Animaciones CAPA (fondo ya transparente en los PNGs) ──────────
    // caminocapa: 20 frames (001–020)
    this.anims.create({
      key: 'caminar_capa',
      frames: this.textures.get('caminocapa').getFrameNames().sort().map(f => ({ key: 'caminocapa', frame: f })),
      frameRate: 12,
      repeat: -1,
    });
    // saltocapa: todos los frames del atlas (021–044, solo los que existen)
    this.anims.create({
      key: 'saltar_capa',
      frames: this.textures.get('saltocapa').getFrameNames().sort().map(f => ({ key: 'saltocapa', frame: f })),
      frameRate: 14,
      repeat: 0,
    });

    // ── COLISIONES ────────────────────────────────────────────
    this.floorBodies.forEach(fb => this.physics.add.collider(this.llama, fb));
    this.physics.add.collider(this.llama, this.tubes);

    // Pisar CABEZA del elefante → boss aturdido + llama rebota.
    // Tocar de costado/abajo → llama pierde poder.
    this.physics.add.collider(this.llama, this.elefante, (llama, elefante) => {
      if (this._elefanteMuerto || !elefante.active) return;
      const falling = llama.body.velocity.y > -80;   // cualquier contacto desde arriba
      const above   = llama.body.bottom < elefante.body.top + 40;  // tolerancia generosa
      if (falling && above && this._elefanteState !== 'aturdido') {
        llama.setVelocityY(-380);
        this._elefanteAturdirPorPison();
      } else {
        this._takeDamage();
      }
    });

    // Misil del boss: detección manual en update() — ver _checkMisiles()
    this.physics.add.collider(this.llama, this.bricks, (llama, brick) => {
      // _subiendo: flag propio seteado al saltar, reset al empezar a bajar.
      // Es la forma más fiable — no depende de que Phaser preserve velocity.y
      // en el momento exacto del callback, ni de blocked.up.
      // Además exigimos que la llama esté DEBAJO del ladrillo (center.y > brick center).
      const hitiendoDesdeAbajo =
        this._subiendo &&
        llama.body.center.y > brick.body.center.y;

      if (!hitiendoDesdeAbajo) return;

      const tipo = brick.getData('tipo');

      if (tipo === 'trago') {
        // Bloque "?" estilo Mario: no se rompe. Solo la PRIMERA vez que lo
        // golpean desde abajo suelta un trago y rebota; después queda fijo,
        // como piedra, sin volver a moverse ni reaccionar.
        if (!brick.getData('usado')) {
          brick.setData('usado', true);
          this._lanzarMonedaAnim(brick.x, brick.body.top);
          this._rebotarLadrillo(brick);
          brick.setTexture('block_used').setDisplaySize(36, 36).refreshBody(); // queda fijo, ya sin el "?"
        }
        return;
      }

      if (tipo === 'moneda') {
        // Ladrillo con hongo: la primera vez sale el hongo y camina;
        // el ladrillo queda fijo (igual que el bloque de trago).
        if (!brick.getData('usado')) {
          brick.setData('usado', true);
          this._lanzarHongo(brick.x, brick.body.top);
          this._rebotarLadrillo(brick);
          brick.setTexture('block_used').setDisplaySize(36, 36).refreshBody();
        }
        return;
      }

      if (tipo === 'flor') {
        // Ladrillo con flor de fuego: solo la primera vez lanza el power-up.
        if (!brick.getData('usado')) {
          brick.setData('usado', true);
          this._lanzarFlor(brick.x, brick.body.top);
          this._rebotarLadrillo(brick);
          brick.setTexture('block_used').setDisplaySize(36, 36).refreshBody();
        }
        return;
      }

      if (tipo === 'monedas') {
        // Bloque ?×5: hasta 5 golpes, luego queda duro.
        if (brick.getData('usado')) return;
        const MAX_MONEDAS = 5;
        const count = (brick.getData('monCount') || 0) + 1;
        brick.setData('monCount', count);
        this._lanzarMonedaAnim(brick.x, brick.body.top);
        this._rebotarLadrillo(brick);
        if (count >= MAX_MONEDAS) {
          brick.setData('usado', true);
          brick.setTexture('block_used').setDisplaySize(36, 36).refreshBody();
        }
        return;
      }

      if (tipo === 'moneda1') {
        // Bloque ?×1: 1 golpe → 1 moneda → se endurece.
        if (brick.getData('usado')) return;
        brick.setData('usado', true);
        this._lanzarMonedaAnim(brick.x, brick.body.top);
        this._rebotarLadrillo(brick);
        brick.setTexture('block_used').setDisplaySize(36, 36).refreshBody();
        return;
      }

      // Ladrillo normal ('break'): explota en fragmentos, sin moneda.
      const cx = brick.x;
      const cy = brick.body.top;
      [[-1,-1],[1,-1],[-1.5,-0.5],[1.5,-0.5],[-0.5,1],[0.5,1]].forEach(([dx, dy]) => {
        const frag = this.add.image(cx, cy, 'ladrillo')
          .setDisplaySize(16, 16)
          .setDepth(10);
        this.tweens.add({
          targets:  frag,
          x:        cx + dx * 44,
          y:        cy + dy * 52,
          alpha:    0,
          angle:    dx * 280,
          duration: 440,
          ease:     'Power2',
          onComplete: () => frag.destroy(),
        });
      });
      brick.destroy();
    }, null, this);

    // Colisiones con tiles de escaleras
    this.physics.add.collider(this.llama, this.stairTiles);
    this.physics.add.collider(this.enemies, this.stairTiles);

    // Llama vs goomba: si lo pisa desde arriba, lo mata y rebota;
    // si lo toca de costado, la llama muere.
    // El processCallback corre ANTES de separar los cuerpos, así que ahí
    // decidimos con la posición real de contacto (más confiable que
    // revisarlo después, cuando Arcade Physics ya movió los sprites).
    this.physics.add.collider(this.llama, this.enemies, (llama, goomba) => {
      if (!goomba.active || !goomba.getData('vivo')) return;

      if (goomba.getData('pisado')) {
        this._matarGoomba(goomba);
        llama.setVelocityY(-260);
      } else {
        this._takeDamage();
      }
    }, (llama, goomba) => {
      const pisando =
        llama.body.velocity.y > 0 &&
        llama.body.center.y < goomba.body.center.y;
      goomba.setData('pisado', pisando);
      return true;
    }, this);

    // ── CÁMARA ────────────────────────────────────────────────
    this.cameras.main.startFollow(this.llama, true, 0.1, 1);

    // ── CONTROLES TECLADO ─────────────────────────────────────
    this.cursors  = this.input.keyboard.createCursorKeys();
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.keyB     = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.B);

    // ── CONTROLES TÁCTILES (swipe sobre el canvas, como respaldo) ──
    this.touch = { active: false, startX: 0, startY: 0, dirX: 0, saltado: false };
    this.input.on('pointerdown', (p) => {
      this.touch = { active: true, startX: p.x, startY: p.y, dirX: 0, saltado: false };
    });
    this.input.on('pointermove', (p) => {
      if (!this.touch.active) return;
      const dx = p.x - this.touch.startX;
      const dy = p.y - this.touch.startY;
      if (Math.abs(dx) > 12) this.touch.dirX = dx > 0 ? 1 : -1;
      if (dy < -35 && !this.touch.saltado) { this.touch.saltado = true; this._doJump(); }
    });
    this.input.on('pointerup', () => { this.touch.active = false; this.touch.dirX = 0; });

    // ── BOTONES TÁCTILES (D-pad + salto, para celular) ─────────
    this.mobileControls = { left: false, right: false };

    // ── POOL DE BOLAS DE FUEGO ─────────────────────────────────────────────
    // Pool de 8 slots. Se usan disableBody/enableBody (patrón oficial Phaser 3)
    // porque incluyen body.reset() que sincroniza la posición interna del body.
    this._createFireballTexture();
    this._crearTexturaBrasa();
    // textura orb ya no se genera por canvas — se usa misil.png
    this.fireballs = this.physics.add.group();
    for (let i = 0; i < 8; i++) {
      const _fb = this.fireballs.create(-200, -200, 'fireball');
      _fb.setOrigin(0.5, 0.5).setDisplaySize(20, 20);
      _fb.body.setSize(20, 20);
      _fb.disableBody(true, true);   // setActive(false) + setVisible(false) + body.enable=false
    }
    this._lastFireTime = 0;
    // Registrar colliders una sola vez (todos los grupos ya existen aquí)
    this._setupFireballColliders();

    this._setupMobileButtons();

    // ── HUD estilo Mario ──────────────────────────────────────
    const PF = '"Press Start 2P", "Courier New", monospace';
    const hudStyle = { fontFamily: PF, fontSize: '9px', color: '#ffffff', stroke: '#000', strokeThickness: 2 };
    const valStyle = { fontFamily: PF, fontSize: '11px', color: '#ffffff', stroke: '#000', strokeThickness: 2 };

    // ── Parche Phaser 3.90: Group.getLength() crashea con "size of undefined" ──
    // cuando un grupo es destruido mientras el physics world todavía lo itera.
    // Parcheamos getLength() en el prototipo del grupo para que devuelva 0
    // en lugar de lanzar un error cuando children es undefined/null.
    {
      // Subir por la cadena de prototipos para encontrar donde vive getLength
      let proto = Object.getPrototypeOf(this.enemies);
      while (proto) {
        if (Object.prototype.hasOwnProperty.call(proto, 'getLength') && !proto._gl390) {
          proto._gl390 = true;
          const _origGL = proto.getLength;
          proto.getLength = function() {
            if (!this.children) return 0;
            return _origGL.call(this);
          };
          break;
        }
        proto = Object.getPrototypeOf(proto);
      }
    }

    // Franja oscura superior fija
    this.add.rectangle(W / 2, 14, W, 28, 0x000000, 0.45).setScrollFactor(0).setDepth(10);

    // Vidas (izquierda)
    this.add.text(10, 5, 'LLAMA', hudStyle).setScrollFactor(0).setDepth(11);
    this.vidas = 3;
    this.vidasText = this.add.text(10, 15, '? ×3', valStyle).setScrollFactor(0).setDepth(11);

    // Monedas (centro)
    this.add.text(W / 2, 5, 'MONEDAS', hudStyle).setOrigin(0.5, 0).setScrollFactor(0).setDepth(11);
    this.tragos = 0;
    this.tragoText = this.add.text(W / 2, 15, '🪙 ×0', valStyle).setOrigin(0.5, 0).setScrollFactor(0).setDepth(11);

    // Mundo (derecha)
    this.add.text(W - 10, 5, 'MUNDO', hudStyle).setOrigin(1, 0).setScrollFactor(0).setDepth(11);
    this.add.text(W - 10, 15, '1-1', valStyle).setOrigin(1, 0).setScrollFactor(0).setDepth(11);
  }

  // ── Hitbox de la llama según estado de poder ─────────────────────────
  // Se llama al crear la llama y cada vez que cambia de forma.
  // Coordenadas locales (pre-escala): setSize/setOffset trabajan en espacio local.
  _applyLlamaHitbox() {
    if (this._powerState === 'capa') {
      // Frame capa: 369 × 674 px — fondo ya transparente, personaje centrado
      const FW = 369, FH = 674;
      const bW = Math.round(FW * 0.50);   // 50% del ancho (cuerpo visible)
      const bH = Math.round(FH * 0.80);   // 80% de la altura (ignora zona superior)
      this.llama.body.setSize(bW, bH);
      this.llama.body.setOffset(
        (FW - bW) / 2,          // centrado horizontal
        FH * 0.18               // baja el tope del hitbox (ignora cabeza/cuello vacíos)
      );
    } else {
      // Frame normal/small: idle/walk/jump ≈ 464 × 848 px
      const FW = 464, FH = 848;
      const bW = Math.round(FW * 0.50);   // 50% del ancho
      const bH = Math.round(FH * 0.80);   // 80% de la altura
      this.llama.body.setSize(bW, bH);
      this.llama.body.setOffset(
        (FW - bW) / 2,          // centrado horizontal
        FH * 0.18               // ignora espacio transparente superior
      );
    }
  }

  // ── Cambia el estado de poder de la llama ─────────────────────────────
  // 'small' → 'normal' (come moneda) → 'capa' (come flor de fuego)
  _setPowerState(newState) {
    this._powerState = newState;

    if (newState === 'normal') {
      // Crece de pequeña a tamaño normal
      this.tweens.add({
        targets: this.llama,
        scaleX: LLAMA_SCALE,
        scaleY: LLAMA_SCALE,
        duration: 280,
        ease: 'Back.easeOut',
      });
      // Flash de crecimiento
      this.tweens.add({ targets: this.llama, alpha: 0, duration: 70, yoyo: true, repeat: 3 });
    }

    if (newState === 'capa') {
      // Transforma a forma capa: flash dorado + crece un poco más
      const IDLE_CAPA = this.textures.get('quietocapa').getFrameNames()[0];
      this.tweens.add({
        targets: this.llama,
        alpha: 0,
        duration: 60,
        yoyo: true,
        repeat: 5,
        onComplete: () => {
          // Cambia textura a capa y ajusta escala
          this.llama.setTexture('quietocapa', IDLE_CAPA);
          this.llama.setScale(LLAMA_SCALE_CAPA);
          this._state = 'idle';
          // Actualizar hitbox para el frame capa
          this._applyLlamaHitbox();
        }
      });
    }

    // Siempre actualiza el hitbox al cambiar estado (excepto capa que lo hace en onComplete)
    if (newState !== 'capa') this._applyLlamaHitbox();
  }

  // ── Sistema de daño estilo Super Mario Bros ───────────────────────────
  // capa → normal → small → muere
  // Al recibir daño hay ~2 s de invencibilidad con parpadeo.
  _takeDamage() {
    // No hacer nada si ya hay invencibilidad activa o la llama está muriendo
    if (this._invincible || this._dying) return;

    if (this._powerState === 'capa') {
      // Pierde flor de fuego → vuelve a forma normal
      this._powerState = 'normal';
      // Cancelar tweens activos de la llama (escala, alpha de transformación)
      this.tweens.killTweensOf(this.llama);
      this.llama.setTexture('idle', this.IDLE_FRAME);
      this.llama.setScale(LLAMA_SCALE);
      this._state = 'idle';
      this._applyLlamaHitbox();
      this._startInvincibility();

    } else if (this._powerState === 'normal') {
      // Pierde hongo → vuelve a forma pequeña
      this._powerState = 'small';
      this.tweens.killTweensOf(this.llama);
      this.llama.setScale(LLAMA_SCALE_SMALL);
      this._applyLlamaHitbox();
      this._startInvincibility();

    } else {
      // Ya es pequeña → muere
      this._respawn();
    }
  }

  // Activa ~2 s de invencibilidad con parpadeo visual (igual que Mario).
  _startInvincibility() {
    this._invincible = true;
    this._playHurtSound();
    this.tweens.killTweensOf(this.llama);
    this.tweens.add({
      targets:  this.llama,
      alpha:    0.2,
      duration: 80,
      yoyo:     true,
      repeat:   13,            // 80 ms × 2 × 14 ≈ 2240 ms de parpadeo
      ease:     'Linear',
      onComplete: () => {
        this.llama.setAlpha(1);
        this._invincible = false;
      },
    });
  }

  // Sonido de golpe sintetizado (descendente rápido, estilo Mario hurt).
  _playHurtSound() {
    try {
      const ctx = this.sound.context;
      if (!ctx || ctx.state === 'suspended') return;
      const t = ctx.currentTime;
      [[600, 0.00, 0.09], [400, 0.09, 0.09], [250, 0.18, 0.14]].forEach(([freq, offset, dur]) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, t + offset);
        gain.gain.setValueAtTime(0.18, t + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, t + offset + dur);
        osc.start(t + offset); osc.stop(t + offset + dur + 0.02);
      });
    } catch (e) {}
  }

  // ── Lanza la flor de fuego desde el ladrillo ──────────────────────────
  // Sale hacia arriba, cae al piso y espera a que la llama la toque.
  _lanzarFlor(brickX, brickTopY) {
    const flor = this.physics.add.image(brickX, brickTopY, 'flordefuego');
    flor.setOrigin(0.5, 1)
        .setDisplaySize(48, 48)
        .setDepth(9);
    flor.setGravityY(500);
    flor.setCollideWorldBounds(true);
    // Sale disparada hacia arriba, camina a la derecha
    flor.setVelocityY(-260);
    flor.setVelocityX(110);

    // Colisión con piso
    this.floorBodies.forEach(fb => this.physics.add.collider(flor, fb));
    this.physics.add.collider(flor, this.bricks);
    this.physics.add.collider(flor, this.stairTiles);

    // Rebota en tubos
    this.physics.add.collider(flor, this.tubes, () => {
      flor.setVelocityX(-flor.body.velocity.x);
    });

    // Llama la recoge → se transforma en capa
    this.physics.add.overlap(this.llama, flor, () => {
      if (!flor.active) return;
      flor.destroy();
      if (this.sonidoMoneda) this.sonidoMoneda.play();
      // Solo si está en estado normal o small
      if (this._powerState !== 'capa') {
        this._setPowerState('capa');
      }
    });
  }

  // Pequeño rebote visual del ladrillo golpeado (no se rompe).
  _rebotarLadrillo(brick) {
    if (brick.getData('rebotando')) return;
    brick.setData('rebotando', true);
    const baseY = brick.y;
    this.tweens.add({
      targets: brick,
      y: baseY - 8,
      duration: 70,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => {
        brick.setData('rebotando', false);
        brick.body.updateFromGameObject();
      },
    });
  }

  // Sale una moneda del ladrillo y suma al contador.
  _darTrago(x, y) {
    const trago = this.add.text(x, y, '🪙', { fontSize: '22px' }).setOrigin(0.5, 1).setDepth(10);
    this.tweens.add({
      targets: trago,
      y: y - 46,
      alpha: 0,
      duration: 550,
      ease: 'Cubic.easeOut',
      onComplete: () => trago.destroy(),
    });

    this.tragos += 1;
    this.tragoText.setText(`🪙 x${this.tragos}`);
  }

  // Moneda pequeña que salta hacia arriba y desaparece (como Mario).
  _lanzarMonedaAnim(x, y) {
    const m = this.add.image(x, y - 4, 'moneda_small')
      .setOrigin(0.5, 1).setDepth(12).setDisplaySize(22, 22);
    // Sube rápido y luego cae un poco antes de desaparecer
    this.tweens.add({
      targets: m,
      y: y - 72,
      alpha: 0,
      duration: 500,
      ease: 'Cubic.easeOut',
      onComplete: () => m.destroy(),
    });
    this.tragos += 1;
    this.tragoText.setText(`🪙 x${this.tragos}`);
    if (this.sonidoMoneda) this.sonidoMoneda.play();
  }

  // Saca el hongo del ladrillo: sale disparado hacia arriba,
  // cae al piso y camina hacia la derecha (igual que el hongo de Mario).
  // Al chocar con un tubo rebota a la izquierda; si la llama lo toca lo recoge.
  _lanzarHongo(brickX, brickTopY) {
    const primerFrame = this.textures.get('moneda').getFrameNames()[0];

    const hongo = this.physics.add.sprite(brickX, brickTopY, 'moneda', primerFrame);
    hongo.setOrigin(0.5, 1)
         .setDisplaySize(72, 72)
         .setDepth(9);

    hongo.setGravityY(500);
    hongo.setCollideWorldBounds(true);

    // Sale disparado hacia arriba y empieza caminando a la derecha
    hongo.setVelocityY(-260);
    hongo.setVelocityX(110);

    // Animación en loop infinito
    hongo.play({ key: 'moneda_giro', repeat: -1 });

    // ── Piso ──
    this.floorBodies.forEach(fb => {
      this.physics.add.collider(hongo, fb);
    });

    // ── Ladrillos y tiles ──
    this.physics.add.collider(hongo, this.bricks);
    this.physics.add.collider(hongo, this.stairTiles);

    // ── Tubos: rebota invirtiendo dirección ──
    this.physics.add.collider(hongo, this.tubes, () => {
      const vx = hongo.body.velocity.x;
      hongo.setVelocityX(-vx);          // invierte horizontal
      hongo.setFlipX(hongo.flipX);      // ya está flipped por la anim
    });

    // ── Llama lo recoge: crece si estaba pequeña ──
    this.physics.add.overlap(this.llama, hongo, () => {
      if (!hongo.active) return;
      hongo.destroy();
      if (this.sonidoMoneda) this.sonidoMoneda.play();
      // Si la llama es pequeña, crece a tamaño normal al comer la moneda
      if (this._powerState === 'small') {
        this._setPowerState('normal');
      }
    });

    if (this.sonidoMoneda) this.sonidoMoneda.play();
  }

  // Crea un goomba en `x`, sobre el piso, caminando en dirección `dir`
  // (1 = derecha, -1 = izquierda).
  _crearGoomba(x, dir) {
    const g = this.enemies.create(x, GROUND_Y - 10, 'goomba', 'ezgif-frame-028_pixian_ai.png');
    g.setOrigin(0.5, 1);
    g.setScale(GOOMBA_SCALE);
    g.setCollideWorldBounds(true);
    g.setData('dir', dir);
    g.setData('vivo', true);

    // Hitbox local (pre-escala). Frame real: 674×369 px, personaje centrado
    // y apoyado en la base del frame (igual que el atlas del elefante).
    const G_W = 674, G_H = 369;
    const bodyLocalW  = Math.round(G_W * 0.6);
    const bodyLocalH  = G_H;
    const bodyOffsetX = (G_W - bodyLocalW) / 2;
    const bodyOffsetY = 0;
    g.body.setSize(bodyLocalW, bodyLocalH);
    g.body.setOffset(bodyOffsetX, bodyOffsetY);

    g.play('goomba_caminar');
    g.setVelocityX(dir * GOOMBA_SPEED);
    g.setFlipX(dir < 0);
    return g;
  }

  // Mata al goomba (lo pisaron desde arriba): se detiene, hace un pequeño
  // "aplastón" visual y desaparece.
  _matarGoomba(goomba) {
    if (!goomba.getData('vivo')) return;
    goomba.setData('vivo', false);
    goomba.body.setVelocity(0, 0);
    goomba.body.enable = false;
    goomba.anims.stop();

    this.tweens.add({
      targets: goomba,
      scaleY: goomba.scaleY * 0.2,
      y: goomba.y + 6,
      alpha: 0,
      duration: 220,
      ease: 'Quad.easeIn',
      onComplete: () => goomba.destroy(),
    });
  }

  // Conecta los botones HTML con el juego.
  // stopPropagation evita que el canvas reciba el mismo touch y interfiera.
  _setupMobileButtons() {
    const btnLeft  = document.getElementById('btn-left');
    const btnRight = document.getElementById('btn-right');
    const btnJump  = document.getElementById('btn-jump');
    const btnUp    = document.getElementById('btn-up');
    const btnDown  = document.getElementById('btn-down');
    const btnStart = document.getElementById('btn-start');
    if (!btnLeft || !btnRight || !btnJump) return;

    const bind = (el, onDown, onUp) => {
      if (!el) return;
      const down = (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('is-active'); onDown(); };
      const up   = (e) => { e.preventDefault(); e.stopPropagation(); el.classList.remove('is-active'); onUp && onUp(); };
      el.addEventListener('touchstart', down, { passive: false });
      el.addEventListener('touchend',   up,   { passive: false });
      el.addEventListener('touchcancel', up,  { passive: false });
      el.addEventListener('mousedown', down);
      el.addEventListener('mouseup',   up);
      el.addEventListener('mouseleave', up);
    };

    bind(btnLeft,
      () => { this.mobileControls.left = true; },
      () => { this.mobileControls.left = false; });

    bind(btnRight,
      () => { this.mobileControls.right = true; },
      () => { this.mobileControls.right = false; });

    bind(btnJump, () => {
      if (this._titleActive) { this._menuConfirm && this._menuConfirm(); }
      else { this._doJump(); }
    });

    // ↑ ↓ navegan el menú del título (en juego no hacen nada por ahora)
    bind(btnUp,   () => { this._menuMove && this._menuMove(-1); });
    bind(btnDown, () => { this._menuMove && this._menuMove(1); });

    // START confirma la opción seleccionada en el menú
    bind(btnStart, () => { this._menuConfirm && this._menuConfirm(); });

    // Botón B: lanzar bola de fuego (solo activo con Flor de Fuego)
    const btnFire = document.getElementById('btn-fire');
    bind(btnFire, () => { this._dispararBola(); });
    if (btnFire) btnFire.classList.add('ctrl-b--disabled'); // empieza desactivado

    // Si la escena se reinicia/destruye, evitamos referencias colgantes.
    this.events.once('shutdown', () => {
      this.mobileControls.left  = false;
      this.mobileControls.right = false;
      this._menuMove    = null;
      this._menuConfirm = null;
    });

    // ── Overlay de título directamente en GameScene ───────────
    // Así el mundo se ve de fondo sin problemas de transparencia
    this._titleActive = true;
    this.physics.world.pause();   // congela enemigos, elefante y llama
    this.llama.body.allowGravity = false;
    this.llama.setVelocity(0, 0);

    const imgW = Math.round(W * 0.56);
    const imgH = Math.round(imgW * (1024 / 1536));
    const _tImg = this.add.image(W / 2, H / 2 - 22, 'aniversario')
      .setDisplaySize(imgW, imgH).setScrollFactor(0).setDepth(200);

    const _tBar = this.add.rectangle(W / 2, H - 52, W, 80, 0x000000, 0.70)
      .setScrollFactor(0).setDepth(200);

    const PF = '"Press Start 2P", "Courier New", monospace';

    // Opciones del menú: 0 = TRIVIA, 1 = DEMO
    let _sel = 1;  // JUGAR DEMO seleccionado por defecto

    const OPT_Y   = [H - 74, H - 44];
    const OPT_LBL = ['GÁNATE UNA MESA TRIVIA', 'JUGAR DEMO'];
    const OPT_SZ  = ['10px', '13px'];

    const _tOpt1 = this.add.text(W / 2, OPT_Y[0], OPT_LBL[0],
      { fontFamily: PF, fontSize: OPT_SZ[0], color: '#ffffff', stroke: '#000', strokeThickness: 3 }
    ).setOrigin(0.5).setScrollFactor(0).setDepth(201).setInteractive({ useHandCursor: true });

    const _tOpt2 = this.add.text(W / 2, OPT_Y[1], OPT_LBL[1],
      { fontFamily: PF, fontSize: OPT_SZ[1], color: '#FFD700', stroke: '#000', strokeThickness: 3 }
    ).setOrigin(0.5).setScrollFactor(0).setDepth(201).setInteractive({ useHandCursor: true });

    const _opts = [_tOpt1, _tOpt2];

    const _tArrow = this.add.text(0, 0, '▶',
      { fontFamily: PF, fontSize: '12px', color: '#FFD700' }
    ).setOrigin(0.5).setScrollFactor(0).setDepth(201);
    this.tweens.add({ targets: _tArrow, alpha: 0, duration: 380, yoyo: true, repeat: -1 });

    // Actualiza colores y posición de la flecha según selección
    const _updateSel = () => {
      _opts.forEach((t, i) => t.setColor(i === _sel ? '#FFD700' : '#ffffff'));
      const tgt = _opts[_sel];
      _tArrow.setPosition(tgt.x - tgt.width / 2 - 18, tgt.y);
    };
    _updateSel();

    const _startGame = () => {
      if (!this._titleActive) return;
      this._titleActive  = false;
      this._menuMove     = null;
      this._menuConfirm  = null;
      // Guardar modo seleccionado en el registry para usarlo al final
      this.registry.set('modoJuego', _sel === 0 ? 'trivia' : 'demo');
      this.physics.world.resume();
      this.llama.body.allowGravity = true;
      [_tImg, _tBar, _tOpt1, _tOpt2, _tArrow].forEach(o => o.destroy());
      this.input.keyboard.off('keydown', _kbHandler);
    };

    // Navegar con ↑ ↓ del teclado o botones móviles
    const _kbHandler = (e) => {
      if (e.key === 'ArrowUp'   || e.key === 'w') { this._menuMove(-1); return; }
      if (e.key === 'ArrowDown' || e.key === 's') { this._menuMove(1);  return; }
      _startGame();
    };

    // Callbacks expuestos a los botones móviles
    this._menuMove = (dir) => {
      _sel = (_sel + dir + 2) % 2;
      _updateSel();
    };
    this._menuConfirm = _startGame;

    _tOpt1.on('pointerdown', () => { _sel = 0; _startGame(); });
    _tOpt2.on('pointerdown', () => { _sel = 1; _startGame(); });
    this.input.keyboard.on('keydown', _kbHandler);
  }

  // ═══════════════════════════════════════════════════════════════
  //  SISTEMA DE BOSS — ELEFANTE
  // ═══════════════════════════════════════════════════════════════

  // Crea la barra de HP del boss (se llama la primera vez que recibe daño)
  _crearBarraElefante() {
    if (this._bossBar) return;
    const PF = '"Press Start 2P", "Courier New", monospace';
    this._bossBarBg = this.add.rectangle(W / 2, H - 14, 200, 14, 0x000000, 0.65)
      .setScrollFactor(0).setDepth(20);
    this._bossLabel = this.add.text(W / 2 - 96, H - 20, '🐘', { fontSize: '10px' })
      .setScrollFactor(0).setDepth(21);
    this._bossBar = this.add.rectangle(W / 2 - 74, H - 14, 140, 7, 0xff2222)
      .setScrollFactor(0).setDepth(21).setOrigin(0, 0.5);
  }

  _actualizarBarraElefante() {
    if (!this._bossBar) return;
    const pct = Math.max(0, this._elefanteHP) / 3;
    this.tweens.add({ targets: this._bossBar, width: 140 * pct, duration: 180 });
  }

  // El elefante recibe un pisotón desde arriba
  _elefanteRecibirGolpe() {
    if (this._elefanteInvincible || !this.elefante || !this.elefante.active) return;

    this._elefanteHP--;
    this._playStompElephantSound();

    // Flash rojo
    this._elefanteInvincible = true;
    this.elefante.setTint(0xff4444);
    this.time.delayedCall(140, () => {
      if (this.elefante && this.elefante.active) this.elefante.clearTint();
    });

    if (this._elefanteHP <= 0) {
      this._elefanteMuere();
      return;
    }

    // Aturdimiento: se detiene, parpadea y retoma la caminata
    this._elefanteState = 'aturdido';
    this.elefante.setVelocity(0, 0);
    // Parpadeo rápido durante el aturdimiento
    this.tweens.add({
      targets: this.elefante, alpha: 0.25,
      duration: 90, yoyo: true, repeat: 4,
      onComplete: () => {
        if (this.elefante && this.elefante.active) this.elefante.setAlpha(1);
      },
    });
    this.time.delayedCall(720, () => {
      if (!this.elefante || !this.elefante.active) return;
      this.elefante.clearTint();
      this._elefanteInvincible = false;
      this._elefanteState = 'caminar';
      this.elefante.play('elefante_caminar');
    });
  }

  // ─── Stun por pisotón ────────────────────────────────────────
  _elefanteAturdirPorPison() {
    if (!this.elefante || !this.elefante.active || this._elefanteMuerto) return;
    if (this._elefanteState === 'aturdido') return;
    this._playStompElephantSound();
    this._elefanteState      = 'aturdido';
    this._elefanteInvincible = false;   // sigue siendo vulnerable al fuego
    this.elefante.setVelocity(0, 0);
    this.elefante.setTint(0xffee00);    // amarillo = aturdido

    // Estrellas orbitando sobre la cabeza del elefante
    const stars = [];
    for (let i = 0; i < 3; i++) {
      const s = this.add.text(0, 0, '⭐', { fontSize: '13px' })
        .setOrigin(0.5).setDepth(16);
      stars.push({ obj: s, phase: (i / 3) * Math.PI * 2 });
    }
    let elapsed = 0;
    const starTick = this.time.addEvent({
      delay: 16, loop: true,
      callback: () => {
        if (!this.elefante || !this.elefante.active) return;
        elapsed += 16;
        stars.forEach(({ obj, phase }) => {
          const a = phase + elapsed * 0.005;
          obj.x = this.elefante.x + Math.cos(a) * 28;
          obj.y = this.elefante.y - 80 + Math.sin(a) * 8;
        });
      },
    });

    this.time.delayedCall(2200, () => {
      starTick.destroy();
      stars.forEach(({ obj }) => { try { obj.destroy(); } catch(e){} });
      if (!this.elefante || !this.elefante.active || this._elefanteMuerto) return;
      this.elefante.clearTint();
      this._elefanteState = 'caminar';
      this.elefante.play('elefante_caminar');
    });
  }

  // ─── Misil del elefante: usa misil.png, viaja horizontal puro ───────
  _lanzarBolaElefante() {
    if (!this.elefante || !this.elefante.active || this._elefanteMuerto) return;
    if (this._elefanteState === 'aturdido') return;
    if (!this.llama || this._dying) return;

    // Contador para alternar altura (0=bajo, 1=medio, 2=alto, luego repite)
    if (this._misilCount === undefined) this._misilCount = 0;
    const alturas = [-20, -60, -110];   // relativo al centro del elefante
    const offsetY = alturas[this._misilCount % alturas.length];
    this._misilCount++;

    // Dirección hacia la llama
    const dir = Math.sign(this.llama.x - this.elefante.x) || 1;

    // Nace en la boca/trompa del elefante, altura varía según contador
    const startX = this.elefante.x + dir * 70;
    const startY = this.elefante.y + offsetY;

    // La imagen es 1536×1024 → mostramos a 96×64 px (mantiene proporción 3:2)
    const misil = this.physics.add.image(startX, startY, 'misil')
      .setDisplaySize(96, 64)
      .setOrigin(0.5, 0.5)
      .setDepth(9)
      .setFlipX(dir < 0);          // voltea la imagen si va hacia la izquierda

    // Agregar al grupo PRIMERO — Phaser resetea el body al hacer add(),
    // cualquier propiedad puesta antes se pierde
    this.bolasElefante.add(misil);

    // Ahora sí configurar el body (después del add, no antes)
    misil.body.setSize(80, 58);
    misil.body.setOffset(8, 3);
    misil.body.allowGravity = false;   // SIN GRAVEDAD — viaje completamente horizontal
    misil.body.setVelocityX(dir * 220);
    misil.body.setVelocityY(0);

    // Estela de fuego en la cola del misil
    const trailTimer = this.time.addEvent({
      delay: 40,
      loop: true,
      callback: () => {
        if (!misil || !misil.active || !misil.scene) { trailTimer.remove(false); return; }
        const brasa = this.add.image(misil.x - dir * 40, misil.y + 5, 'brasa')
          .setDisplaySize(18, 18).setAlpha(0.85).setDepth(8);
        this.tweens.add({
          targets: brasa, alpha: 0, scaleX: 2.5, scaleY: 2.5,
          duration: 180, onComplete: () => brasa.destroy(),
        });
      },
    });

    // Auto-destruir tras 5 s si no impacta nada
    this.time.delayedCall(5000, () => {
      trailTimer.remove(false);
      if (misil && misil.scene) misil.destroy();
    });
  }

  _elefanteMuere() {
    if (!this.elefante || !this.elefante.active || this._elefanteMuerto) return;
    this._elefanteMuerto = true;   // bloquear update() y timers

    // Detener timer de orbes y limpiar orbes en vuelo
    if (this._bolaTimer) { this._bolaTimer.remove(); this._bolaTimer = null; }
    this.bolasElefante.getChildren().slice().forEach(r => { try { r.destroy(); } catch(e){} });

    this.elefante.body.enable = false;
    this.elefante.anims.stop();
    this.elefante.setTint(0xff4400);

    const ex = this.elefante.x;   // capturar posición antes de tweens/destroy
    const lavaY = GROUND_Y + 10;
    this.tweens.add({
      targets:  this.elefante,
      y:        lavaY,
      duration: 750,
      ease:     'Quad.easeIn',
      onComplete: () => {
        // Salpicadura de lava al entrar
        for (let i = 0; i < 8; i++) {
          const sx  = ex + Phaser.Math.Between(-50, 50);
          const dot = this.add.rectangle(sx, lavaY, 7, 7, 0xFF4400).setDepth(12);
          this.tweens.add({
            targets: dot,
            y: dot.y - Phaser.Math.Between(25, 70),
            x: dot.x + Phaser.Math.Between(-30, 30),
            alpha: 0, duration: Phaser.Math.Between(300, 650),
            ease: 'Quad.easeOut',
            onComplete: () => dot.destroy(),
          });
        }
        // Se hunde y desaparece
        this.tweens.add({
          targets:  this.elefante,
          y:        lavaY + 80,
          scaleX:   this.elefante.scaleX * 0.4,
          alpha:    0,
          duration: 420,
          ease:     'Linear',
          onComplete: () => { try { this.elefante.destroy(); } catch(e){} },
        });
      },
    });

    // Desvanece la barra de boss
    this.time.delayedCall(250, () => {
      const bars = [this._bossBar, this._bossBarBg, this._bossLabel].filter(Boolean);
      if (bars.length) {
        this.tweens.add({
          targets: bars, alpha: 0, duration: 500,
          onComplete: () => bars.forEach(b => { try { b.destroy(); } catch(e){} }),
        });
      }
    });

    // Victoria: guardar, sonido, luego arrancar caminata al castillo
    this.time.delayedCall(450, () => {
      this._playVictorySound();
      guardarPartida(
        this.registry.get('nombreJugador') || 'Anónimo',
        this.tragos || 0,
        'gano'
      );
      this._iniciarSecuenciaVictoria();
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  SECUENCIA DE VICTORIA — llama camina al castillo y entra
  // ═══════════════════════════════════════════════════════════════
  _iniciarSecuenciaVictoria() {
    // Bloquear todo input del jugador
    this._winSequence = true;

    // Detener música de fondo
    if (this.musicaFondo && this.musicaFondo.isPlaying) this.musicaFondo.stop();

    // La llama queda libre de física (la moveremos con un tween)
    this.llama.body.enable = false;
    this.llama.setVelocity(0, 0);
    // Llevar la llama al frente para que pase DELANTE del castillo
    this.llama.setDepth(10);

    // Orientar la llama hacia la derecha
    this.llama.setFlipX(false);

    // Reproducir animación de caminar según el estado de poder actual
    const walkAnim = this._powerState === 'capa' ? 'caminar_capa' : 'caminar';
    this.llama.play(walkAnim, true);

    // Anclar llama al suelo (por si saltó durante el combate)
    const llamaFloorY = GROUND_Y - 10;
    this.llama.y = llamaFloorY;

    // ── Extender límites del mundo para que la cámara llegue al castillo ──
    const CASTLE_WALK_END = (this._levelEndX || 8556) + 900;
    this.physics.world.setBounds(0, 0, CASTLE_WALK_END, H + 600);
    this.cameras.main.setBounds(0, 0, CASTLE_WALK_END, H);

    // ── Colocar el castillo a la derecha ──────────────────────────────────
    const CASTLE_X      = (this._levelEndX || 8556) + 500;
    const CASTLE_H_DISP = 210;           // alto en pantalla (px) — tamaño reducido
    const CASTLE_W_DISP = Math.round(504 / 495 * CASTLE_H_DISP);  // ≈ 215 px
    const CASTLE_Y      = GROUND_Y;      // base toca el suelo

    // Depth 3 = detrás de la llama (llama usa depth por defecto ~0 pero
    // renderiza sobre objetos estáticos; la ponemos explícitamente adelante)
    const castle = this.add.image(CASTLE_X, CASTLE_Y, 'castillo')
      .setOrigin(0.5, 1)
      .setDisplaySize(CASTLE_W_DISP, CASTLE_H_DISP)
      .setDepth(3)
      .setAlpha(0);

    // El castillo aparece con un pequeño fade-in mientras la llama se acerca
    this.tweens.add({ targets: castle, alpha: 1, duration: 600, delay: 400 });

    // ── Nubes decorativas para el camino al castillo ───────────────────────
    const extraClouds = [
      [this._levelEndX + 120, 60, 0.16, 0.3],
      [this._levelEndX + 320, 40, 0.13, 0.25],
      [this._levelEndX + 550, 75, 0.18, 0.28],
      [this._levelEndX + 750, 50, 0.14, 0.22],
    ];
    extraClouds.forEach(([cx, cy, sc, sf]) => {
      this.add.image(cx, cy, 'nube').setScale(sc).setScrollFactor(sf).setDepth(-1);
    });

    // ── Piso visible hasta el castillo ────────────────────────────────────
    const walkW  = CASTLE_X + CASTLE_W_DISP / 2 - (this._levelEndX || 8556);
    const walkCX = (this._levelEndX || 8556) + walkW / 2;
    const walkCY = H - PISO_H / 2;
    this.add.rectangle(walkCX, walkCY, walkW, PISO_H, 0x9B5E1A).setDepth(1);
    const tileScaleY = PISO_H / 268;
    this.add.tileSprite(walkCX, walkCY, walkW, PISO_H, 'suelooriginal')
      .setTileScale(tileScaleY, tileScaleY).setDepth(2);

    // ── Cielo azul de vuelta para el tramo final ──────────────────────────
    this.cameras.main.setBackgroundColor('#5C94FC');

    // ── Música de nivel completado ────────────────────────────────────────
    try {
      if (this.cache.audio.exists('completado')) {
        const sndCompletado = this.sound.add('completado', { loop: false, volume: 0.7 });
        sndCompletado.play();
      }
    } catch(e) {}

    // ── La llama camina automáticamente hacia la puerta del castillo ──────
    // La "puerta" está aproximadamente en el centro-inferior del castillo
    const DOOR_X   = CASTLE_X - 20;   // ligeramente a la izquierda del centro
    const walkDist = DOOR_X - this.llama.x;
    const walkTime = Math.max(2000, walkDist / 140 * 1000);   // ~140 px/s

    this.tweens.add({
      targets: this.llama,
      x: DOOR_X,
      y: llamaFloorY,
      duration: walkTime,
      ease: 'Linear',
      onComplete: () => this._llamaEntraCastillo(castle),
    });
  }

  // La llama llega a la puerta y "entra" al castillo
  _llamaEntraCastillo(castle) {
    // Efecto de entrada: llama se achica y desaparece dentro del castillo
    this.tweens.add({
      targets: this.llama,
      scaleX: 0,
      scaleY: 0,
      alpha: 0,
      duration: 350,
      ease: 'Quad.easeIn',
      onComplete: () => {
        try { this.llama.setVisible(false); } catch(e) {}
        this._mostrarPantallaGanaste();
      },
    });
  }

  // Pantalla final: GANASTE con confeti y botón WhatsApp grande
  _mostrarPantallaGanaste() {
    const PF = '"Press Start 2P", "Courier New", monospace';

    // Mensaje pre-escrito en el chat de WhatsApp al abrir el link
    const WA_LINK = 'https://wa.me/59175296941?text=Quiero%20reclamar%20mi%20mesa%20trivia';

    const COLORS = [0xFFD700, 0xFF4444, 0x44FF88, 0x44AAFF, 0xFF88FF, 0xFF8800];

    // ── Overlay oscuro ────────────────────────────────────────────
    const overlay = this.add.rectangle(W / 2, H / 2, W, H, 0x050510, 0)
      .setScrollFactor(0).setDepth(600);

    this.tweens.add({
      targets: overlay, fillAlpha: 0.88, duration: 500,
      onComplete: () => {

        // ── ¡GANASTE! ─────────────────────────────────────────────
        const win = this.add.text(W / 2, 40, '¡GANASTE!', {
          fontFamily: PF, fontSize: '38px', color: '#FFD700',
          stroke: '#000', strokeThickness: 8,
          shadow: { offsetX: 0, offsetY: 0, color: '#FFD700', blur: 18, fill: true },
        }).setOrigin(0.5).setScrollFactor(0).setDepth(615).setAlpha(0);
        this.tweens.add({ targets: win, alpha: 1, y: 54, duration: 560, ease: 'Back.easeOut' });

        // ── Subtítulo ─────────────────────────────────────────────
        const sub = this.add.text(W / 2, 100,
          '¡Derrotaste al elefante!',
          { fontFamily: PF, fontSize: '11px', color: '#ccffcc', stroke: '#000', strokeThickness: 3 }
        ).setOrigin(0.5).setScrollFactor(0).setDepth(615).setAlpha(0);
        this.tweens.add({ targets: sub, alpha: 1, duration: 400, delay: 300 });

        // ── Caja del premio ───────────────────────────────────────
        const prizeBox = this.add.rectangle(W / 2, 170, W - 40, 90, 0x0a0a00)
          .setStrokeStyle(4, 0xFFD700).setScrollFactor(0).setDepth(611).setAlpha(0);
        this.tweens.add({ targets: prizeBox, alpha: 1, duration: 350, delay: 450 });

        const prizeLabel = this.add.text(W / 2, 152,
          '🏆  ¡GANASTE UNA MESA TRIVIA!  🏆',
          { fontFamily: PF, fontSize: '13px', color: '#FFD700', stroke: '#000', strokeThickness: 4 }
        ).setOrigin(0.5).setScrollFactor(0).setDepth(616).setAlpha(0);
        this.tweens.add({ targets: prizeLabel, alpha: 1, duration: 350, delay: 500 });
        this.tweens.add({ targets: prizeLabel, alpha: 0.55, yoyo: true, repeat: -1, duration: 850, delay: 1100 });

        const prizeInstr = this.add.text(W / 2, 187,
          'Ingresá al link y reclamá tu mesa',
          { fontFamily: PF, fontSize: '9px', color: '#ffffff', stroke: '#000', strokeThickness: 2 }
        ).setOrigin(0.5).setScrollFactor(0).setDepth(616).setAlpha(0);
        this.tweens.add({ targets: prizeInstr, alpha: 1, duration: 350, delay: 580 });

        // ── Botón WhatsApp — GRANDE para celu ─────────────────────
        const btnY = 285;
        const btnW = W - 60;   // casi todo el ancho del canvas
        const btnH = 72;

        // Sombra
        this.add.rectangle(W / 2 + 4, btnY + 5, btnW, btnH, 0x000000, 0.55)
          .setScrollFactor(0).setDepth(611);

        // Fondo amarillo
        const btnBg = this.add.rectangle(W / 2, btnY, btnW, btnH, 0xFFD700)
          .setStrokeStyle(3, 0xa08000).setScrollFactor(0).setDepth(612).setAlpha(0)
          .setInteractive({ useHandCursor: true });
        this.tweens.add({ targets: btnBg, alpha: 1, duration: 400, delay: 750 });

        // Línea superior brillante (efecto 3D)
        const btnShine = this.add.rectangle(W / 2, btnY - btnH / 2 + 6, btnW - 6, 6, 0xffffff, 0.28)
          .setScrollFactor(0).setDepth(613).setAlpha(0);
        this.tweens.add({ targets: btnShine, alpha: 1, duration: 400, delay: 750 });

        const btnTxt = this.add.text(W / 2, btnY,
          '💬  RECLAMAR MI MESA',
          { fontFamily: PF, fontSize: '14px', color: '#000000',
            stroke: '#806000', strokeThickness: 2 }
        ).setOrigin(0.5).setScrollFactor(0).setDepth(614).setAlpha(0);
        this.tweens.add({ targets: btnTxt, alpha: 1, duration: 400, delay: 750 });

        const btnSub = this.add.text(W / 2, btnY + 24,
          'Abrir WhatsApp →',
          { fontFamily: PF, fontSize: '8px', color: '#333300', stroke: '#806000', strokeThickness: 2 }
        ).setOrigin(0.5).setScrollFactor(0).setDepth(614).setAlpha(0);
        this.tweens.add({ targets: btnSub, alpha: 1, duration: 400, delay: 850 });

        // Pulso de atención en el botón
        this.tweens.add({
          targets: [btnBg, btnTxt, btnSub, btnShine],
          scaleX: 1.025, scaleY: 1.025,
          yoyo: true, repeat: -1, duration: 750, delay: 1400,
          ease: 'Sine.easeInOut',
        });

        btnBg.on('pointerover',  () => { btnBg.setFillStyle(0xFFE840); });
        btnBg.on('pointerout',   () => { btnBg.setFillStyle(0xFFD700); });
        btnBg.on('pointerdown',  () => {
          btnBg.setFillStyle(0xcc9900);
          btnBg.setScale(0.97); btnTxt.setScale(0.97); btnSub.setScale(0.97);
        });
        btnBg.on('pointerup', () => {
          btnBg.setFillStyle(0xFFD700);
          btnBg.setScale(1); btnTxt.setScale(1); btnSub.setScale(1);
          window.open(WA_LINK, '_blank');
        });

        // ── Texto reinicio ────────────────────────────────────────
        const restart = this.add.text(W / 2, H - 18,
          'El juego se reinicia en unos segundos...',
          { fontFamily: PF, fontSize: '6px', color: '#666688', stroke: '#000', strokeThickness: 1 }
        ).setOrigin(0.5).setScrollFactor(0).setDepth(615).setAlpha(0);
        this.tweens.add({ targets: restart, alpha: 1, duration: 400, delay: 1500 });

        // ── Confeti ───────────────────────────────────────────────
        const spawnConfeti = (count, delayBase) => {
          for (let i = 0; i < count; i++) {
            const col = COLORS[i % COLORS.length];
            const cx  = Phaser.Math.Between(30, W - 30);
            const sy  = Phaser.Math.Between(-50, 60);
            const dot = this.add.rectangle(cx, sy,
              Phaser.Math.Between(6, 14), Phaser.Math.Between(5, 11), col)
              .setScrollFactor(0).setDepth(609);
            this.tweens.add({
              targets: dot,
              y: sy + Phaser.Math.Between(220, 520),
              x: cx + Phaser.Math.Between(-100, 100),
              angle: Phaser.Math.Between(-720, 720),
              alpha: 0,
              duration: Phaser.Math.Between(1000, 2600),
              delay: delayBase + Phaser.Math.Between(0, 600),
              ease: 'Quad.easeIn',
              onComplete: () => dot.destroy(),
            });
          }
        };
        spawnConfeti(60, 0);
        this.time.delayedCall(1300, () => spawnConfeti(40, 0));
        this.time.delayedCall(3000, () => spawnConfeti(30, 0));

        // ── Reiniciar ─────────────────────────────────────────────
        this.time.delayedCall(14000, () => {
          this.physics.world.colliders.destroy();
          this.physics.world.pause();
          this.scene.restart();
        });
      },
    });
  }

  // Sonido de golpe al elefante: thud grave + chasquido agudo
  _playStompElephantSound() {
    try {
      const ctx = this.sound.context;
      if (!ctx || ctx.state === 'suspended') return;
      const t = ctx.currentTime;
      // Golpe grave
      const o1 = ctx.createOscillator(); const g1 = ctx.createGain();
      o1.connect(g1); g1.connect(ctx.destination);
      o1.type = 'sine';
      o1.frequency.setValueAtTime(160, t);
      o1.frequency.exponentialRampToValueAtTime(42, t + 0.30);
      g1.gain.setValueAtTime(0.55, t);
      g1.gain.exponentialRampToValueAtTime(0.001, t + 0.36);
      o1.start(t); o1.stop(t + 0.40);
      // Chasquido agudo encima
      const o2 = ctx.createOscillator(); const g2 = ctx.createGain();
      o2.connect(g2); g2.connect(ctx.destination);
      o2.type = 'square';
      o2.frequency.setValueAtTime(820, t);
      o2.frequency.exponentialRampToValueAtTime(200, t + 0.08);
      g2.gain.setValueAtTime(0.22, t);
      g2.gain.exponentialRampToValueAtTime(0.001, t + 0.10);
      o2.start(t); o2.stop(t + 0.12);
    } catch(e) {}
  }

  // Fanfarria de victoria ascendente
  _playVictorySound() {
    try {
      const ctx = this.sound.context;
      if (!ctx || ctx.state === 'suspended') return;
      const t = ctx.currentTime;
      [
        [523,0.00,0.12],[659,0.13,0.12],[784,0.26,0.12],
        [1047,0.39,0.35],[784,0.74,0.10],[1047,0.84,0.55],
      ].forEach(([f,s,d]) => {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.type = 'square';
        o.frequency.setValueAtTime(f, t + s);
        g.gain.setValueAtTime(0.20, t + s);
        g.gain.exponentialRampToValueAtTime(0.001, t + s + d);
        o.start(t + s); o.stop(t + s + d + 0.02);
      });
    } catch(e) {}
  }

  // ═══════════════════════════════════════════════════════════════

  _respawn() {
    if (this._dying) return;   // evita doble llamada
    this._dying = true;

    // Limpiar bolas de fuego en vuelo
    if (this.fireballs) {
      this.fireballs.getChildren().forEach(fb => {
        if (fb.active) this._destroyFireball(fb);
      });
    }

    // Detener música
    if (this.musicaFondo && this.musicaFondo.isPlaying) this.musicaFondo.stop();

    // Sonido de muerte sintetizado (estilo Mario)
    this._playDeathSound();

    // Congelar física — solo la llama hace su animación de muerte
    this.physics.world.pause();
    this.llama.body.enable = false;
    this.llama.anims.stop();

    const startY = this.llama.y;

    // ① Sube un poco  →  ② Cae fuera de pantalla  →  ③ Pantalla de vidas
    this.tweens.add({
      targets: this.llama,
      y: startY - 150,
      duration: 420,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: this.llama,
          y: H + 180,
          duration: 680,
          ease: 'Sine.easeIn',
          onComplete: () => this._mostrarPantallaVidas(),
        });
      },
    });
  }

  _mostrarPantallaVidas() {
    this.vidas = Math.max(0, this.vidas - 1);
    this.vidasText.setText(`? ×${this.vidas}`);

    // Fondo negro con fade
    const overlay = this.add.rectangle(W / 2, H / 2, W, H, 0x000000)
      .setScrollFactor(0).setDepth(500).setAlpha(0);

    this.tweens.add({
      targets: overlay, alpha: 1, duration: 450,
      onComplete: () => {
        const PF = '"Press Start 2P", "Courier New", monospace';

        if (this.vidas <= 0) {
          // GAME OVER → guardar en Supabase, luego reiniciar
          guardarPartida(
            this.registry.get('nombreJugador') || 'Anónimo',
            this.tragos || 0,
            'perdio'
          );
          this.add.text(W / 2, H / 2, 'GAME OVER',
            { fontFamily: PF, fontSize: '28px', color: '#ffffff' }
          ).setOrigin(0.5).setScrollFactor(0).setDepth(501);
          this.time.delayedCall(2800, () => {
            // Limpiar todos los colliders antes de reiniciar
            // para evitar "Cannot read properties of undefined (reading 'size')"
            this.physics.world.colliders.destroy();
            this.physics.world.pause();
            this.scene.restart();
          });

        } else {
          // Muestra llama × vidas restantes, luego continúa el juego
          const txt1 = this.add.text(W / 2, H / 2 - 36, 'LLAMA',
            { fontFamily: PF, fontSize: '16px', color: '#FFD700' }
          ).setOrigin(0.5).setScrollFactor(0).setDepth(501);
          const txt2 = this.add.text(W / 2, H / 2 + 14, `\u00D7  ${this.vidas}`,
            { fontFamily: PF, fontSize: '24px', color: '#ffffff' }
          ).setOrigin(0.5).setScrollFactor(0).setDepth(501);

          // setTimeout nativo: garantizado sin depender de Phaser timer/tween
          this._respawnTimer = setTimeout(() => {
            // Destruir overlay negro Y los textos
            try { overlay.destroy(); } catch(e) {}
            try { txt1.destroy(); } catch(e) {}
            try { txt2.destroy(); } catch(e) {}


            // Fade-from-black usando la cámara (no depende de tweens ni timers de Phaser)
            this.cameras.main.fadeFrom(450, 0, 0, 0);
            this.cameras.main.setBackgroundColor('#5C94FC');
            this._skyStart = undefined;

            // Resetear llama al inicio del nivel — vuelve a forma pequeña
            this._powerState = 'small';
            this.llama.setTexture('idle', this.IDLE_FRAME);
            this.llama.setScale(LLAMA_SCALE_SMALL);
            this._applyLlamaHitbox();
            this.llama.setVisible(true);
            this.llama.setPosition(80, GROUND_Y - 10);
            this.llama.setVelocity(0, 0);
            this.llama.body.enable = true;
            this._subiendo = false;
            this._state    = 'idle';

            // Reanudar juego
            this.physics.world.resume();
            if (this.musicaFondo && !this.musicaFondo.isPlaying) this.musicaFondo.play();
            this._dying = false;
          }, 2500);
        }
      },
    });
  }

  _playDeathSound() {
    try {
      const ctx = this.sound.context;
      if (!ctx) return;
      const t = ctx.currentTime;
      // Secuencia descendente estilo Mario muerte
      [
        [494, 0.00, 0.12],
        [370, 0.12, 0.12],
        [311, 0.24, 0.12],
        [330, 0.36, 0.16],
        [277, 0.52, 0.16],
        [294, 0.68, 0.16],
        [247, 0.84, 0.55],
      ].forEach(([freq, start, dur]) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, t + start);
        gain.gain.setValueAtTime(0.22, t + start);
        gain.gain.exponentialRampToValueAtTime(0.001, t + start + dur);
        osc.start(t + start);
        osc.stop(t + start + dur + 0.05);
      });
    } catch (e) { /* silencioso si el audio no está listo */ }
  }

  _doJump() {
    if (this.llama.body.blocked.down) {
      this.llama.setVelocityY(-530);
      this._subiendo   = true;
      this._jumpHeldMs = 0;      // reinicia contador de tiempo mantenido
      this.llama.play(this._powerState === 'capa' ? 'saltar_capa' : 'saltar');
      if (this.sonidoSalto) this.sonidoSalto.play();
    }
  }

  update() {
    // Mientras el título está activo, no procesar controles
    if (this._titleActive) return;
    // Durante la secuencia de victoria, bloquear todo input
    if (this._winSequence) return;

    // ── Transición de cielo: azul → negro al acercarse al boss ──
    if (this._skyStart !== undefined) {
      const t = Phaser.Math.Clamp(
        (this.llama.x - this._skyStart) / (this._skyEnd - this._skyStart), 0, 1
      );
      // Sunset: azul → naranja → magenta → púrpura oscuro (en vez de negro)
      let r, g, b;
      if (t < 0.40) {
        const s = t / 0.40;
        r = Math.round(0x5C + (0xFF - 0x5C) * s);
        g = Math.round(0x94 + (0x60 - 0x94) * s);
        b = Math.round(0xFC + (0x10 - 0xFC) * s);
      } else if (t < 0.75) {
        const s = (t - 0.40) / 0.35;
        r = Math.round(0xFF + (0xB0 - 0xFF) * s);
        g = Math.round(0x60 + (0x18 - 0x60) * s);
        b = Math.round(0x10 + (0x60 - 0x10) * s);
      } else {
        const s = (t - 0.75) / 0.25;
        r = Math.round(0xB0 + (0x20 - 0xB0) * s);
        g = Math.round(0x18 + (0x06 - 0x18) * s);
        b = Math.round(0x60 + (0x35 - 0x60) * s);
      }
      this.cameras.main.setBackgroundColor(
        '#' + r.toString(16).padStart(2,'0') + g.toString(16).padStart(2,'0') + b.toString(16).padStart(2,'0')
      );
    }

    // ── Muerte por caída en hueco ─────────────────────────────
    if (this.llama.y > H + 80) {
      this._respawn();
      return;
    }

    // ── Detección misil→llama (manual, independiente de hitboxes) ──
    this._checkMisiles();

    const onGround  = this.llama.body.blocked.down;

    // Resetear flag de subida cuando la llama empieza a bajar o toca suelo
    if (this._subiendo && (this.llama.body.velocity.y >= 0 || onGround)) {
      this._subiendo = false;
    }

    const moveLeft  = this.cursors.left.isDown  || this.touch.dirX === -1 || this.mobileControls.left;
    const moveRight = this.cursors.right.isDown || this.touch.dirX ===  1 || this.mobileControls.right;
    const jumpNow   =
      Phaser.Input.Keyboard.JustDown(this.spaceKey) ||
      Phaser.Input.Keyboard.JustDown(this.cursors.up);

    if      (moveLeft)  { this.llama.setVelocityX(-230); this.llama.setFlipX(true);  }
    else if (moveRight) { this.llama.setVelocityX( 230); this.llama.setFlipX(false); }
    else                { this.llama.setVelocityX(0); }

    if (jumpNow) this._doJump();

    // ── Disparo de bola de fuego (tecla B) ─────────────────────────────────
    if (Phaser.Input.Keyboard.JustDown(this.keyB)) this._dispararBola();

    // ── Estado visual del botón B (activo solo con Flor de Fuego) ──────────
    const _btnF = document.getElementById('btn-fire');
    if (_btnF) _btnF.classList.toggle('ctrl-b--disabled', this._powerState !== 'capa');

    // ── Trail y detección de impacto lateral / salida de pantalla ───────────
    this.fireballs.getChildren().forEach(fb => {
      if (!fb.active) return;

      // Matar bolas que salen de los límites del mundo (caen en huecos entre
      // plataformas, vuelan demasiado lejos, etc.). Esto libera el slot
      // inmediatamente sin esperar el timer de 1.8 s.
      if (fb.y > H + 80 || fb.x < -150 || fb.x > WORLD_W + 150) {
        this._destroyFireball(fb);
        return;
      }

      // Impacto lateral contra pared → explota
      if (fb.body.blocked.left || fb.body.blocked.right) {
        this._explotar(fb.x, fb.y);
        this._destroyFireball(fb);
        return;
      }

      // Estela de fuego: chispa pequeña cada ~3 frames
      if (Phaser.Math.Between(0, 2) === 0) {
        const brasa = this.add.image(fb.x, fb.y, 'brasa')
          .setDisplaySize(10, 10).setAlpha(0.75).setDepth(7);
        this.tweens.add({
          targets: brasa, alpha: 0, scaleX: 2.5, scaleY: 2.5,
          duration: 145, onComplete: () => brasa.destroy(),
        });
      }
    });

    // ── Comportamiento del elefante boss ──────────────────────────
    if (this.elefante && this.elefante.active && !this._dying && !this._elefanteMuerto) {

      // Esquivar bolas de fuego: si viene una, salta para evitarla
      if (this._elefanteState === 'caminar' && this.elefante.body.blocked.down) {
        const incoming = this.fireballs.getChildren().find(fb => {
          if (!fb.active || !fb.body) return false;
          const dist    = Math.abs(fb.x - this.elefante.x);
          const heading = (fb.body.velocity.x > 0 && fb.x < this.elefante.x) ||
                          (fb.body.velocity.x < 0 && fb.x > this.elefante.x);
          return dist < 190 && heading;
        });
        if (incoming) {
          this._elefanteState = 'saltar';
          this.elefante.play('elefante_saltar');
          this.elefante.setVelocityX(0);
          this.elefante.setVelocityY(-430);
        }
      }

      // Patrulla normal (solo estado 'caminar')
      if (this._elefanteState === 'caminar') {
        if (this.elefante.x <= this._elefanteXIzq) this._elefanteDir = 1;
        else if (this.elefante.x >= this._elefanteXDer) this._elefanteDir = -1;
        this.elefante.setVelocityX(this._elefanteDir * this._elefanteSpeed);
        this.elefante.setFlipX(this._elefanteDir > 0);
      }
      // 'saltar' / 'aturdido': física libre / sin movimiento horizontal propio
    }

    // ── Patrulla de los goombas: dan la vuelta al chocar o al llegar al borde ──
    const EDGE = 36; // margen en px antes del borde para girar
    this.enemies.children.each((g) => {
      if (!g.active || !g.getData('vivo')) return;
      // Detección de borde: buscar en qué segmento de piso está el goomba
      const seg = this._floorSegs.find(([x1, x2]) => g.x >= x1 - 10 && g.x <= x2 + 10);
      if (seg) {
        const [x1, x2] = seg;
        if (g.getData('dir') === 1 && g.x >= x2 - EDGE) {
          g.setData('dir', -1);
          g.setFlipX(true);
        } else if (g.getData('dir') === -1 && g.x <= x1 + EDGE) {
          g.setData('dir', 1);
          g.setFlipX(false);
        }
      }
      // También girar al chocar con tubo u obstáculo
      if (g.body.blocked.right || g.body.blocked.left) {
        const nuevaDir = g.body.blocked.right ? -1 : 1;
        g.setData('dir', nuevaDir);
        g.setFlipX(nuevaDir < 0);
      }
      g.setVelocityX(g.getData('dir') * GOOMBA_SPEED);
    });

    // ── Animaciones ──────────────────────────────────────────
    // La animación a usar depende del estado de poder (normal vs capa).
    const esCapa = this._powerState === 'capa';
    const CAPA_IDLE_FRAME = esCapa ? this.textures.get('quietocapa').getFrameNames()[0] : null;

    if (!onGround) {
      if (this._state !== 'saltar') {
        this._state = 'saltar';
        this.llama.play(esCapa ? 'saltar_capa' : 'saltar');
      }
    } else if (moveLeft || moveRight) {
      if (this._state !== 'caminar') {
        this._state = 'caminar';
        this.llama.play(esCapa ? 'caminar_capa' : 'caminar');
      }
    } else {
      if (this._state !== 'idle') {
        this._state = 'idle';
        this.llama.anims.stop();
        if (esCapa) {
          this.llama.setTexture('quietocapa', CAPA_IDLE_FRAME);
        } else {
          this.llama.setTexture('idle', this.IDLE_FRAME);
        }
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  SISTEMA DE BOLAS DE FUEGO
  // ══════════════════════════════════════════════════════════════════════════

  /** Genera la textura canvas de las bolas de fuego (glow radial naranja/blanco). */
  _createFireballTexture() {
    const sz = 20;
    const c  = document.createElement('canvas');
    c.width = c.height = sz;
    const ctx = c.getContext('2d');
    const grd = ctx.createRadialGradient(sz/2, sz/2, 1, sz/2, sz/2, sz/2);
    grd.addColorStop(0,    '#FFFFFF');
    grd.addColorStop(0.22, '#FFFF88');
    grd.addColorStop(0.55, '#FF6600');
    grd.addColorStop(1,    'rgba(255,40,0,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(sz/2, sz/2, sz/2, 0, Math.PI * 2);
    ctx.fill();
    if (this.textures.exists('fireball')) this.textures.remove('fireball');
    this.textures.addCanvas('fireball', c);
  }

  // _crearTexturaOrbElefante eliminado — se usa misil.png

  /** Genera textura para brasas/chispas del trail y explosiones. */
  _crearTexturaBrasa() {
    const sz = 8;
    const c  = document.createElement('canvas');
    c.width = c.height = sz;
    const ctx = c.getContext('2d');
    const grd = ctx.createRadialGradient(sz/2, sz/2, 0, sz/2, sz/2, sz/2);
    grd.addColorStop(0,   'rgba(255,220,80,1)');
    grd.addColorStop(0.5, 'rgba(255,80,0,0.75)');
    grd.addColorStop(1,   'rgba(255,40,0,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(sz/2, sz/2, sz/2, 0, Math.PI * 2);
    ctx.fill();
    if (this.textures.exists('brasa')) this.textures.remove('brasa');
    this.textures.addCanvas('brasa', c);
  }

  /** Registra todos los colliders de las bolas de fuego con el mundo. */
  _setupFireballColliders() {
    // Rebote en piso (cada segmento físico).
    // NOTA: Phaser puede invertir los args (a, b) cuando el piso es un Rectangle
    // estático; _rebotar detecta cuál de los dos es la bola mediante contains().
    this.floorBodies.forEach(floor =>
      this.physics.add.collider(this.fireballs, floor, (a, b) => this._rebotar(a, b))
    );
    // Rebote en escaleras y tiles (como en Super Mario)
    this.physics.add.collider(this.fireballs, this.stairTiles, (a, b) => this._rebotar(a, b));
    // Helper: identifica cuál de los dos args del callback pertenece al grupo fireballs.
    // Phaser puede invertir el orden cuando uno de los objetos es estático.
    const _getBall = (a, b) =>
      (a && this.fireballs.contains(a)) ? a
      : (b && this.fireballs.contains(b)) ? b
      : null;

    // Desaparece al tocar tubos
    this.physics.add.collider(this.fireballs, this.tubes, (a, b) => {
      const ball = _getBall(a, b);
      if (!ball || !ball.active) return;
      this._explotar(ball.x, ball.y);
      this._destroyFireball(ball);
    });
    // Desaparece al tocar ladrillos
    this.physics.add.collider(this.fireballs, this.bricks, (a, b) => {
      const ball = _getBall(a, b);
      if (!ball || !ball.active) return;
      this._explotar(ball.x, ball.y);
      this._destroyFireball(ball);
    });
    // Mata a los goombas
    this.physics.add.overlap(this.fireballs, this.enemies, (a, b) => {
      const ball   = _getBall(a, b);
      const goomba = (ball === a) ? b : a;
      if (!ball || !ball.active) return;
      if (!goomba || !goomba.active || !goomba.getData('vivo')) return;
      const bx = ball.x, by = ball.y;
      this._destroyFireball(ball);
      this._explotar(bx, by);
      this._playImpactSound();
      this._matarGoomba(goomba);
      this.tragos += 1;
      this.tragoText.setText(`🪙 x${this.tragos}`);
    });
    // Bola de fuego impacta al elefante → lo daña (boss 3 HP)
    this.physics.add.overlap(this.fireballs, this.elefante, (a, b) => {
      const ball = _getBall(a, b);
      if (!ball || !ball.active) return;
      if (!this.elefante || !this.elefante.active) return;
      this._explotar(ball.x, ball.y);
      this._destroyFireball(ball);
      this._playImpactSound();
      this._elefanteRecibirGolpe();
    });
  }

  /**
   * Dispara una bola de fuego desde la posición de la llama.
   * Solo actúa si _powerState === 'capa' (Flor de Fuego recogida).
   * Usa el patrón oficial Phaser 3: enableBody(true, x, y, true, true)
   * que llama body.reset() internamente → sincroniza posición, borra
   * velocidades residuales y evita colisiones fantasma en el primer frame.
   */
  _dispararBola() {
    if (this._powerState !== 'capa') return;

    const now = this.time.now;
    if (now - this._lastFireTime < 380) return;   // cooldown: 1 bola cada 380 ms
    this._lastFireTime = now;

    // Buscar bola inactiva en el pool (máx 8 en vuelo simultáneo)
    const fb = this.fireballs.getFirstDead(false);
    if (!fb) return;

    const dir  = this.llama.flipX ? -1 : 1;
    const spawnX = this.llama.x + dir * 28;
    const spawnY = this.llama.y - 38;

    // enableBody(reset, x, y, enableGameObject, showGameObject)
    // reset=true → body.reset(x,y) limpia estado interno del body antes de reusar
    fb.enableBody(true, spawnX, spawnY, true, true);
    fb.setAlpha(1).setAngle(0).setDepth(8);
    fb.setData('bounces', 0);
    fb.setData('lastBounce', 0);
    fb.setData('dir', dir);

    // Velocidad inicial: diagonal hacia adelante y ligeramente arriba
    fb.body.setVelocity(dir * 280, -210);

    // Rotación continua para efecto "bola giratoria"
    this.tweens.killTweensOf(fb);
    this.tweens.add({
      targets: fb, angle: dir > 0 ? 360 : -360,
      duration: 380, repeat: -1, ease: 'Linear',
    });

    // Auto-destruir si supera 1.8 s de vida (libera el slot rápido).
    // El ID del timer se almacena en la bola para cancelarlo si muere antes.
    const lifeTimer = this.time.delayedCall(1800, () => {
      if (fb.active && fb.getData('timerId') === lifeTimer) {
        this._explotar(fb.x, fb.y);
        this._destroyFireball(fb);
      }
    });
    fb.setData('timerId', lifeTimer);

    // Micro-squeeze en la llama: sensación visual de lanzamiento
    const sc = LLAMA_SCALE_CAPA;
    this.tweens.add({
      targets: this.llama,
      scaleX: sc * 1.18, scaleY: sc * 0.84,
      duration: 70, yoyo: true, ease: 'Power2',
    });

    this._playFireSound();
  }

  /**
   * Devuelve una bola al pool usando disableBody(true, true) — patrón oficial
   * Phaser 3 para object pools con arcade physics.
   */
  _destroyFireball(fb) {
    if (!fb || !fb.active) return;
    this.tweens.killTweensOf(fb);
    // Cancelar timer de vida para que no mate el slot cuando se reutilice
    const timer = fb.getData('timerId');
    if (timer) { timer.remove(false); fb.setData('timerId', null); }
    // disableBody(disableGameObject, hideGameObject) → body.enable=false + setActive(false) + setVisible(false)
    fb.disableBody(true, true);
  }

  /**
   * Lógica de rebote estilo Super Mario Bros:
   * cada rebote es más bajo que el anterior (amortiguación del 38%).
   * Tras 5 rebotes la bola desaparece con explosión.
   *
   * Recibe (a, b) desde el collider — Phaser puede invertir el orden
   * cuando el piso es un Rectangle estático, así que detectamos cuál
   * de los dos pertenece al grupo fireballs.
   */
  _rebotar(a, b) {
    // Identificar cuál argumento es la bola de fuego
    const ball = (a && this.fireballs.contains(a)) ? a
               : (b && this.fireballs.contains(b)) ? b
               : null;
    if (!ball || !ball.active || !ball.body || !ball.body.enable) return;

    const now = this.time.now;
    if (now - (ball.getData('lastBounce') || 0) < 80) return;  // debounce por frame
    ball.setData('lastBounce', now);

    const bounces = (ball.getData('bounces') || 0) + 1;
    ball.setData('bounces', bounces);

    if (bounces >= 5) {
      this._explotar(ball.x, ball.y);
      this._destroyFireball(ball);
      return;
    }

    const dir = ball.getData('dir') || 1;

    // Rebotes más altos y suaves
    const vy = -250 * Math.pow(0.82, bounces);
    const vx = 280 * Math.pow(0.88, bounces);

    ball.body.setVelocityX(dir * vx);
    ball.body.setVelocityY(vy);
  }

  // Detección manual misil→llama: compara X e Y visualmente.
  // Solo hace daño si el rectángulo del misil se solapa con el cuerpo de la llama.
  _checkMisiles() {
    if (!this.bolasElefante || this._dying || this._invincible) return;

    // Rango horizontal de la llama (mitad del ancho visible)
    const lx      = this.llama.x;
    const lHalfW  = this.llama.displayWidth  * 0.40;

    // Rango vertical de la llama:
    // llama.y = base de los pies (origin 0.5,1), el cuerpo sube desde ahí.
    // Se ignora ~15% superior (zona transparente del sprite).
    const lBottom = this.llama.y;
    const lTop    = lBottom - this.llama.displayHeight * 0.85;

    this.bolasElefante.getChildren().forEach(orb => {
      if (!orb || !orb.active || !orb.scene) return;

      // ── Check X ──────────────────────────────────────────────
      if (Math.abs(orb.x - lx) > lHalfW + orb.displayWidth * 0.45) return;

      // ── Check Y ──────────────────────────────────────────────
      // orb tiene origin (0.5,0.5), su cuerpo ocupa ±45% de su alto.
      const orbHalfH  = orb.displayHeight * 0.45;
      const orbTop    = orb.y - orbHalfH;
      const orbBottom = orb.y + orbHalfH;
      if (orbBottom < lTop || orbTop > lBottom) return; // pasa por encima o debajo

      // ── Impacto ───────────────────────────────────────────────
      const bx = orb.x, by = orb.y;
      orb.destroy();
      this._explotar(bx, by);
      this._takeDamage();
    });
  }

  /** Animación de explosión de fuego al impactar (8 chispas + flash central). */
  _explotar(x, y) {
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const sp = this.add.image(x, y, 'brasa')
        .setDisplaySize(11, 11).setAlpha(1).setDepth(12);
      this.tweens.add({
        targets: sp,
        x: x + Math.cos(angle) * 34,
        y: y + Math.sin(angle) * 34,
        alpha: 0, scaleX: 0.2, scaleY: 0.2,
        duration: 260, ease: 'Power2',
        onComplete: () => sp.destroy(),
      });
    }
    const flash = this.add.image(x, y, 'fireball')
      .setDisplaySize(24, 24).setAlpha(0.95).setDepth(13);
    this.tweens.add({
      targets: flash, scaleX: 3.6, scaleY: 3.6, alpha: 0,
      duration: 210, ease: 'Power1',
      onComplete: () => flash.destroy(),
    });
  }

  /** Sonido sintetizado de disparo (sawtooth retro descendente). */
  _playFireSound() {
    try {
      const ctx = this.sound.context;
      if (!ctx || ctx.state === 'suspended') return;
      const t   = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(920, t);
      osc.frequency.exponentialRampToValueAtTime(190, t + 0.15);
      gain.gain.setValueAtTime(0.13, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.19);
      osc.start(t); osc.stop(t + 0.22);
    } catch(e) {}
  }

  /** Sonido sintetizado de impacto (ruido blanco breve). */
  _playImpactSound() {
    try {
      const ctx = this.sound.context;
      if (!ctx || ctx.state === 'suspended') return;
      const t   = ctx.currentTime;
      const len = Math.ceil(ctx.sampleRate * 0.09);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d   = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.28;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      src.connect(gain); gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.38, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      src.start(t);
    } catch(e) {}
  }
}

// ─────────────────────────────────────────────────────
//  Config y arranque
// ─────────────────────────────────────────────────────
const config = {
  type: Phaser.AUTO,
  width:  W,
  height: H,
  parent: 'game-container',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width:  W,
    height: H,
  },
  physics: {
    default: 'arcade',
    arcade: { gravity: { y: 800 }, debug: false },
  },
  scene: [PreloadScene, NameScene, TitleScene, GameScene],
};

new Phaser.Game(config);
