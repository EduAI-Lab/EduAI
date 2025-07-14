import { streamText } from 'ai';
import { createAIProviderRegistry } from '~/lib/ai/providers';
import type { ActionFunctionArgs } from 'react-router';

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { messages, model, apiKeys } = await request.json();

    if (!messages || !model || !apiKeys) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Create AI provider registry with user's API keys
    const registry = createAIProviderRegistry(apiKeys);

    // Get the AI model from registry
    const aiModel = registry.languageModel(model);

    // Stream the response
    const result = await streamText({
      model: aiModel,
      messages,
      temperature: 0.6,
      maxTokens: 32000,
    });

    return result.toDataStreamResponse();
  } catch (error) {
    console.error('Chat API error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}