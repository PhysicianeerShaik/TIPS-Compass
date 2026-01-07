"use client";

export function GlobalFooter() {
  return (
    <footer className="mt-8 rounded-[28px] border border-white/10 bg-white/5 p-6 text-center text-xs text-white/60">
      <div className="text-sm font-semibold text-white/80">TIPS Compass</div>
      <div className="mt-2">
        © {new Date().getFullYear()}{" "}
        <a
          href="https://www.linkedin.com/in/sabour-shaik/"
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-white/80 underline decoration-white/30 hover:text-white"
        >
          Abdus Sabour Shaik
        </a>
        {" • "}
        <a
          href="https://www.linkedin.com/in/stephanbannikov/"
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-white/80 underline decoration-white/30 hover:text-white"
        >
          Stephan Bannikov
        </a>
        {" • "}
        <a
          href="https://www.linkedin.com/in/orhundavarci/"
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-white/80 underline decoration-white/30 hover:text-white"
        >
          Orhun Davarci
        </a>
      </div>
      <div className="mt-2 text-white/50">
        Licensed under CC BY-ND 4.0 CC BY ND
      </div>
      <div className="mt-2 text-white/50">
        This tool is for informational purposes only and does not replace medical advice.
        Data entered is stored locally and in your configured demo database.
      </div>
      <div className="mt-2 text-white/40">
        Built for caregivers, clinicians, and families monitoring post-TIPS recovery.
      </div>
    </footer>
  );
}
