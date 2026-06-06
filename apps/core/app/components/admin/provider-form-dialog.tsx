import { useState, useEffect } from "react";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { Switch } from "~/components/ui/switch";
import type { AIModel } from "~/types/ai";

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

export interface ProviderFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider?: AIProvider | null;
  onSubmit: (data: any) => void;
}

export function ProviderFormDialog({ open, onOpenChange, provider, onSubmit }: ProviderFormDialogProps) {
  const [formData, setFormData] = useState({
    name: "",
    displayName: "",
    description: "",
    requiresApiKey: true,
    defaultBaseUrl: "",
    envVarName: "",
    isActive: true,
  });

  useEffect(() => {
    if (provider) {
      setFormData({
        name: provider.name,
        displayName: provider.displayName,
        description: provider.description,
        requiresApiKey: provider.requiresApiKey,
        defaultBaseUrl: provider.defaultBaseUrl || "",
        envVarName: provider.envVarName || "",
        isActive: provider.isActive,
      });
    } else {
      setFormData({
        name: "",
        displayName: "",
        description: "",
        requiresApiKey: true,
        defaultBaseUrl: "",
        envVarName: "",
        isActive: true,
      });
    }
  }, [provider, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const submitData = {
      ...formData,
      defaultBaseUrl: formData.defaultBaseUrl || undefined,
      envVarName: formData.envVarName || undefined,
    };

    onSubmit(submitData);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{provider ? "Edit Provider" : "Create Provider"}</DialogTitle>
          <DialogDescription>
            {provider ? "Update the provider configuration." : "Add a new AI provider to your platform."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name (ID)</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="openai"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                value={formData.displayName}
                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                placeholder="OpenAI"
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
              placeholder="Advanced AI models including GPT-4..."
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="defaultBaseUrl">Default Base URL</Label>
              <Input
                id="defaultBaseUrl"
                value={formData.defaultBaseUrl}
                onChange={(e) => setFormData({ ...formData, defaultBaseUrl: e.target.value })}
                placeholder="https://api.openai.com/v1"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="envVarName">Environment Variable</Label>
              <Input
                id="envVarName"
                value={formData.envVarName}
                onChange={(e) => setFormData({ ...formData, envVarName: e.target.value })}
                placeholder="OPENAI_API_KEY"
              />
            </div>
          </div>

          <div className="flex flex-col space-y-4">
            <div className="flex items-center space-x-2">
              <Switch
                id="requiresApiKey"
                checked={formData.requiresApiKey}
                onCheckedChange={(checked) => setFormData({ ...formData, requiresApiKey: checked })}
              />
              <Label htmlFor="requiresApiKey">Requires API Key</Label>
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

          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">
              {provider ? "Update" : "Create"} Provider
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}