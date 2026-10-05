export function Field({ label, name, children, hint }: { label: string; name: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label htmlFor={name} className="label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
export const Input = (p: React.InputHTMLAttributes<HTMLInputElement> & { name: string }) => <input id={p.name} className="input" {...p} />;
