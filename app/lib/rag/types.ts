import { PromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { ChatOllama } from "@langchain/ollama";

export const OllamaServerURL = () => {
  return process.env.OLLAMA_SERVER_URL || "http://localhost:11434";
};

export enum VectorStores {
  CourseSettings = "course_setting",
  Question = "question",
  Document = "document",
  DocumentAggregate = "document_aggregate",
}

export enum AvailableModelTypes {
  Qwen = "qwen2.5:7b",
  DEEPSEEK = "deepseek-r1:14b",
  GPT4o_mini = "gpt-4o-mini",
  GPT4o = "gpt-4o",
}

export enum AvailableMultiModalModelTypes {
  Qwen = "qwen2.5vl:latest",
  Gemma = "gemma3:latest",
}

export enum EmbeddingModelType {
  openai = "openai",
  mxbai_embed_large = "mxbai-embed-large",
  nomic_embed_text = "nomic-embed-text",
}

export const DefaultEmbeddingModel = () => {
  const value = process.env.DEFAULT_EMBEDDING_MODEL as EmbeddingModelType | undefined;
  const found = value && Object.values(EmbeddingModelType).includes(value);
  if (!found) {
    throw new Error(
      `Improper configuration! Environment variable 'DEFAULT_EMBEDDING_MODEL' must be one of: ${Object.values(
        EmbeddingModelType
      ).join(", ")}. Received: ${value ?? "undefined"}`
    );
  }
  return value as EmbeddingModelType;
};

export type EmbeddingModelContext = {
  contextSize: number;
  vectorDimensions: number;
};

export const EmbeddingModels: { [key: string]: EmbeddingModelContext } = {
  [EmbeddingModelType.mxbai_embed_large]: {
    contextSize: 512,
    vectorDimensions: 1024,
  },
  [EmbeddingModelType.nomic_embed_text]: {
    contextSize: 2000,
    vectorDimensions: 768,
  },
  [EmbeddingModelType.openai]: {
    // text-embedding-3-small
    contextSize: 8192,
    vectorDimensions: 1536,
  },
};

export type UpdateChatbotSettingParams = {
  prompt?: string;
  modelName?: AvailableModelTypes;
  temperature?: number;
  topK?: number;
  similarityThresholdDocuments?: number;
};

export const defaultChatbotSetting = {
  prompt:
    "You are a course help assistant for a course. Here are some rules for question answering:  1) You may use markdown for styling your answers. 2) Refer to context when you see fit. 3) Try not giving the assignment question answers directly to students, instead provide hints.",
  modelName: AvailableModelTypes.Qwen,
  temperature: 0.7,
  topK: 5,
  similarityThresholdDocuments: 0.55,
  similarityThresholdQuestions: 0.9,
};

export type CourseServiceType = {
  questionPrompt: any;
  questionGeneratorPrompt: any;
  llm: any;
  generatorLLM: any;
  topK: number;
  similarityThresholdDocuments: number;
  similarityThresholdQuestions: number;
};

export type DocumentContent = {
  text?: string;
  imageBlobs?: string[];
  systemPrompt?: string;
};

export type ChatMessage = {
  type: string;
  message: string;
};

export const ChatbotQueryTypes = ["default", "abstract"] as const;
export type ChatbotQueryType = (typeof ChatbotQueryTypes)[number];
export const ChatbotQueryTypePrompts: Record<ChatbotQueryType, any> = {
  default: PromptTemplate.fromTemplate("{query}"),
  abstract: PromptTemplate.fromTemplate(`
    Generate an abstract based on the provided query. 
    The abstract cannot be more than 100 characters.
    Keep the abstract simple and do not add unnecessary detail. 
    Provide only the raw abstract with no additional formatting or explanations.
    -------------------------------------------------------------------------------------------------
    Query: {query}
    -------------------------------------------------------------------------------------------------
    Abstract:
  `),
};

export const ERROR_MESSAGES = {
  course_settings: {},
  document: {},
  question: {},
  chatbot: {},
};


