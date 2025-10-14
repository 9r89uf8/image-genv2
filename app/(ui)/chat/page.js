import ChatPane from "@/components/ChatPane";

export default function ChatPage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6 lg:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Nanobanana Chat</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Iterate on generations with the Gemini 2.5 Flash Image chat API.
        </p>
      </header>
      <ChatPane />
    </div>
  );
}
