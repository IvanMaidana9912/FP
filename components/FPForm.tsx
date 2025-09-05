'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type Sistema = 'mono' | 'delta';
type PotenciaTipo = 'P' | 'S';
type TabKind = 'inductiva' | 'capacitiva';

const VOLTAGE_PRESETS = [127, 220, 230, 240, 380, 400, 415, 440, 480] as const;
const clampFP = (x: number) => Math.min(Math.max(x, 0.000001), 0.999999);
const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(4) : '—');

function drawTriangles(
  canvas: HTMLCanvasElement,
  P: number,   // W
  Q1: number,  // VAr
  Q2: number,  // VAr
  sistemaLabel: string
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const m = 20, drawW = W - 2*m, drawH = H - 2*m;
  const maxP = Math.max(P, 1e-6);
  const maxQ = Math.max(Q1, Q2, 1e-6);
  const sx = drawW / maxP, sy = drawH / maxQ;
  const X = (p: number) => m + p * sx;
  const Y = (q: number) => H - m - q * sy;

  // ejes
  ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.25;
  ctx.beginPath(); ctx.moveTo(m, H - m); ctx.lineTo(m + drawW, H - m); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(m, H - m); ctx.lineTo(m, H - (m + drawH)); ctx.stroke();

  // triángulo antes (Q1)
  ctx.fillStyle = 'rgba(59,130,246,0.18)'; // azul
  ctx.strokeStyle = 'rgba(59,130,246,0.9)'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(P), Y(0)); ctx.lineTo(X(P), Y(Q1));
  ctx.closePath(); ctx.fill(); ctx.stroke();

  // triángulo objetivo (Q2)
  ctx.fillStyle = 'rgba(34,211,238,0.18)'; // cian
  ctx.strokeStyle = 'rgba(34,211,238,0.9)'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(P), Y(0)); ctx.lineTo(X(P), Y(Q2));
  ctx.closePath(); ctx.fill(); ctx.stroke();

  // ΔQ
  ctx.strokeStyle = 'rgba(250,204,21,0.95)'; // amber
  ctx.setLineDash([5,4]); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(X(P), Y(Q1)); ctx.lineTo(X(P), Y(Q2)); ctx.stroke();
  ctx.setLineDash([]);

  // etiquetas
  ctx.fillStyle = '#cbd5e1'; ctx.font = '12px ui-sans-serif, system-ui';
  ctx.fillText('P', X(P) - 10, Y(0) + 14);
  ctx.fillText('Q', X(0) - 12, Y(maxQ) + 4);
  ctx.fillStyle = 'rgba(59,130,246,0.9)'; ctx.fillText('Antes (Q₁)', X(P) - 70, Y(Q1) - 6);
  ctx.fillStyle = 'rgba(34,211,238,0.9)'; ctx.fillText('Objetivo (Q₂)', X(P) - 86, Y(Q2) - 6);
  ctx.fillStyle = 'rgba(250,204,21,0.95)';
  const midY = (Y(Q1) + Y(Q2)) / 2; ctx.fillText('ΔQ', X(P) + 6, midY + 4);

  ctx.fillStyle = '#94a3b8'; ctx.fillText(sistemaLabel, m + 6, H - (m + drawH) + 14);
}

export default function FPForm() {
  // entradas
  const [tab, setTab] = useState<TabKind>('inductiva');
  const [potenciaTipo, setPotenciaTipo] = useState<PotenciaTipo>('P');
  const [P_input, setP] = useState<number>(800);  // W
  const [S_input, setS] = useState<number>(1000); // VA
  const [vPreset, setVPreset] = useState<string>('230');
  const [V, setV] = useState<number>(230);        // V RMS (línea)
  const [f, setF] = useState<50 | 60>(50);        // Hz
  const [fp1, setFp1] = useState<number>(0.8);    // FP actual
  const [fp2, setFp2] = useState<number>(0.95);   // FP objetivo
  const [sistema, setSistema] = useState<Sistema>('mono');

  function onPresetChange(value: string) {
    setVPreset(value);
    if (value !== 'custom') setV(parseFloat(value));
  }

  // validación
  const errors: string[] = [];
  if (!(V > 0)) errors.push('V debe ser > 0.');
  if (!(P_input >= 0 && S_input >= 0)) errors.push('P y S deben ser ≥ 0.');
  if (!(fp1 > 0 && fp1 <= 1)) errors.push('FP₁ debe estar en (0,1].');
  if (!(fp2 > 0 && fp2 <= 1)) errors.push('FP₂ debe estar en (0,1].');

  // preview (solo para validar condición; no se grafica ni muestra como resultado)
  const preview = useMemo(() => {
    if (errors.length) return null;
    const _fp1 = clampFP(fp1), _fp2 = clampFP(fp2);
    const P_used_live = potenciaTipo === 'P' ? P_input : S_input * _fp2;
    const term = Math.tan(Math.acos(_fp1)) - Math.tan(Math.acos(_fp2));
    const Q1 = P_used_live * Math.tan(Math.acos(_fp1));
    const Q2 = P_used_live * Math.tan(Math.acos(_fp2));
    return { term, P_used_live, Q1, Q2 };
  }, [errors.length, fp1, fp2, potenciaTipo, P_input, S_input]);

  // snapshot tras "Calcular"
  const [calc, setCalc] = useState<null | {
    // inputs usados
    potenciaTipo: PotenciaTipo;
    P_input: number; S_input: number; V: number; f: 50 | 60;
    fp1: number; fp2: number; sistema: Sistema;
    // P y S resultantes coherentes con FP2
    P_usada_W: number; S_usada_VA: number;
    // términos y auxiliares
    term: number; Kf: number; Ksys: number;
    Q1: number; Q2: number; Q_delta_kVAr: number;
    // resultados por caso
    C_uF?: number;        // solo inductiva (capacitor)
    L_mH?: number;        // solo capacitiva (reactor por fase en Δ; mono/Y total)
    msg: string;
  }>(null);

  function onCalcular() {
    if (errors.length) { alert('Corregí los errores de entrada.'); return; }

    // reglas P<->S con FP2 (φ2 = arccos(FP2))
    const _fp1 = clampFP(fp1), _fp2 = clampFP(fp2);

    const P_usada_W = (potenciaTipo === 'P')
      ? P_input
      : S_input * _fp2;

    const S_usada_VA = (potenciaTipo === 'P')
      ? (P_input / _fp2)
      : S_input;

    // Δ(tanφ) = tanφ1 − tanφ2
    const term = Math.tan(Math.acos(_fp1)) - Math.tan(Math.acos(_fp2));

    // factores
    const Kf = f === 60 ? 1 / 1.2 : 1;            // 60 Hz => ×(1/1.2) en C
    const Ksys = sistema === 'delta' ? 1 / 3 : 1; // Δ por fase (C)

    // Q antes/después (VAr)
    const Q1 = P_usada_W * Math.tan(Math.acos(_fp1));
    const Q2 = P_usada_W * Math.tan(Math.acos(_fp2));
    const Q_delta_kVAr = (P_usada_W / 1000) * term; // kVAr (signado)

    let msg = '';
    let C_uF: number | undefined;
    let L_mH: number | undefined;

    if (tab === 'inductiva') {
      if (term <= 0) {
        msg = 'No es condición inductiva respecto a FP₂ (Δ(tanφ) ≤ 0). Cambiá a pestaña “Capacitiva”.';
      } else {
        // C[µF] = (10^4/π)*(P/V^2)*term*Kf*Ksys    (Δ: por fase ⇒ ÷3 ya incluido en Ksys)
        C_uF = (1e4 / Math.PI) * (P_usada_W / (V * V)) * term * Kf * Ksys;
        msg = 'Cálculo de corrección inductiva realizado (capacitores).';
      }
    } else {
      if (term >= 0) {
        msg = 'No es condición capacitiva respecto a FP₂ (Δ(tanφ) ≥ 0). Probá la pestaña “Inductiva”.';
      } else {
        // Reactor (shunt):  Q = V^2 / X_L  con  X_L = 2π f L
        // Mono/Y (total):   L = V^2 / (2π f Q_total)
        // Δ (por fase):     L_fase = 3 V^2 / (2π f Q_total)   (OJO: *3 en el numerador*)
        const Qabs = Math.abs(Q_delta_kVAr) * 1e3; // VAr
        const denom = 2 * Math.PI * f;
        const L_H = (sistema === 'delta')
          ? (3 * V * V) / (denom * Qabs)   // por fase en Δ
          : (V * V) / (denom * Qabs);      // mono / estrella (total)
        L_mH = L_H * 1e3;
        msg = 'Condición capacitiva detectada: cálculo de reactor (inductor).';
      }
    }

    setCalc({
      potenciaTipo, P_input, S_input, V, f, fp1, fp2, sistema,
      P_usada_W, S_usada_VA,
      term, Kf, Ksys, Q1, Q2, Q_delta_kVAr,
      C_uF, L_mH, msg
    });
  }

  // canvas: dibuja con snapshot
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const cssW = c.clientWidth || 480, cssH = c.clientHeight || 280;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr);
    const ctx = c.getContext('2d'); ctx?.setTransform(dpr,0,0,dpr,0,0);
    if (!calc) { ctx?.clearRect(0,0,c.width,c.height); return; }
    const sistemaLabel = calc.sistema === 'delta' ? 'Δ (por fase)' : 'Mono / Y';
    drawTriangles(
      c,
      Math.max(calc.P_usada_W, 0),
      Math.max(calc.Q1, 0),
      Math.max(calc.Q2, 0),
      sistemaLabel
    );
  }, [calc]);

  const sistemaLabelShort = (calc?.sistema ?? sistema) === 'delta' ? 'Δ' : 'Y/Mono';

  return (
    <div className="space-y-6">
      {/* Entradas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* P ó S */}
        <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4">
          <label className="block text-xs uppercase text-slate-400">Tipo de potencia</label>
          <select
            value={potenciaTipo}
            onChange={(e) => setPotenciaTipo(e.target.value as PotenciaTipo)}
            className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 p-2.5"
          >
            <option value="P">Activa P (W)</option>
            <option value="S">Aparente S (VA)</option>
          </select>

          {potenciaTipo === 'P' ? (
            <div className="mt-3">
              <label className="block text-xs uppercase text-slate-400">P (W)</label>
              <input
                type="number" min={0} step="0.1" value={P_input}
                onChange={(e) => setP(parseFloat(e.target.value))}
                className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 p-2.5"
              />
              <p className="text-xs text-slate-400 mt-1">Al calcular: S = P / FP₂.</p>
            </div>
          ) : (
            <div className="mt-3">
              <label className="block text-xs uppercase text-slate-400">S (VA)</label>
              <input
                type="number" min={0} step="0.1" value={S_input}
                onChange={(e) => setS(parseFloat(e.target.value))}
                className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 p-2.5"
              />
              <p className="text-xs text-slate-400 mt-1">Al calcular: P = S · FP₂.</p>
            </div>
          )}
        </div>

        {/* Tensión y frecuencia */}
        <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4">
          <label className="block text-xs uppercase text-slate-400">Tensión RMS V (V)</label>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <select
              value={vPreset}
              onChange={(e) => { setVPreset(e.target.value); if (e.target.value !== 'custom') setV(parseFloat(e.target.value)); }}
              className="rounded-lg bg-slate-900 border border-slate-700 p-2.5"
            >
              {VOLTAGE_PRESETS.map(v => <option key={v} value={String(v)}>{v} V</option>)}
              <option value="custom">Personalizado</option>
            </select>
            <input
              type="number" min={1} step="0.1" value={V}
              onChange={(e) => { setV(parseFloat(e.target.value)); setVPreset('custom'); }}
              className="rounded-lg bg-slate-900 border border-slate-700 p-2.5"
            />
          </div>

          <div className="mt-3">
            <label className="block text-xs uppercase text-slate-400">Frecuencia (Hz)</label>
            <select
              value={f}
              onChange={(e) => setF(Number(e.target.value) as 50 | 60)}
              className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 p-2.5"
            >
              <option value={50}>50</option>
              <option value={60}>60</option>
            </select>
            <p className="text-xs text-slate-400 mt-1">En 60 Hz se aplica ×(1/1.2) en C.</p>
          </div>
        </div>

        {/* FP y sistema */}
        <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4">
          <label className="block text-xs uppercase text-slate-400">FP actual (FP₁)</label>
          <input
            type="number" min={0.1} max={1} step="0.001" value={fp1}
            onChange={(e) => setFp1(parseFloat(e.target.value))}
            className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 p-2.5"
          />
          <div className="mt-3">
            <label className="block text-xs uppercase text-slate-400">FP objetivo (FP₂)</label>
            <input
              type="number" min={0.1} max={1} step="0.001" value={fp2}
              onChange={(e) => setFp2(parseFloat(e.target.value))}
              className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 p-2.5"
            />
          </div>
          <div className="mt-3">
            <label className="block text-xs uppercase text-slate-400">Sistema</label>
            <select
              value={sistema}
              onChange={(e) => setSistema(e.target.value as Sistema)}
              className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 p-2.5"
            >
              <option value="mono">Monofásico / Estrella</option>
              <option value="delta">Trifásico Delta (por fase)</option>
            </select>
          </div>
        </div>
      </div>

      {/* errores */}
      {errors.length > 0 && (
        <div className="rounded-xl border border-rose-600 bg-rose-950/30 p-3 text-rose-200 text-sm">
          {errors.map((e, i) => <div key={i}>• {e}</div>)}
        </div>
      )}

      {/* pestañas + calcular */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-2">
          <button
            onClick={() => setTab('inductiva')}
            className={`px-3 py-2 rounded-lg border ${tab === 'inductiva' ? 'border-cyan-400 text-cyan-300' : 'border-slate-700 text-slate-300'} bg-slate-900/40`}
          >
            Red Inductiva (atrasada)
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setTab('capacitiva')}
            className={`px-3 py-2 rounded-lg border ${tab === 'capacitiva' ? 'border-amber-400 text-amber-300' : 'border-slate-700 text-slate-300'} bg-slate-900/40`}
          >
            Red Capacitiva (adelantada)
          </button>
        </div>
        <button
          onClick={onCalcular}
          className="ml-auto px-4 py-2 rounded-lg font-bold text-slate-900 bg-cyan-400/90 hover:bg-cyan-300 transition"
        >
          Calcular
        </button>
      </div>

      {/* mensaje post-cálculo */}
      {calc && (
        <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-3 text-slate-200">
          {calc.msg}
        </div>
      )}

      {/* resultados + datos + canvas */}
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {tab === 'inductiva' ? (
            <>
              <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4">
                <div className="text-slate-400 text-xs uppercase">Capacitancia requerida</div>
                <div className="text-2xl font-extrabold">
                  {calc?.C_uF !== undefined ? `${fmt(calc.C_uF)} µF` : '—'}
                </div>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4">
                <div className="text-slate-400 text-xs uppercase">kVAr a compensar</div>
                <div className="text-2xl font-extrabold">
                  {calc ? `${fmt(calc.Q_delta_kVAr)} kVAr` : '—'}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4">
                <div className="text-slate-400 text-xs uppercase">Reactor (inductor)</div>
                <div className="text-2xl font-extrabold">
                  {calc?.L_mH !== undefined ? `${fmt(calc.L_mH)} mH` : '—'}
                </div>
                <div className="text-slate-400 text-xs mt-1">
                  {calc?.sistema === 'delta' ? 'Valor por fase (Δ)' : 'Mono / Estrella'}
                </div>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4">
                <div className="text-slate-400 text-xs uppercase">kVAr a “absorber”</div>
                <div className="text-2xl font-extrabold">
                  {calc ? `${fmt(Math.abs(calc.Q_delta_kVAr))} kVAr` : '—'}
                </div>
              </div>
            </>
          )}
          <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4">
            <div className="text-slate-400 text-xs uppercase">P usada</div>
            <div className="text-2xl font-extrabold">{calc ? fmt(calc.P_usada_W) : '—'} W</div>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4">
            <div className="text-slate-400 text-xs uppercase">S usada</div>
            <div className="text-2xl font-extrabold">{calc ? fmt(calc.S_usada_VA) : '—'} VA</div>
          </div>
        </div>

        {/* Datos usados + Canvas */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4">
            <h2 className="text-lg font-bold mb-2">Datos usados</h2>
            <ul className="text-sm text-slate-300 space-y-1 select-all">
              <li>Pestaña: {tab === 'inductiva' ? 'Inductiva' : 'Capacitiva'}</li>
              <li>Tipo de potencia: {(calc?.potenciaTipo ?? potenciaTipo) === 'P' ? 'P (W)' : 'S (VA)'}</li>
              <li>P ingresada: {calc?.P_input ?? P_input} W</li>
              <li>S ingresada: {calc?.S_input ?? S_input} VA</li>
              <li>FP₁ (actual): {calc?.fp1 ?? fp1}</li>
              <li>FP₂ (objetivo): {calc?.fp2 ?? fp2}</li>
              <li>Frecuencia: {calc?.f ?? f} Hz</li>
              <li>Tensión V: {calc?.V ?? V} V</li>
              <li>Sistema: {sistemaLabelShort}</li>
              {calc && (
                <>
                  <li>P usada (de snapshot): {fmt(calc.P_usada_W)} W</li>
                  <li>S usada (de snapshot): {fmt(calc.S_usada_VA)} VA</li>
                  <li>Δ(tanφ): {fmt(calc.term)}</li>
                  <li>Q₁ (antes): {fmt(calc.Q1 / 1000)} kVAr</li>
                  <li>Q₂ (objetivo): {fmt(calc.Q2 / 1000)} kVAr</li>
                </>
              )}
            </ul>
            <p className="text-xs text-slate-400 mt-2">
              Nota: se corrige **solo** potencia reactiva. En condición **capacitiva** no se instalan capacitores; se dimensiona **reactor**.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-2 md:p-4">
            <h2 className="text-lg font-bold mb-2">Triángulo de potencias</h2>
            <div className="aspect-[16/9] w-full">
              <canvas ref={canvasRef} className="w-full h-full rounded-lg bg-slate-950" />
            </div>
            <p className="text-xs text-slate-400 mt-2">
              Dos triángulos: <b>antes</b> (Q₁) y <b>objetivo</b> (Q₂). Línea punteada = <b>ΔQ</b>. Sistema: {sistemaLabelShort}.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
