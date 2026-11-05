#!/usr/bin/env python3
"""Arma el video final: tomas con zoom suave, transiciones, voz y subtítulos."""
import json, subprocess, sys, os, re

LAYOUT = sys.argv[1] if len(sys.argv) > 1 else 'h'
V = LAYOUT == 'v'
W, H = (1080, 1920) if V else (1920, 1080)
FPS, T, PAD = 30, 0.35, 0.6
ROOT = '/home/user/video'
OUT = f'{ROOT}/out3/{LAYOUT}'
os.makedirs(OUT, exist_ok=True)
NAME = f'{ROOT}/soytechno-pedidos-cashea-movimiento-' + ('vertical-9x16' if V else 'horizontal-16x9') + '.mp4'

TEXT = {
 1: "Mil pedidos de Cashea al día. Más de cuatro mil en temporada alta. Y cada uno se procesa a mano. Eso tiene un costo: tiempo, errores y clientes esperando. Hoy, eso cambia.",
 2: "Todo comienza con el correo de Cashea. El sistema lo lee al instante: cliente, producto, total sin IVA y pago inicial. Sin copiar. Sin errores.",
 3: "En segundos, el cliente recibe su pedido por WhatsApp, con un enlace para continuar.",
 4: "Desde su teléfono, elige su ciudad y ve solo las opciones de entrega que le corresponden. Si tiene inicial, reporta su pago móvil en campos guiados.",
 5: "El pedido llega directo a la caja correcta. Cada cajero toma el siguiente, y nunca dos personas atienden el mismo pedido. Verifica el pago en BNC, y factura.",
 6: "Si alguien intenta usar una referencia de pago que ya existe, el sistema la bloquea.",
 7: "¿Y si el equipo no está en la tienda? Caja lo envía a Ajuste con un clic. Si viene de Lechería, el cliente sabe el día exacto en que llega, y decide si espera. Si se trae de otra tienda de Caracas, es un traslado interno: el cliente solo recibe aviso si hay retraso.",
 8: "Si está agotado, Ajuste le ofrece alternativas. El cliente elige desde su teléfono, y el pedido vuelve solo a la caja. Y los productos que más se agotan quedan marcados, para apagarlos en Cashea.",
 9: "Antes de salir, Despacho toma fotos de la factura y del equipo. Cada pedido queda respaldado.",
 10: "Y Supervisión lo ve todo, en tiempo real: en qué paso está cada pedido, quién lo atendió y a qué hora.",
 11: "Menos asesores. Menos errores. Respuesta inmediata. Soytechno: pedidos Cashea, en automático.",
}
NS = len(TEXT)

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr[-2000:]); sys.exit(1)
    return r.stdout

def dur(f):
    return float(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).strip())

RS = {r['scene']: r for r in json.load(open(f'{ROOT}/rec/{LAYOUT}/scenes.json'))}
audio = {s: f'{ROOT}/audio3/escena-{s:02d}.mp3' for s in range(1, NS + 1)}
adur = {s: dur(audio[s]) for s in audio}
sdur = {s: max(adur[s] + PAD, RS[s]['dur'] * 0.75) for s in audio}

# 1) cada escena: ajustar la velocidad de la grabación a su duración
clips = []
for i, s in enumerate(range(1, NS + 1)):
    raw = RS[s]['dur']; tgt = sdur[s]; L = tgt + (T if s < NS else 0)
    f = min(max(tgt / raw, 0.6), 1.15)
    hold = max(0.0, L - raw * f) + 0.5
    out = f'{OUT}/s{s:02d}.mp4'
    run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', RS[s]['list'], '-vf',
         f"settb=AVTB,setpts=PTS*{f:.4f},fps={FPS},scale={W}:{H}:flags=lanczos,format=yuv420p,tpad=stop_mode=clone:stop_duration={hold:.3f}",
         '-t', f'{L:.3f}', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', out])
    clips.append((out, L))
    print('escena', s, f'velocidad x{1/f:.2f}', f'{L:.1f}s', flush=True)
n = len(clips)

# 2) unir escenas con fundidos cortos
inputs, fc, prev, off = [], [], '[0:v]', 0.0
for c, _ in clips:
    inputs += ['-i', c]
for i in range(1, n):
    off += clips[i - 1][1] - T
    lab = f'[v{i}]'
    fc.append(f"{prev}[{i}:v]xfade=transition=fade:duration={T}:offset={off:.3f}{lab}")
    prev = lab
run(['ffmpeg', '-v', 'error', '-y'] + inputs + ['-filter_complex', ';'.join(fc), '-map', prev,
     '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', f'{OUT}/video.mp4'])

# 3) voz: cada escena con su silencio final
ai, af = [], []
for k, s in enumerate(range(1, NS + 1)):
    ai += ['-i', audio[s]]
    af.append(f"[{k}:a]aresample=44100,apad,atrim=0:{sdur[s]:.3f}[a{k}]")
af.append(''.join(f'[a{k}]' for k in range(NS)) + f'concat=n={NS}:v=0:a=1[a]')
run(['ffmpeg', '-v', 'error', '-y'] + ai + ['-filter_complex', ';'.join(af), '-map', '[a]', '-c:a', 'aac', '-b:a', '192k', f'{OUT}/audio.m4a'])

# 4) subtítulos
def chunks(t, lim):
    parts = re.split(r'(?<=[.:,;])\s+', t)
    out, cur = [], ''
    for p in parts:
        if cur and len(cur) + 1 + len(p) > lim:
            out.append(cur); cur = p
        else:
            cur = (cur + ' ' + p).strip()
    if cur: out.append(cur)
    res = []
    for c in out:  # partir trozos largos por palabras
        while len(c) > lim * 1.25:
            cut = c.rfind(' ', 0, lim)
            res.append(c[:cut]); c = c[cut + 1:]
        res.append(c)
    return res

def ts(x):
    h = int(x // 3600); m = int(x % 3600 // 60); s = x % 60
    return f"{h}:{m:02d}:{s:05.2f}"

lim = 34 if V else 62
fs, mv = (58, 70) if V else (46, 34)
ass = ["[Script Info]", "ScriptType: v4.00+", f"PlayResX: {W}", f"PlayResY: {H}", "WrapStyle: 0", "",
       "[V4+ Styles]",
       "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
       f"Style: S,Liberation Sans,{fs},&H00FFFFFF,&H00FFFFFF,&H5A1A0E0A,&H5A1A0E0A,-1,0,0,0,100,100,0,0,3,16,0,2,70,70,{mv},1",
       "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
t0 = 0.0
for s in range(1, NS + 1):
    cs = chunks(TEXT[s], lim)
    tot = sum(len(c) for c in cs)
    t = t0 + 0.05
    for c in cs:
        d = adur[s] * len(c) / tot
        ass.append(f"Dialogue: 0,{ts(t)},{ts(t + d)},S,,0,0,0,,{c}")
        t += d
    t0 += sdur[s]
open(f'{OUT}/subs.ass', 'w', encoding='utf-8').write('\n'.join(ass) + '\n')

# 5) final
total = sum(sdur.values())
run(['ffmpeg', '-v', 'error', '-y', '-i', f'{OUT}/video.mp4', '-i', f'{OUT}/audio.m4a', '-vf',
     f"subtitles={OUT}/subs.ass,fade=t=in:st=0:d=0.5,fade=t=out:st={total - 0.8:.2f}:d=0.8",
     '-af', f"afade=t=in:st=0:d=0.2,afade=t=out:st={total - 0.6:.2f}:d=0.6",
     '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
     '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', NAME])
print('LISTO', NAME, f'{dur(NAME):.1f}s', f'{os.path.getsize(NAME)/1e6:.1f}MB')
