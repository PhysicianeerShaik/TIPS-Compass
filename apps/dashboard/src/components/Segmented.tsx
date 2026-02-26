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
    <div className="inline-flex rounded border border-gray-200 bg-gray-100 p-0.5 shadow-inner">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={[
              "rounded px-3 py-1.5 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-blue-500/20",
              active
                ? "bg-white text-blue-700 shadow-sm border border-gray-200"
                : "text-slate-500 hover:text-slate-700 hover:bg-gray-200/50 border border-transparent",
            ].join(" ")}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
