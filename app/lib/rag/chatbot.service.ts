import { PromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { ChatOllama } from "@langchain/ollama";
import { Document, DocumentInterface } from "@langchain/core/documents";
import { VectorStoreService } from "./vector-store.service";
import { CourseSettingService } from "./course-setting.service";
import { MultiModalLLMService } from "./multimodal-llm.service";
import { TFIDF } from "./vector/similarity";
import {
  AvailableModelTypes,
  ChatMessage,
  ChatbotQueryType,
  ChatbotQueryTypePrompts,
  CourseServiceType,
  OllamaServerURL,
  VectorStores,
} from "./types";

export class ChatbotService {
  constructor(
    private vectorStoreService: VectorStoreService,
    private courseSettingService: CourseSettingService,
    private multimodalService: MultiModalLLMService
  ) {}

  private courseServiceCache = new Map<number, CourseServiceType>();

  async getCourseService(courseId: number): Promise<CourseServiceType> {
    const cached = this.courseServiceCache.get(courseId);
    if (cached) return cached;

    const courseSetting = await this.courseSettingService.getChatbotSetting(courseId);
    if (!courseSetting) throw new Error(`Course settings for ${courseId} not found`);

    const questionPrompt = PromptTemplate.fromTemplate(
      `
        Use the following pieces of context to answer the question at the end. 
        ----------------
        ${courseSetting.metadata.prompt}
        ----------------
        The following are some chunks of hopefully relevant information from the RAG system.
        The original documents were uploaded by the course's professor and then chunked.
        If you believe that the RAG chunks retrieved were irrelevant or does not help answer the question, 
        you may ask the user for more context (and hopefully the RAG will retrieve better documents as a result)
        Document Chunks: {context}
        ----------------
        CHAT HISTORY: {chatHistory}
        ----------------
        QUESTION: {question}
        ----------------
        Helpful Answer:`
    );

    const questionGeneratorPrompt = PromptTemplate.fromTemplate(`
        Given the previous questions and a follow up question, rephrase the follow up question to be a standalone question.
        ----------------
        RULES:
            1) If there is no previous questions, return EXACTLY the follow up question
            2) If the question is not a follow up question, return EXACTLY the follow up question
            3) If the question is a follow up, rephrase the follow up with the most recent message at the bottom
        ----------------
        FOLLOWUP QUESTION: {question}
        ----------------
        PREVIOUS QUESTIONS (MOST RECENT AT THE BOTTOM): {chatHistory}
        ----------------
        Standalone question:`);

    let questionModel: ChatOllama | ChatOpenAI;
    let questionGeneratorModel: ChatOllama | ChatOpenAI;
    const modelName = courseSetting.metadata.modelName as string;
    if (!modelName.startsWith("gpt")) {
      questionModel = new ChatOllama({ model: modelName, baseUrl: OllamaServerURL() });
      questionGeneratorModel = new ChatOllama({ model: AvailableModelTypes.Qwen, baseUrl: OllamaServerURL() });
    } else {
      questionModel = new ChatOpenAI({ modelName: modelName || "gpt-3.5-turbo", temperature: courseSetting.metadata.temperature });
      questionGeneratorModel = new ChatOpenAI({ modelName: "gpt-4o-mini", temperature: courseSetting.metadata.temperature });
    }

    const service: CourseServiceType = {
      questionPrompt,
      questionGeneratorPrompt,
      llm: questionModel,
      generatorLLM: questionGeneratorModel,
      topK: courseSetting.metadata.topK,
      similarityThresholdDocuments: courseSetting.metadata.similarityThresholdDocuments,
      similarityThresholdQuestions: courseSetting.metadata.similarityThresholdQuestions,
    };
    this.courseServiceCache.set(courseId, service);
    return service;
  }

  async addQuestion(
    courseId: number,
    {
      query,
      answer,
      sourceDocuments,
    }: { query: string; answer: string; sourceDocuments: Document[] }
  ) {
    const repository = await this.vectorStoreService.getRepository(VectorStores.Question);
    const questionVector = await this.vectorStoreService.embedQuery(query);
    const embeddingString = `[${questionVector.join(",")}]`;

    const documentMap = new Map<string, any>();
    sourceDocuments.forEach((doc) => {
      const key = String(doc.metadata.name) + "|" + String(doc.metadata.source);
      if (String(doc.metadata.type).startsWith("inserted")) {
        if (!documentMap.has(key)) {
          documentMap.set(key, {
            ...doc,
            content: doc.pageContent,
            docName: doc.metadata.name,
            sourceLink: doc.metadata.source,
            type: doc.metadata.type,
          });
        }
      } else {
        if (documentMap.has(key)) {
          const existingDoc = documentMap.get(key);
          if (!existingDoc.pageNumbers.includes(doc.metadata.loc.pageNumber)) {
            existingDoc.pageNumbers.push(doc.metadata.loc.pageNumber);
          }
        } else {
          documentMap.set(key, {
            ...doc,
            content: doc.pageContent,
            docName: doc.metadata.name,
            sourceLink: doc.metadata.source,
            pageNumbers: [doc.metadata.loc.pageNumber],
          });
        }
      }
    });

    const transformedSourceDocuments = Array.from(documentMap.values());

    const documentRow = {
      pageContent: query,
      embedding: embeddingString,
      metadata: {
        courseId: String(courseId),
        answer: answer,
        verified: false,
        suggested: false,
        inserted: false,
        sourceDocuments: transformedSourceDocuments,
        timestamp: new Date(),
        embeddingModel: this.vectorStoreService.embeddingModelName,
      },
    } as any;

    const savedQuestion = await repository.save(documentRow);
    return {
      question: savedQuestion.pageContent,
      answer: savedQuestion.metadata.answer,
      questionId: savedQuestion.id,
      sourceDocuments: savedQuestion.metadata.sourceDocuments,
      verified: savedQuestion.metadata.verified,
      courseId: savedQuestion.metadata.courseId,
      isPreviousQuestion: false,
    };
  }

  async query(query: string, type: ChatbotQueryType, promptParams?: any): Promise<string> {
    const prompt = ChatbotQueryTypePrompts[type];
    const fprompt = await prompt.invoke({ query, ...promptParams });
    const llm = new ChatOllama({ model: AvailableModelTypes.Qwen, baseUrl: OllamaServerURL() });
    const res = await llm.invoke(fprompt);
    return res.text;
  }

  async ask(
    courseId: number,
    question: string,
    history: ChatMessage[],
    skipSimilaritySearch: boolean
  ): Promise<any> {
    const chainResponse = await this.callConversationalDocumentQAChain(
      courseId,
      question,
      history,
      skipSimilaritySearch
    );
    const similarityScore = TFIDF("I don't know", chainResponse.answer);
    if (similarityScore < 0.8) {
      return chainResponse;
    } else {
      return { answer: "I don't know", questionId: chainResponse.questionId };
    }
  }

  async callConversationalDocumentQAChain(
    courseId: number,
    question: string,
    history: ChatMessage[],
    skipSimilaritySearch: boolean
  ) {
    const courseService = await this.getCourseService(courseId);
    const userQuestionsString = this.historyToString(history, false);
    let rephrasedQuestion = question;
    if (userQuestionsString && userQuestionsString.length > 0) {
      rephrasedQuestion = await this.invokeQuestionGeneratorChain(courseService, {
        question,
        chatHistoryString: userQuestionsString,
      });
    }

    if (!skipSimilaritySearch) {
      const similarQuestions = await this.vectorStoreService.similaritySearchWithScore(
        VectorStores.Question,
        rephrasedQuestion,
        3,
        { courseId: courseId }
      );
      const similarQuestion: any = similarQuestions[0];
      const hasSimilarQuestion = similarQuestions.length > 0 && 1 - similarQuestion[1] > 0.999;
      if (hasSimilarQuestion) {
        return {
          question: similarQuestion[0].pageContent,
          answer: similarQuestion[0].metadata.answer,
          questionId: similarQuestion[0].id,
          sourceDocuments: similarQuestion[0].metadata.sourceDocuments,
          verified: similarQuestion[0].metadata.verified,
          courseId: similarQuestion[0].metadata.courseId,
          isPreviousQuestion: true,
        };
      }
    }

    const response = await this.performDocumentQA({
      courseId,
      question,
      rephrasedQuestion,
      chatHistory: history,
      courseSettings: courseService,
    });
    return await this.addQuestion(courseId, {
      query: rephrasedQuestion,
      answer: response.text,
      sourceDocuments: response.sourceDocuments,
    });
  }

  async performDocumentQA(input: {
    courseId: number;
    question: string;
    rephrasedQuestion: string;
    chatHistory: ChatMessage[];
    courseSettings: CourseServiceType;
  }): Promise<{ text: any; sourceDocuments: any }> {
    const fullChatHistoryString = input.chatHistory ? this.historyToString(input.chatHistory) : null;
    const sourceDocuments = await this.getRelevantDocuments(
      input.courseId,
      input.courseSettings,
      input.rephrasedQuestion
    );
    const serializedDocs = sourceDocuments.map((doc) => doc.pageContent).join("\n\n");
    const text = await this.invokeQuestionChain(input.courseSettings, {
      question: input.question,
      chatHistoryString: fullChatHistoryString ?? "",
      serializedDocs,
    });
    return { text, sourceDocuments };
  }

  async getRelevantDocuments(
    courseId: number,
    service: CourseServiceType,
    question: string
  ): Promise<DocumentInterface[]> {
    const similarDocuments = await this.vectorStoreService.similaritySearchWithScore(
      VectorStores.Document,
      question,
      service.topK,
      { courseId: String(courseId) }
    );
    return similarDocuments
      .filter((document) => 1 - document[1] >= service.similarityThresholdDocuments)
      .slice(0, service.topK)
      .map((document) => document[0]);
  }

  async invokeQuestionChain(
    service: CourseServiceType,
    {
      question,
      chatHistoryString,
      serializedDocs,
    }: { question: string; chatHistoryString?: string; serializedDocs: string }
  ) {
    const fprompt = await service.questionPrompt.invoke({
      chatHistory: chatHistoryString,
      context: serializedDocs,
      question: question,
    });
    const response = await service.llm.invoke(fprompt.value);
    return response.text;
  }

  async invokeQuestionGeneratorChain(
    service: CourseServiceType,
    { question, chatHistoryString }: { question: string; chatHistoryString?: string }
  ) {
    const fprompt = await service.questionGeneratorPrompt.invoke({
      chatHistory: chatHistoryString,
      question: question,
    });
    const response = await service.generatorLLM.invoke(fprompt.value);
    return response.text;
  }

  historyToString(history: ChatMessage[], includeAI = true) {
    let stringifiedHistory = "";
    for (const message of history) {
      if (message.type === "userMessage") {
        stringifiedHistory += `Human: ${message.message}\n`;
      } else if (message.type === "apiMessage" && includeAI) {
        stringifiedHistory += `AI: ${message.message}\n\n\n`;
      }
    }
    return stringifiedHistory;
  }
}


