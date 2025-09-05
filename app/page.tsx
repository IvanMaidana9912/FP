

import FPForm from '@/components/FPForm';

export default function Page() {
  return (
    <main className="min-h-dvh bg-gradient-to-br from-slate-900 via-slate-950 to-black text-slate-100 select-none">
      <div className="mx-auto max-w-6xl p-4 sm:p-6">
        <header className="mb-4">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Corrección de Factor de Potencia
          </h1>
          <p className="text-slate-400">
            Calculadora de capacitancia (µF) e inductacion (mH)
          </p>
        </header>

        <section className="fadein">
          <FPForm />
        </section>
      </div>
    </main>
  );
}
