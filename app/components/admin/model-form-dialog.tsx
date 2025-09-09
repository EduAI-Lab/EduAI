import { useState, useEffect } from "react";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Loader } from "~/components/ui/loader";

type AIProvider = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
  envVarName?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  models?: AIModel[];
  _count?: {
    models: number;
  };
};

type AIModel = {
  id: string;
  modelId: string;
  name: string;
  description: string;
  type: "CHAT" | "COMPLETION" | "EMBEDDING" | "IMAGE" | "AUDIO" | "VIDEO";
  maxTokens?: number;
  supportsImages: boolean;
  supportsTools: boolean;
  supportsStreaming: boolean;
  inputPricing?: number;
  outputPricing?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  providerId: string;
  provider: Omit<AIProvider, 'models' | '_count'>;
};

interface ModelFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model?: AIModel | null;
  providers: AIProvider[];
  onSubmit: (data: any) => void;
}

type OllamaModel = {
  name: string;
  model: string;
  size: number;
  digest: string;
  modified_at: string;
  details: any;
};

export function ModelFormDialog({ open, onOpenChange, model, providers, onSubmit }: ModelFormDialogProps) {
  const [formData, setFormData] = useState<{
    modelId: string;
    name: string;
    description: string;
    type: "CHAT" | "COMPLETION" | "EMBEDDING" | "IMAGE" | "AUDIO" | "VIDEO";
    maxTokens: string;
    supportsImages: boolean;
    supportsTools: boolean;
    supportsStreaming: boolean;
    inputPricing: string;
    outputPricing: string;
    isActive: boolean;
    providerId: string;
  }>({
    modelId: "",
    name: "",
    description: "",
    type: "CHAT",
    maxTokens: "",
    supportsImages: false,
    supportsTools: false,
    supportsStreaming: true,
    inputPricing: "",
    outputPricing: "",
    isActive: true,
    providerId: "",
  });

  // Ollama-specific state
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [fetchingOllamaModels, setFetchingOllamaModels] = useState(false);
  const [ollamaError, setOllamaError] = useState<string | null>(null);
  const [selectedOllamaModel, setSelectedOllamaModel] = useState<string>("");

  useEffect(() => {
    if (model) {
      setFormData({
        modelId: model.modelId,
        name: model.name,
        description: model.description,
        type: model.type,
        maxTokens: model.maxTokens?.toString() || "",
        supportsImages: model.supportsImages,
        supportsTools: model.supportsTools,
        supportsStreaming: model.supportsStreaming,
        inputPricing: model.inputPricing?.toString() || "",
        outputPricing: model.outputPricing?.toString() || "",
        isActive: model.isActive,
        providerId: model.providerId,
      });
    } else {
      setFormData({
        modelId: "",
        name: "",
        description: "",
        type: "CHAT",
        maxTokens: "",
        supportsImages: false,
        supportsTools: false,
        supportsStreaming: true,
        inputPricing: "",
        outputPricing: "",
        isActive: true,
        providerId: "",
      });
    }
  }, [model, open]);

  // Reset Ollama state when provider changes
  useEffect(() => {
    setOllamaModels([]);
    setOllamaError(null);
    setSelectedOllamaModel("");
  }, [formData.providerId]);

  // Check if current provider is Ollama
  const selectedProvider = providers.find(p => p.id === formData.providerId);
  const isOllamaProvider = selectedProvider?.name === 'ollama';

  // Fetch Ollama models
  const fetchOllamaModels = async () => {
    setFetchingOllamaModels(true);
    setOllamaError(null);

    try {
      const response = await fetch('/api/ollama-models');
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch Ollama models');
      }

      setOllamaModels(data.models || []);
    } catch (error: any) {
      setOllamaError(error.message || 'Failed to fetch Ollama models');
      setOllamaModels([]);
    } finally {
      setFetchingOllamaModels(false);
    }
  };

  // Handle Ollama model selection
  const handleOllamaModelSelect = (modelName: string) => {
    setSelectedOllamaModel(modelName);
    const selectedModel = ollamaModels.find(m => m.name === modelName);

    if (selectedModel) {
      // Auto-populate form fields based on Ollama model
      setFormData(prev => ({
        ...prev,
        modelId: selectedModel.name,
        name: selectedModel.name.charAt(0).toUpperCase() + selectedModel.name.slice(1),
        description: `Local Ollama model: ${selectedModel.name}`,
        type: "CHAT", // Most Ollama models are chat models
        maxTokens: "", // Ollama doesn't provide max tokens info
        supportsImages: selectedModel.name.toLowerCase().includes('vision') || selectedModel.name.toLowerCase().includes('llava'),
        supportsTools: true, // Most modern Ollama models support tools
        supportsStreaming: true,
        inputPricing: "0", // Local models are free
        outputPricing: "0", // Local models are free
      }));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const submitData = {
      ...formData,
      maxTokens: formData.maxTokens ? Number(formData.maxTokens) : undefined,
      inputPricing: formData.inputPricing ? Number(formData.inputPricing) : undefined,
      outputPricing: formData.outputPricing ? Number(formData.outputPricing) : undefined,
    };

    onSubmit(submitData);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{model ? "Edit Model" : "Create Model"}</DialogTitle>
          <DialogDescription>
            {model ? "Update the model configuration." : "Add a new AI model to your platform."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="providerId">Provider</Label>
              <Select
                value={formData.providerId}
                onValueChange={(value) => setFormData({ ...formData, providerId: value })}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  {providers.filter(p => p.isActive).map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="type">Type</Label>
              <Select
                value={formData.type}
                onValueChange={(value: any) => setFormData({ ...formData, type: value })}
                required
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CHAT">Chat</SelectItem>
                  <SelectItem value="COMPLETION">Completion</SelectItem>
                  <SelectItem value="EMBEDDING">Embedding</SelectItem>
                  <SelectItem value="IMAGE">Image</SelectItem>
                  <SelectItem value="AUDIO">Audio</SelectItem>
                  <SelectItem value="VIDEO">Video</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Ollama Model Fetching Section */}
          {isOllamaProvider && (
            <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
              <div className="flex items-center justify-between">
                <Label>Available Ollama Models</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={fetchOllamaModels}
                  disabled={fetchingOllamaModels}
                >
                  {fetchingOllamaModels ? (
                    <>
                      <Loader className="w-4 h-4 mr-2" />
                      Fetching...
                    </>
                  ) : (
                    'Fetch Models'
                  )}
                </Button>
              </div>

              {ollamaError && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {ollamaError}
                  </AlertDescription>
                </Alert>
              )}

              {ollamaModels.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="ollamaModelSelect">Select Model</Label>
                  <Select
                    value={selectedOllamaModel}
                    onValueChange={handleOllamaModelSelect}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose an Ollama model" />
                    </SelectTrigger>
                    <SelectContent>
                      {ollamaModels.map((model) => (
                        <SelectItem key={model.name} value={model.name}>
                          <div className="flex flex-col">
                            <span>{model.name}</span>
                            <span className="text-xs text-muted-foreground">
                              Size: {Math.round(model.size / 1024 / 1024 / 1024 * 100) / 100} GB
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="modelId">Model ID</Label>
              <Input
                id="modelId"
                value={formData.modelId}
                onChange={(e) => setFormData({ ...formData, modelId: e.target.value })}
                placeholder="gpt-4o"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Display Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="GPT-4o"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Advanced multimodal model..."
              required
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="maxTokens">Max Tokens</Label>
              <Input
                id="maxTokens"
                type="number"
                value={formData.maxTokens}
                onChange={(e) => setFormData({ ...formData, maxTokens: e.target.value })}
                placeholder="128000"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="inputPricing">Input Price ($/1M)</Label>
              <Input
                id="inputPricing"
                type="number"
                step="0.01"
                value={formData.inputPricing}
                onChange={(e) => setFormData({ ...formData, inputPricing: e.target.value })}
                placeholder="2.50"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="outputPricing">Output Price ($/1M)</Label>
              <Input
                id="outputPricing"
                type="number"
                step="0.01"
                value={formData.outputPricing}
                onChange={(e) => setFormData({ ...formData, outputPricing: e.target.value })}
                placeholder="10.00"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Switch
                  id="supportsImages"
                  checked={formData.supportsImages}
                  onCheckedChange={(checked) => setFormData({ ...formData, supportsImages: checked })}
                />
                <Label htmlFor="supportsImages">Supports Images</Label>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="supportsTools"
                  checked={formData.supportsTools}
                  onCheckedChange={(checked) => setFormData({ ...formData, supportsTools: checked })}
                />
                <Label htmlFor="supportsTools">Supports Tools</Label>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Switch
                  id="supportsStreaming"
                  checked={formData.supportsStreaming}
                  onCheckedChange={(checked) => setFormData({ ...formData, supportsStreaming: checked })}
                />
                <Label htmlFor="supportsStreaming">Supports Streaming</Label>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="isActive"
                  checked={formData.isActive}
                  onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                />
                <Label htmlFor="isActive">Active</Label>
              </div>
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">
              {model ? "Update" : "Create"} Model
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}