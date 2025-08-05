import { useChat } from '@ai-sdk/react';
import { useState, useEffect } from "react";
import { redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger } from "~/components/ui/select";
import { ChatWelcome } from "~/components/chat/chat-welcome";
import { ChatMessage } from "~/components/chat/chat-message";
import { ChatInput } from "~/components/chat/chat-input";
import { ChatTypingIndicator } from "~/components/chat/chat-typing-indicator";
import { useApiKeys } from "~/hooks/use-api-keys";
import { AppSidebar } from "~/components/app-sidebar";
import { SiteHeader } from "~/components/site-header";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma";

interface ChatModel {
  id: string;
  name: string;
  description: string;
  provider: string;
  maxTokens?: number;
  supportsImages?: boolean;
  supportsTools?: boolean;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request);

  if (!session?.user) {
    return redirect("/auth/login");
  }

  // Fetch AI models from database
  const dbModels = await prisma.aIModel.findMany({
    where: { isActive: true },
    include: {
      provider: true,
    },
    orderBy: [
      { provider: { name: 'asc' } },
      { name: 'asc' }
    ]
  });

  // Transform database models to match our interface
  const chatModels: ChatModel[] = dbModels.map((model: any) => ({
    id: `${model.provider.name}:${model.modelId}`,
    name: model.name,
    description: model.description,
    provider: model.provider.name,
    maxTokens: model.maxTokens || undefined,
    supportsImages: model.supportsImages,
    supportsTools: model.supportsTools,
  }));

  return {
    chatModels,
    user: session.user
  };
}

export default function Chat() {
  const { chatModels, user } = useLoaderData<typeof loader>();
  const [selectedModel, setSelectedModel] = useState(chatModels.length > 0 ? chatModels[0].id : '');
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [availableCourses, setAvailableCourses] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const { apiKeys, getValidApiKeys } = useApiKeys();

  // Fetch available courses
  useEffect(() => {
    const fetchCourses = async () => {
      try {
        const response = await fetch('/api/courses');
        const data = await response.json();
        setAvailableCourses(data.courses || []);
      } catch (error) {
        console.error('Failed to fetch courses:', error);
      }
    };
    fetchCourses();
  }, []);

  const { messages, input, handleInputChange, handleSubmit, isLoading, stop } = useChat({
    api: "/api/chat",
    body: {
      model: selectedModel,
      apiKeys: getValidApiKeys(),
      courseId: selectedCourseId,
    },
  });

  const selectedModelInfo = chatModels.find((model: any) => model.id === selectedModel);

  const handlePromptSelect = (prompt: string) => {
    // Create proper synthetic events
    const inputEvent = {
      target: { value: prompt },
      currentTarget: { value: prompt }
    } as React.ChangeEvent<HTMLInputElement>;

    handleInputChange(inputEvent);

    // Use requestAnimationFrame for better timing
    requestAnimationFrame(() => {
      const formEvent = {
        preventDefault: () => {},
        currentTarget: {} as HTMLFormElement
      } as React.FormEvent<HTMLFormElement>;
      handleSubmit(formEvent);
    });
  };

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" user={user} />
      <SidebarInset>
        <SiteHeader user={user} />
                 <div className="flex flex-col h-[calc(100vh-var(--header-height))] bg-gradient-to-br from-background via-background to-muted/20">
           {/* Simple selectors at top */}
           <div className="flex-shrink-0 px-6 py-4">
             <div className="container max-w-4xl mx-auto flex items-center gap-4">
               <Select value={selectedCourseId || "none"} onValueChange={(value) => setSelectedCourseId(value === "none" ? null : value)}>
                 <SelectTrigger className="w-[140px]">
                   {selectedCourseId ? availableCourses.find(c => c.id === selectedCourseId)?.code || 'Selected' : 'No Course'}
                 </SelectTrigger>
                 <SelectContent>
                   <SelectItem value="none">No Course Selected</SelectItem>
                   {availableCourses.map((course) => (
                     <SelectItem key={course.id} value={course.id}>
                       {course.code}
                     </SelectItem>
                   ))}
                 </SelectContent>
               </Select>

               <Select value={selectedModel} onValueChange={setSelectedModel}>
                 <SelectTrigger className="w-[180px]">
                   {selectedModelInfo?.name}
                 </SelectTrigger>
                 <SelectContent>
                   {chatModels.map((model) => (
                     <SelectItem key={model.id} value={model.id}>
                       {model.name}
                     </SelectItem>
                   ))}
                 </SelectContent>
               </Select>
             </div>
           </div>

           {/* Main content area with proper flex layout */}
           <div className="flex-1 flex flex-col min-h-0">
             {/* Messages area that can scroll */}
             <div className="flex-1 overflow-hidden">
               <ScrollArea className="h-full">
                 <div className="max-w-4xl mx-auto px-4 py-6">
                   {messages.length === 0 ? (
                     <ChatWelcome
                       selectedModelInfo={selectedModelInfo}
                       onSelectPrompt={handlePromptSelect}
                     />
                   ) : (
                     <div className="space-y-8 pb-8">
                       {messages.map((message) => (
                         <ChatMessage key={message.id} message={message} />
                       ))}

                       {isLoading && <ChatTypingIndicator />}
                     </div>
                   )}
                 </div>
               </ScrollArea>
             </div>

             {/* Sticky input at bottom */}
             <div className="flex-shrink-0">
               <ChatInput
                 input={input}
                 isLoading={isLoading}
                 onInputChange={handleInputChange}
                 onSubmit={handleSubmit}
                 onStop={stop}
               />
             </div>
           </div>
         </div>
      </SidebarInset>
    </SidebarProvider>
  );
}