import JobComposer from "@/components/JobComposer";
import JobQueueList from "@/components/JobQueueList";
import CostMeter from "@/components/CostMeter";

export default function DashboardPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-6 lg:p-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">
          Image Studio Dashboard
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Compose new generations, monitor the queue, and keep an eye on token
          spend.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_minmax(0,1fr)]">
        <JobComposer />
        <CostMeter />
      </section>

      <section>
        <JobQueueList />
      </section>
    </div>
  );
}
