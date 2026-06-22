import { useState } from "react";
import { IconEdit, IconTrash, IconPlus, IconCloud, IconServer } from "@tabler/icons-react";
import { Button } from "@eduai/ui";
import { Badge } from "@eduai/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@eduai/ui";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@eduai/ui";
import { Switch } from "@eduai/ui";

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

export interface AIModelsTableProps {
  models: AIModel[];
  onEdit: (model: AIModel) => void;
  onDelete: (id: string) => void;
  onToggleActive: (model: AIModel) => void;
}

const formatPrice = (price?: number) => {
  if (!price) return "Free";
  return `$${price}/1M`;
};

const formatTokens = (tokens?: number) => {
  if (!tokens) return "N/A";
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}K`;
  return tokens.toString();
};

const getTypeColor = (type: string) => {
  switch (type) {
    case "CHAT":
      return "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800";
    case "COMPLETION":
      return "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-800";
    case "EMBEDDING":
      return "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800";
    case "IMAGE":
      return "bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-950/40 dark:text-pink-300 dark:border-pink-800";
    case "AUDIO":
      return "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800";
    case "VIDEO":
      return "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
};

const isLocalProvider = (provider: AIProvider) => {
  return provider.name === "ollama";
};

export function AIModelsTable({ models, onEdit, onDelete, onToggleActive }: AIModelsTableProps) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Model</TableHead>
            <TableHead>Provider</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Context</TableHead>
            <TableHead>Pricing</TableHead>
            <TableHead>Features</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {models.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                No models found.
              </TableCell>
            </TableRow>
          )}
          {models.map((model) => (
            <TableRow key={model.id}>
              <TableCell>
                <div>
                  <div className="font-medium">{model.name}</div>
                  <div className="text-sm text-muted-foreground">{model.modelId}</div>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span>{model.provider.displayName}</span>
                  <Badge variant="outline" className="text-xs">
                    {isLocalProvider(model.provider) ? (
                      <>
                        <IconServer size={12} className="mr-1" />
                        Local
                      </>
                    ) : (
                      <>
                        <IconCloud size={12} className="mr-1" />
                        Cloud
                      </>
                    )}
                  </Badge>
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className={getTypeColor(model.type)}>
                  {model.type}
                </Badge>
              </TableCell>
              <TableCell className="text-sm">{formatTokens(model.maxTokens)}</TableCell>
              <TableCell>
                <div className="text-sm">
                  <div>In: {formatPrice(model.inputPricing)}</div>
                  <div className="text-muted-foreground">Out: {formatPrice(model.outputPricing)}</div>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {model.supportsImages && (
                    <Badge variant="secondary" className="text-xs">
                      Vision
                    </Badge>
                  )}
                  {model.supportsTools && (
                    <Badge variant="secondary" className="text-xs">
                      Tools
                    </Badge>
                  )}
                  {model.supportsStreaming && (
                    <Badge variant="secondary" className="text-xs">
                      Stream
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center space-x-2">
                  <Switch
                    checked={model.isActive}
                    onCheckedChange={() => onToggleActive(model)}
                  />
                  <span className="text-sm">
                    {model.isActive ? "Active" : "Inactive"}
                  </span>
                </div>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onEdit(model)}
                  >
                    <IconEdit className="h-4 w-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm">
                        <IconTrash className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Model</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete "{model.name}"? This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => onDelete(model.id)}>
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}