import { BaseMessageChunk, HumanMessage, MessageContent, SystemMessage } from "@langchain/core/messages";
import { ChatOllama } from "@langchain/ollama";
import { AvailableMultiModalModelTypes, DocumentContent, OllamaServerURL } from "./types";

export class MultiModalLLMService {
  promptMLLM(contents: DocumentContent): Promise<BaseMessageChunk> {
    const chatbot = new ChatOllama({
      model: AvailableMultiModalModelTypes.Qwen,
      baseUrl: OllamaServerURL(),
    });

    const texts: MessageContent = [];
    if (contents.text) {
      texts.push({ type: "text", text: contents.text });
    }

    const images: MessageContent = [];
    if (contents.imageBlobs) {
      for (let i = 0; i < contents.imageBlobs.length; i++) {
        images.push({
          type: "image_url",
          image_url: { url: `data:image/jpeg;base64,${contents.imageBlobs[i]}` },
        });
      }
    }

    return chatbot.invoke([
      new SystemMessage({
        content:
          contents.systemPrompt ||
          "Please provide a concise description of what you see in this image, focusing on the key elements and any text content if present. If there is text, please provide the text as well.",
      }),
      new HumanMessage({ content: [...texts, ...images] }),
    ]);
  }
}


