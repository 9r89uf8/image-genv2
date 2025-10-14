import GirlsGrid from "@/components/GirlsGrid";

export default function GirlsPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6 lg:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Girls</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Manage character profiles and quickly launch new generations.
        </p>
      </header>
      <GirlsGrid />
    </div>
  );
}
