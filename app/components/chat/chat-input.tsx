import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Badge } from "~/components/ui/badge";
import { Send, Square, Settings } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { ApiKeySettings } from "./api-key-settings";
import { useApiKeys } from "~/hooks/use-api-keys";

interface ChatModel {
  id: string;
  name: string;
  description: string;
  provider: string;
  maxTokens?: number;
  supportsImages?: boolean;
  supportsTools?: boolean;
}

interface ChatInputProps {
  input: string;
  isLoading: boolean;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onStop?: () => void;
  selectedModel: string;
  onModelChange: (model: string) => void;
  chatModels: ChatModel[];
}

export function ChatInput({
  input,
  isLoading,
  onInputChange,
  onSubmit,
  onStop,
  selectedModel,
  onModelChange,
  chatModels
}: ChatInputProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { isProviderConfigured, isLoading: isApiKeysLoading } = useApiKeys();

const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() && !isLoading) {
       const formEvent = new Event('submit', { bubbles: true, cancelable: true });
       Object.defineProperty(formEvent, 'preventDefault', {
         value: () => e.preventDefault()
       });
       onSubmit(formEvent as unknown as React.FormEvent<HTMLFormElement>);
      }
    }
  };

  const selectedModelInfo = chatModels.find(model => model.id === selectedModel);

  // Check if user has an API key for the selected model's provider
  const hasRequiredApiKey = !isApiKeysLoading && selectedModelInfo && isProviderConfigured(selectedModelInfo.provider);

  return (
    <>
      <div className="sticky bottom-0 p-4">
        <div className="container max-w-4xl mx-auto">
          <form onSubmit={onSubmit} className="relative">
            <div className="relative flex items-center bg-background rounded-full border border-border/50 shadow-lg focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/50 transition-all duration-200">
              {/* Settings Button */}
              <div className="flex-shrink-0 pl-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSettingsOpen(true)}
                  className="h-10 w-10 rounded-full hover:bg-muted/80 transition-colors"
                  title="API Key Settings"
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </div>

              {/* Separator */}
              <div className="w-px h-6 bg-border/50 ml-2" />

              {/* Input Field */}
              <Input
                value={input}
                onChange={onInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Ask EduAI anything..."
                disabled={isLoading}
                className="flex-1 border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 h-14 text-base placeholder:text-muted-foreground/60 pl-4 pr-44"
              />

              {/* Model Selector */}
              <div className="flex-shrink-0 pr-2">
                <Select value={selectedModel} onValueChange={onModelChange}>
                  <SelectTrigger className="h-auto border-0 bg-transparent p-2 focus:ring-0 focus:ring-offset-0 min-w-[120px]">
                    <div className="flex items-center gap-2 text-sm">
                      <Badge
                        variant={hasRequiredApiKey ? "default" : "secondary"}
                        className="text-xs font-medium"
                      >
                        {selectedModelInfo?.provider}
                      </Badge>
                      <span className="font-medium text-muted-foreground">
                        {selectedModelInfo?.name}
                      </span>
                    </div>
                  </SelectTrigger>
                  <SelectContent className="backdrop-blur-xl bg-background/95">
                    {chatModels.map((model) => {
                      const hasKey = !isApiKeysLoading && isProviderConfigured(model.provider);
                      return (
                        <SelectItem key={model.id} value={model.id} className="cursor-pointer">
                          <div className="flex items-center justify-between w-full gap-3">
                            <span className="font-medium">{model.name}</span>
                            <div className="flex items-center gap-1">
                              <Badge
                                variant={hasKey ? "default" : "secondary"}
                                className="text-xs font-medium"
                              >
                                {model.provider}
                              </Badge>
                            </div>
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              {/* Separator */}
              <div className="w-px h-6 bg-border/50 mr-2" />

              {/* Send/Stop Button */}
              <div className="flex-shrink-0 pr-2">
                {isLoading && onStop ? (
                  <Button
                    type="button"
                    onClick={onStop}
                    size="sm"
                    variant="outline"
                    className="h-10 w-10 rounded-full border-border/50 hover:bg-muted/80 hover:border-primary/30 transition-all duration-200"
                  >
                    <Square className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    disabled={isLoading || !input.trim()}
                    size="sm"
                    className="h-10 w-10 rounded-full shadow-sm disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 transition-all duration-200 bg-gradient-to-r from-primary to-primary/90"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            {/* Helper Text */}
            <div className="flex items-center justify-between mt-3">
              <div className="flex items-center gap-1 text-xs text-muted-foreground/70">
                <span>Press</span>
                <kbd className="px-2 py-1 text-xs font-mono bg-muted/50 rounded border border-border/50">
                  Enter
                </kbd>
                <span>to send</span>
              </div>

              {!isApiKeysLoading && !hasRequiredApiKey && (
                <div className="text-xs text-orange-600">
                  Add your {selectedModelInfo?.provider} API key in settings
                </div>
              )}
            </div>
          </form>
        </div>
      </div>

      <ApiKeySettings open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}