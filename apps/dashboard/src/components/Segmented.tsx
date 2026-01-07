export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { label: string; value: T }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-white/10 bg-white/5 p-1 shadow-[0_8px_24px_rgba(4,8,18,0.35)]">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={[
              "rounded-full px-3.5 py-1.5 text-sm transition",
              active
                ? "bg-white/15 text-white shadow-[0_0_0_1px_rgba(255,255,255,0.15)]"
                : "text-white/60 hover:text-white",
            ].join(" ")}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
