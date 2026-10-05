export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-brand-900">BASMA<span className="text-brand-500"> MARKETING</span></h1>
          <p className="text-sm text-slate-500">Marketing Workflow &amp; Content Management</p>
        </div>
        <div className="card">{children}</div>
      </div>
    </main>
  );
}
