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
import type { AIProvider, AIModel } from "~/types/ai";
import { allowsSupportsToolsToggle } from "~/lib/ai/model-tool-capability";

export type OllamaModel = {
  name: string;
  model: string;
  size: number;
  digest: string;
  modified_at: string;
  details: any;
};

export type VllmModel = {
  id: string;
  owned_by?: string;
  created?: number;
};

export interface ModelFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model?: AIModel | null;
  providers: AIProvider[];
  onSubmit: (data: any) => void;
  ollamaModels?: OllamaModel[];
  fetchingOllamaModels?: boolean;
  ollamaError?: string | null;
  onFetchOllamaModels?: () => void;
  vllmModels?: VllmModel[];
  fetchingVllmModels?: boolean;
  vllmError?: string | null;
  onFetchVllmModels?: () => void;
  vllmFetched?: boolean;
}

export function ModelFormDialog({
  open,
  onOpenChange,
  model,
  providers,
  onSubmit,
  ollamaModels = [],
  fetchingOllamaModels = false,
  ollamaError = null,
  onFetchOllamaModels,
  vllmModels = [],
  fetchingVllmModels = false,
  vllmError = null,
  onFetchVllmModels,
  vllmFetched = false,
}: ModelFormDialogProps) {
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

  const [selectedOllamaModel, setSelectedOllamaModel] = useState<string>("");
  const [selectedVllmModel, setSelectedVllmModel] = useState<string>("");

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

  useEffect(() => {
    setSelectedOllamaModel("");
    setSelectedVllmModel("");
  }, [formData.providerId]);

  const selectedProvider = providers.find(p => p.id === formData.providerId);
  const providerName = selectedProvider?.name?.toLowerCase() ?? "";
  const isOllamaProvider = providerName === "ollama";
  const isVllmProvider = providerName === "vllm";
  const showSupportsToolsToggle = allowsSupportsToolsToggle(formData.modelId, formData.type);

  useEffect(() => {
    if (!open || !isVllmProvider || !onFetchVllmModels || vllmFetched) return;
    if (fetchingVllmModels || vllmModels.length > 0) return;
    onFetchVllmModels();
  }, [
    open,
    isVllmProvider,
    formData.providerId,
    onFetchVllmModels,
    fetchingVllmModels,
    vllmModels.length,
    vllmFetched,
  ]);

  const handleOllamaModelSelect = (modelName: string) => {
    setSelectedOllamaModel(modelName);
    const selected = ollamaModels.find(m => m.name === modelName);
    if (selected) {
      setFormData(prev => ({
        ...prev,
        modelId: selected.name,
        name: selected.name.charAt(0).toUpperCase() + selected.name.slice(1),
        description: `Local Ollama model: ${selected.name}`,
        type: "CHAT",
        maxTokens: "",
        supportsImages: selected.name.toLowerCase().includes("vision") || selected.name.toLowerCase().includes("llava"),
        supportsTools: allowsSupportsToolsToggle(selected.name, "CHAT"),
        supportsStreaming: true,
        inputPricing: "0",
        outputPricing: "0",
      }));
    }
  };

  useEffect(() => {
    if (!showSupportsToolsToggle && formData.supportsTools) {
      setFormData((prev) => ({ ...prev, supportsTools: false }));
    }
  }, [showSupportsToolsToggle, formData.supportsTools]);

  const handleVllmModelSelect = (modelId: string) => {
    setSelectedVllmModel(modelId);
    const selected = vllmModels.find(m => m.id === modelId);
    if (selected) {
      const displayName = selected.id
        .split(/[-_]/)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
      setFormData(prev => ({
        ...prev,
        modelId: selected.id,
        name: displayName,
        description: `Local vLLM model: ${selected.id}`,
        type: "CHAT",
        maxTokens: "",
        supportsImages: false,
        supportsTools: false,
        supportsStreaming: true,
        inputPricing: "0",
        outputPricing: "0",
      }));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      supportsTools: showSupportsToolsToggle ? formData.supportsTools : false,
      maxTokens: formData.maxTokens ? Number(formData.maxTokens) : undefined,
      inputPricing: formData.inputPricing ? Number(formData.inputPricing) : undefined,
      outputPricing: formData.outputPricing ? Number(formData.outputPricing) : undefined,
    });
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

          {isOllamaProvider && (
            <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
              <div className="flex items-center justify-between">
                <Label>Available Ollama Models</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onFetchOllamaModels?.()}
                  disabled={fetchingOllamaModels || !onFetchOllamaModels}
                >
                  {fetchingOllamaModels ? (
                    <>
                      <Loader className="w-4 h-4 mr-2" />
                      Fetching...
                    </>
                  ) : (
                    "Fetch Models"
                  )}
                </Button>
              </div>

              {ollamaError && (
                <Alert variant="destructive">
                  <AlertDescription>{ollamaError}</AlertDescription>
                </Alert>
              )}

              {ollamaModels.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="ollamaModelSelect">Select Model</Label>
                  <Select value={selectedOllamaModel} onValueChange={handleOllamaModelSelect}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose an Ollama model" />
                    </SelectTrigger>
                    <SelectContent className="z-[100]">
                      {ollamaModels.map((m) => (
                        <SelectItem key={m.name} value={m.name}>
                          <div className="flex flex-col">
                            <span>{m.name}</span>
                            <span className="text-xs text-muted-foreground">
                              Size: {Math.round(m.size / 1024 / 1024 / 1024 * 100) / 100} GB
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

          {isVllmProvider && (
            <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
              <div className="flex items-center justify-between gap-2">
                <Label>Available vLLM Models</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onFetchVllmModels?.()}
                  disabled={fetchingVllmModels || !onFetchVllmModels}
                >
                  {fetchingVllmModels ? (
                    <>
                      <Loader className="w-4 h-4 mr-2" />
                      Fetching...
                    </>
                  ) : (
                    "Refresh list"
                  )}
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                Loaded from server <code className="text-xs">VLLM_BASE_URL</code> (LiteLLM proxy on
                cmps01, port 8001). If fetch fails, ask ops to check{" "}
                <code className="text-xs">infra/cmps01</code> — not a URL you enter here.
              </p>

              {vllmError && (
                <Alert variant="destructive">
                  <AlertDescription>{vllmError}</AlertDescription>
                </Alert>
              )}

              {fetchingVllmModels && (
                <p className="text-sm text-muted-foreground">Loading models from vLLM proxy…</p>
              )}

              {vllmFetched && !fetchingVllmModels && !vllmError && vllmModels.length === 0 && (
                <Alert>
                  <AlertDescription>
                    No models returned. Ops: verify LiteLLM on cmps01 and{" "}
                    <code>VLLM_BASE_URL</code> in EduAI <code>.env</code> (
                    <code>http://cmps01.ok.ubc.ca:8001</code>).
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="vllmModelSelect">Select Model</Label>
                <Select
                  value={selectedVllmModel}
                  onValueChange={handleVllmModelSelect}
                  disabled={vllmModels.length === 0}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue
                      placeholder={
                        fetchingVllmModels
                          ? "Loading…"
                          : vllmModels.length === 0
                            ? "Refresh list first"
                            : "Choose a vLLM model"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent className="z-[100]">
                    {vllmModels.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        <div className="flex flex-col">
                          <span>{m.id}</span>
                          {m.owned_by && (
                            <span className="text-xs text-muted-foreground">
                              {m.owned_by}
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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

              {showSupportsToolsToggle ? (
                <div className="flex items-center space-x-2">
                  <Switch
                    id="supportsTools"
                    checked={formData.supportsTools}
                    onCheckedChange={(checked) => setFormData({ ...formData, supportsTools: checked })}
                  />
                  <Label htmlFor="supportsTools">Supports Tools</Label>
                </div>
              ) : null}
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
